// DATABASE CONNECTION AND QUERY //
// ============================================================
// We need to query the metadata tables at the beginning of each session to get data for the setup object,
// querying, upload, and more. Everything that queries the metadata tables to recieve this information
// should go here and then the other files can import the information
// ============================================================

// Database connection and SQL formatter
const {postgresClient, connectPostgreSQL} = require('../pg.js');
const { parentDir } = require("../utils.js");
let database = process.argv.filter(arg => /--database=.*/.test(arg));
let isTemp = process.argv.some(arg => arg === "--temp");
let noLog = process.argv.some(arg => arg === "--no-log");
if(database.length > 0) {
    database = database[0].slice(11);
    connectPostgreSQL('default', { customDatabase: database, log: !noLog });
} else {
    throw Error("Must include database to connect to with --database=...");
}
// get connection object
const db = postgresClient.getConnection[database];

// get SQL formatter
const formatSQL = postgresClient.format;
const fs = require('fs');

// QUERIES //
// ==================================================

async function asyncWrapper(db) {

let {
       columnQuery, 
       allItems, 
       itemM2M, 
       frontendTypes, 
       allFeatures} = require('../statement.js').setup

const setDatabaseConnection = require('../query/direct.js');
const { getPresetValues } = setDatabaseConnection(db);

const referenceTypes = {
    item: ['item-id', 'item-id', 'item-non-id', 'item-list', 'item-factor', 'attribute'],
    observation: ['obs', 'obs-list', 'obs-factor', 'special', 'attribute']
}

let itemFISLookup
let observationFISLookup
let itemLocalReturnableLookup
let observationLocalReturnableLookup
let itemTableNames
let featureTableNames
let observationHistory = {};
let itemHistory = {};
let observationItemTableNameLookup = {};
let itemObservationTableNameLookup = {};
let requiredItemView;
const itemColumnObject = {};

async function prefetch() {
    metadataItemColumns = await db.any('select * from metadata_item_columns');

    (await db.any('select * from observation_history_type')).forEach(el => observationHistory[el.type_name] = el.type_id);
    (await db.any('select * from item_history_type')).forEach(el => itemHistory[el.type_name] = el.type_id);
    
    (await db.any('select * from observation_item_table_name_lookup')).forEach(el => {
        observationItemTableNameLookup[el.observation] = el.item;
        itemObservationTableNameLookup[el.item] = el.observation;
    });
    
    for(let item of metadataItemColumns) {
        itemColumnObject[item.i__table_name] = {...item};
        itemColumnObject[item.i__table_name].isItem = item.r__type_name.map(type => referenceTypes.item.includes(type));
        itemColumnObject[item.i__table_name].isObservation = item.r__type_name.map(type => referenceTypes.observation.includes(type));
    };
    returnableQuery = await db.any('select * from returnable_view');
    columnQuery = await db.any(columnQuery);
    allItems = await db.any(allItems);
    itemM2M = await db.any(itemM2M);
    frontendTypes = await db.any(frontendTypes);
    allFeatures = await db.any(allFeatures);
    // from setupObject, identifies type of item (ex. item_sink vs item_mirror) based on index
    itemTableNames = allItems.map(item => item.i__table_name);
    featureTableNames = allFeatures.map(f => f.f__table_name);
    
    itemFISLookup = Object.fromEntries(itemTableNames.map(name => [name, []]));
    observationFISLookup = Object.fromEntries(featureTableNames.map(name => [name, []]));
    itemLocalReturnableLookup = Object.fromEntries(itemTableNames.map(name => [name, []]));
    observationLocalReturnableLookup = Object.fromEntries(featureTableNames.map(name => [name, []]));
    
    requiredItemView = await db.any('SELECT * FROM required_item_view')
}

await prefetch()

/**
 * Validation lookup to verify proper item insertion
 * @typedef {Object} requiredItemLookup
 * @property {Object} [tableName] Reprsents a single item and all of its required items. Property should exist for every item in the schema
 * @property {Number[]} tableName.nullable
 * @property {Number[]} tableName.nonNullable
 */
let requiredItemLookup = {}
const globalItemTypeID = itemTableNames.indexOf('item_global')
requiredItemView.forEach(item => {
    requiredItemLookup[item.item_table_name] = {
        nullable: [],
        nonNullable: [],
        id: [],
        nonId: []
    };
    item.required_item_table_name.forEach((requiredItem, i) => {
        // is nullable ?
        if(item.is_nullable[i]) {
            requiredItemLookup[item.item_table_name].nullable.push(requiredItem);
        } else {
            requiredItemLookup[item.item_table_name].nonNullable.push(requiredItem);
        }
        // is id ?
        if(item.is_id[i]) {
            requiredItemLookup[item.item_table_name].id.push(requiredItem);
        } else {
            requiredItemLookup[item.item_table_name].nonId.push(requiredItem);            
        }
    })
});



// closing db connection
db.$pool.end;
console.log('Closed PostgreSQL Connection: setup');

// RETURNABLE ID CLASS
// ============================================================
class ReturnableID {
    constructor(feature, baseItem, ID, columnID, columnName, columnTree, tableTree, referenceType, appendSQL, selectSQL, whereSQL, frontendName, sqlType, selectorType) {
        this.ID = ID;
        this.columnID = columnID;
        this.feature = feature;
        this.columnName = columnName;
        this.frontendName = frontendName;
        this.referenceType = referenceType;
        this.appendSQL = appendSQL;
        this.selectSQL = selectSQL;
        this.whereSQL = whereSQL;
        this.sqlType = sqlType;
        this.baseItem = baseItem;
        this.selectorType = selectorType;

        this.joinObject = this.makeJoinObject(Array.from(columnTree), Array.from(tableTree), ID);

        Object.freeze(this);
    }

    makeJoinObject(columnTree, tableTree, ID) {
        if(columnTree === null || tableTree === null) {
            return null
        } else {
            // references must come in sets of 2
            if(tableTree.length % 2 != 0 || columnTree.length % 2 != 0) {
                throw 'Setup Error 1901: References must come in sets of 2'
            }
            let joinList = [];
            for(let n = tableTree.length; n > 1; n = n - 2) {
                joinList.push({
                    joinTable: tableTree[n-2],
                    joinColumn: columnTree[n-2],
                    originalTable: tableTree[n-1],
                    originalColumn: columnTree[n-1]
                });
            }

            let joinListArray = [];
            joinList.forEach(join => {
                joinListArray.push(`${join.originalTable}.${join.originalColumn}>${join.joinTable}.${join.joinColumn}`)
            })

            joinListArray.reverse();

            // recursiveReferenceSelection input. Note parentAlias is always input as -1 because the function
            // selects references from the feature_... table and builds out. -1 indicates a join to this table
            return {parentAlias: -1, ID: ID, refs: joinListArray}
        }
    }
}




// HOISTED FUNCTIONS //
// ============================================================

const setupQuery = async (returnableQuery, columnQuery, allItems, itemM2M, frontendTypes, allFeatures) => {

    let returnableIDLookup = {};
    let idValidationLookup = {};
    let featureParents = {};
    let setupObject = {};
    let setupMobileObject = {};

    // Format frontendTypes                         
    frontendTypes = frontendTypes.map((el) => el.type_name)

    // Order so features come before subfeatures
    let allFeaturesPreLength = allFeatures.length;
    allFeatures = [...allFeatures.filter((feature) => feature['ff__table_name'] === null), ...allFeatures.filter((feature) => feature['ff__table_name'] !== null)];
    let allFeaturesPostLength = allFeatures.length;
    // sanity check
    if(allFeaturesPostLength !== allFeaturesPreLength) {
        throw Error('Features are not partitioned correctly!')
    };
         
    // Construct setup object //
    // ============================================================
    // DOCUMENTATION SCATCH PAD
    /*
    let setupObject2 = {
        children: [[Number,...],Number], 
        subfeatureStartIndex: Number,
        items: [itemNodeObject,...],
        features: [featureNodeObject,...],
        columns: [columnObject,...],
        returnableIDToTreeID: returnableIDToTreeIDObject,
        treeIDToReturnableID: treeIDToReturnableIDObject,
        lastModified: Date
    };     

    */
    /*
    columnObject
    {
        “default”: Bool,
        “frontendName”: String,
        “filterSelector”: selectorObject|NULL,
        “inputSelector”: selectorObject|NULL,
        “datatype”: datatypeObject,
        “nullable”: Bool,
        “information”: String,
        //“isGroundTruth”: true|false
        “accuracy”: Number
    }
    */
    


    const datatypeArray = ['hyperlink', 'string', 'bool', 'date', 'location'];

    // Construct columnObjects
    // ==================================================
    const columnOrder = columnQuery.map(row => row['c__column_id']);

    let columnObjects = await Promise.all(columnQuery.map(async (row, i) => {

        // filterSelector
        let fSelector = (row['fs__selector_name'] === null ? null : {selectorKey: row['fs__selector_name'], selectorValue: null})

        // inputSelector
        let iSelector = (row['ins__selector_name'] === null ? null : {selectorKey: row['ins__selector_name'], selectorValue: null})

        // datatype
        let datatype = datatypeArray.indexOf(row['ft__type_name'])

        // get preset values if correct type
        let presetValues = null;
        if(['item-list', 'obs-list', 'item-factor', 'obs-factor', 'attribute'].includes(row['rt__type_name'])) {
            presetValues = await getPresetValues(row['c__column_name'], row['c__table_name']);
        }
                
        return(
            {
                additionalInfo: {
                    observation: row['c__observation_table_name'],
                    subobservation: row['c__subobservation_table_name'],
                    item: row['i__table_name'],
                    columnName: row['c__column_name'],
                    tableName: row['c__table_name'],
                    referenceType: row['rt__type_name'],
                    columnID: row['c__column_id'],
                    isCurrent: row['r__attribute_type'] === 'current'
                },
                object: {
                    default: row['c__is_default'],
                    frontendName: row['c__frontend_name'],
                    filterSelector: fSelector,
                    inputSelector: iSelector,
                    selectorType: row['sn__selector_name'],
                    datatypeKey: datatype,
                    nullable: row['c__is_nullable'],
                    information: row['c__information'],
                    accuracy: row['c__accuracy'],
                    presetValues,
                    isFilterable: row['c__is_filterable'],
                },
            }
        );
    }));
    // Construct itemNodeObject
    // ==================================================

// INFO: item information does not exist right now

    const itemOrder = allItems.map(row => row['i__table_name']);

    let mobileItemNodeObjects = []
    let itemNodeObjects = allItems.map((item, index) => {

        // getting non-id columns
        const nonIDColumns = columnObjects.filter(col => col.additionalInfo.item === item['i__table_name'] && ['item-non-id', 'item-list', 'item-factor'].includes(col.additionalInfo.referenceType));

        // non-id column indices
        const nonIDColumnIndices = nonIDColumns.map(col => columnOrder.indexOf(col.additionalInfo.columnID));

        // getting id columns
        const IDColumns = columnObjects.filter(col => col.additionalInfo.item === item['i__table_name'] && ['item-id'].includes(col.additionalInfo.referenceType));

        // id column indices
        const IDColumnIndices = IDColumns.map(col => columnOrder.indexOf(col.additionalInfo.columnID));

        // attribute columns
        const itemAttributeColumns = columnObjects.filter(col => col.additionalInfo.referenceType === 'attribute' && item['i__table_name'] === col.additionalInfo.item && !col.additionalInfo.isCurrent);

        // attribute column indicies
        const itemAttributeColumnsIndices = itemAttributeColumns.map(col => columnOrder.indexOf(col.additionalInfo.columnID));

        // itemNodePointerObject
        // get parentIndex
        // filter on item table name = referencing table name
        let itemParents = itemM2M.filter(m2m => m2m['i__table_name'] === item['i__table_name']);
        // get referenced item indices
        let itemChildNodePointerObjects = itemParents.map(e => {
            let itemParentIndex = itemOrder.indexOf(e['ri__table_name']);

            // get frontendName
            let frontendName = e['m2m__frontend_name'];

            // get nullable
            let nullable = e['m2m__is_nullable'];

            // get information
            let information = e['m2m__information'];
// INFO: information is null now, Kian needs to add

            // get isID
            let isID = e['m2m__is_id'];

            return({
                object: {
                    index: itemParentIndex,
                    frontendName: frontendName,
                    nullable: nullable,
                    information: information
                },
                isID: isID
            })
        })
        
        // filter by ID = true and map to object
        let IDitemChildNodePointerObjects = itemChildNodePointerObjects.filter(obj => obj.isID === true).map(obj => obj.object);

        // filter by ID = false and map to object
        let nonIDitemChildNodePointerObjects = itemChildNodePointerObjects.filter(obj => obj.isID === false).map(obj => obj.object);

        mobileItemNodeObjects.push({
            children: [IDColumnIndices, nonIDColumnIndices, itemAttributeColumnsIndices],
            itemChildNodePointerObjects: [IDitemChildNodePointerObjects, nonIDitemChildNodePointerObjects],
            frontendName: item['i__frontend_name'],
            information: null
        })

        return ({
            children: [IDColumnIndices, IDitemChildNodePointerObjects, nonIDColumnIndices, nonIDitemChildNodePointerObjects, itemAttributeColumnsIndices],
            frontendName: item['i__frontend_name'],
            backendName: item['i__table_name'].match(/^item_(.*)/)[1],
            information: null
        });
    });


    // index of globalObject
    let globalItemIndex = itemOrder.indexOf('item_global');
    let auditItemIndex = itemOrder.indexOf('item_audit');
    let userItemIndex = itemOrder.indexOf('item_user');
    let orgItemIndex = itemOrder.indexOf('item_organization');

    // all item indicies
    let itemIndices = itemOrder.map((e,i) => i)
    

    // Construct featureNodeObject
    // ==================================================
    let rootFeatures = allFeatures.map((el) => [el['f__table_name'], el['ff__table_name']]).filter((el) => el[1] === null).map((el) => el[0])

    let parentSubfeatureLookup = {};

    let featureOrder = allFeatures.map((feature) => feature['f__table_name'])

    rootFeatures.forEach((el) => {
        parentSubfeatureLookup[el] = [];
    })

    // add subfeatures to the property in parentSubfeatureLookup of their parent feature
    allFeatures.map((el) => [el['f__table_name'], el['ff__table_name']]).forEach((el) => {
        if(el[1] !== null) {
            parentSubfeatureLookup[el[1]].push(el[0])
        }
    })
    let mobileFeatureNodeObjects = []
    let featureNodeObjects = allFeatures.map((el, index) => {

        let frontendName = el['f__frontend_name']
        let information = el['f__information']
        let numFeatureRange = el['f__num_feature_range'] 

        // get array of children
        let directChildren = (el['ff__table_name'] === null ? parentSubfeatureLookup[el['f__table_name']] : [])
        // get indicies
        directChildren = directChildren.map((child) => featureOrder.indexOf(child))

        // observation columns
        // filter on observable reference type and column item matching feature item
        let observationColumns = columnObjects.filter(col => ['obs', 'obs-list', 'obs-factor', 'special'].includes(col.additionalInfo.referenceType) && el['i__table_name'] === col.additionalInfo.item);

        // observation column indicies
        let observationColumnIndices = observationColumns.map(col => columnOrder.indexOf(col.additionalInfo.columnID));

        // attribute columns
        // filter on attribute reference type and column item matching feature item
        let attributeColumns = columnObjects.filter(col => ['attribute'].includes(col.additionalInfo.referenceType) && el['i__table_name'] === col.additionalInfo.item && col.additionalInfo.isCurrent);

        // attribute column indicies
        let attributeColumnIndices = attributeColumns.map(col => columnOrder.indexOf(col.additionalInfo.columnID));

        // observable item
        let observableItem = el['i__table_name'];

        // observable item index
        let observableItemIndex = itemOrder.indexOf(observableItem);

        // backend name is defined by table name
        let backendName = el['f__table_name']
        backendName = backendName.match(/^(?:sub)?observation_(.*)/)[1]

        mobileFeatureNodeObjects.push({
            children: [observationColumnIndices, attributeColumnIndices],
            itemIndex: observationColumnIndices,
            frontendName: frontendName,
            information: information,
            featureChildren: directChildren
        })

// INFO: numFeatureRange is commented out
        return({
            children: [observationColumnIndices, attributeColumnIndices, observableItemIndex],
            frontendName: frontendName,
            backendName: backendName,
            information: information,
            // numFeatureRange: numFeatureRange,
            featureChildren: directChildren
        })
    })

    let featureIndices = featureOrder.map((e, i) => i);
    
    // Construct returnableIDToTreeID and treeIDToReturnableID
    // ==================================================

    // init
    let returnableIDToTreeIDObject = {};
    let treeIDToReturnableIDObject = {};

    // init statics
    const statics = {
        featureIndices,
        featureNodeObjects,
        featureOrder,
        itemNodeObjects,
        itemOrder,
        columnObjects,
        columnOrder
    };

    // adding each returnable to the objects
    returnableQuery.forEach(returnable => {
        // calling tree creation function
        // note: this function calls itemReturnableMapper and featureReturnableMapper
        let idTreeObject = initialReturnableMapper(returnable, statics);

        // add to returnableIDToTreeIDObject
        returnableIDToTreeIDObject[String(idTreeObject.returnableID)] = idTreeObject.treeID.join('>');

        // add to treeIDToReturnableIDObject
        treeIDToReturnableIDObject[idTreeObject.treeID.join('>')] = idTreeObject.returnableID;
    });


    // Constructing the final setupObject
    // ==================================================

    setupObject.children = [featureIndices, itemIndices, globalItemIndex, auditItemIndex, userItemIndex, orgItemIndex];
    setupObject.subfeatureStartIndex = allFeatures.map((feature) => (feature['ff__table_name'] === null ? false : true)).indexOf(true); // indexOf takes first index to match
    setupObject.items = itemNodeObjects;
    setupObject.features = featureNodeObjects;
    setupObject.columns = columnObjects.map(obj => obj.object);
    setupObject.datatypes = datatypeArray;
    setupObject.returnableIDToTreeID = returnableIDToTreeIDObject;
    setupObject.treeIDToReturnableID = treeIDToReturnableIDObject;
    // Not sending this because it should be in header
    // setupObject.lastModified = Date.now();
    // yay

    // Constructing the final setupMobileObject
    // ===================================================

    //fix-me: add index of user item and organization item
    setupMobileObject.children = [globalItemIndex, auditItemIndex, userItemIndex, orgItemIndex];
    setupMobileObject.subfeatureStartIndex = allFeatures.map((feature) => (feature['ff__table_name'] === null ? false : true)).indexOf(true); // indexOf takes first index to match
    setupMobileObject.items = mobileItemNodeObjects;
    setupMobileObject.features = mobileFeatureNodeObjects;
    setupMobileObject.columns = columnObjects.map(obj => obj.object);
    setupMobileObject.datatypes = datatypeArray;
    setupObject.returnableIDToTreeID = returnableIDToTreeIDObject;
    setupObject.treeIDToReturnableID = treeIDToReturnableIDObject;

    // Construct idValidationLookup
    // ============================================================
                        
    for(let row of returnableQuery) {

        let id = row['r__returnable_id'].toString();

        let isGlobal = (row['non_obs_i__table_name'] === 'item_global' ? true : false);

        idValidationLookup[id] = {
            // feature and root feature
            rootfeature: row['rf__table_name'],
            feature: row['f__table_name'],
            //referenceColumn: row['c__reference_column_name'],
            //referenceTable: row['c__reference_table_name'],
            item: row['i__table_name'],
            referenceType: row['rt__type_name'],
            isFilterable: row['c__is_filterable'],
            selectorType: row['sn__selector_name'],
            isGlobal,

            sqlType: row['sql__type_name'],
            //groundTruthLocation: row['c__is_ground_truth']
            baseItem: row['non_obs_i__table_name']
        }
    }


    
    // Construct featureParents
    // ============================================================
    allFeatures.map((el) => [el['f__table_name'], el['ff__table_name']]).forEach((el) => {
        featureParents[el[0]] = el[1]
    });
    
    // Construct ReturnableIDs
    // ============================================================
    
    // init custom aliases
    let listAlias = ['list_alias_', 0];
    let factorAlias = ['factor_alias_', 0];
    let attributeAlias = ['attribute_alias_', 0];


    for(let row of returnableQuery) {
        
        //  console.log(row)  //
        let selectSQL = null;
        let appendSQL = null;
        let whereSQL = null;

        // See if an item or observation returnable
        const isItemReturnable = row['non_obs_i__table_name'] !== null
        const isObservationReturnable = !isItemReturnable

        // See if item and base item are the same
        const isWithinBaseItem = row['non_obs_i__table_name'] == row['i__table_name']// ? row['i__table_name'] : null

        // Base item table name
        const baseItem = row['non_obs_i__table_name']

        // Get feature table as string
        const feature = row['f__table_name'];

        // Get returnable id as string
        const returnableID = row['r__returnable_id'];

        // Construct returnable id alias to be used in the select clause
        //   we have to do this because aliases cannot start with numbers in SQL
        const returnableIDAlias = 'r' + returnableID

        // Get column tree
        const columnTree = row['r__join_object'].columns;
        
        // Get column ID
        const columnID = row['c__column_id'];

        // Get table tree
        const tableTree = row['r__join_object'].tables;
        
        // Get return type
        const referenceType = row['rt__type_name'];

        // Get data column
        const frontendName = row['r__frontend_name'];

        // Get SQL type
        const sqlType = row['sql__type_name'];

        // Get Selector Type
        const selectorType = row['sn__selector_name'];

        // Get column name and table name
        const columnName = row['c__column_name'];
        const tableName = row['c__table_name'];

        // Get attribute type (null if referenceType != 'attribute')
        const attributeType = row['r__attribute_type'];

        // Writing custom SQL for all of the reference types

        // Auditor coalesce
        if(frontendName == 'Auditor' && referenceType == 'special') {

            appendSQL = 'LEFT JOIN m2m_auditor ON \
                            tdg_observation_count.observation_count_id = m2m_auditor.observation_count_id \
                            LEFT JOIN item_user AS user_auditor_name ON m2m_auditor.item_user_id = user_auditor_name.item_id';

            selectSQL = `COALESCE(ARRAY_AGG(${feature}.data_auditor::TEXT), ARRAY_AGG(CONCAT(user_auditor_name.data_first_name, ' ', user_auditor_name.data_last_name)))`;

        // Standard Operating Procedure
        } else if(frontendName == 'Standard Operating Procedure' && referenceType == 'special') { 

            appendSQL = 'LEFT JOIN m2m_item_sop ON\
                            tdg_observation_count.observation_count_id = m2m_item_sop.observation_count_id \
                            LEFT JOIN item_sop ON m2m_item_sop.item_sop_id = item_sop.item_id'

            selectSQL = formatSQL(`ARRAY_AGG(item_sop.$(columnName:name)::TEXT)`, {
                columnName: columnName
            });

            // Convert to array type for WHERE
            whereSQL = formatSQL('array[$(listAlias:name).$(columnName:name)]', {
                listAlias: listAlias.join(''),
                columnName: columnName
            });

        } else if(referenceType == 'obs-list') {

            appendSQL = formatSQL('LEFT JOIN m2m_$(tableName:raw) \
                                    ON m2m_$(tableName:raw).observation_id = $(feature:name).observation_id \
                                    LEFT JOIN $(tableName:name) AS $(listAlias:name) \
                                    ON $(listAlias:name).list_id = m2m_$(tableName:value).list_id', {
                                        feature: feature, 
                                        tableName: tableName,
                                        listAlias: listAlias.join('')
            });
            
            // Aggregate on SELECT
            selectSQL = formatSQL('ARRAY_AGG($(listAlias:name).$(columnName:name)::TEXT)', {
                listAlias: listAlias.join(''), 
                columnName: columnName,
                returnableID: returnableIDAlias
            });

            // Convert to array type for WHERE
            whereSQL = formatSQL('array[$(listAlias:name).$(columnName:name)]', {
                listAlias: listAlias.join(''),
                columnName: columnName
            });
            
            // add 1 to listAlias number to make a new unique alias
            listAlias[1] += 1;

        } else if(referenceType == 'item-list') {

            appendSQL = formatSQL('LEFT JOIN m2m_$(tableName:raw) \
                                    ON m2m_$(tableName:raw).item_id = $(pgpParam:raw).item_id \
                                    LEFT JOIN $(tableName:name) AS $(listAlias:name) \
                                    ON $(listAlias:name).list_id = m2m_$(tableName:value).list_id', {
                                        pgpParam: isWithinBaseItem ? baseItem: '$(alias:name)', // a little bit weird
                                        tableName: tableName,
                                        listAlias: listAlias.join('')
            });
            
            // Add ARRAY_AGG() here? ... yes, Oliver!
            selectSQL = formatSQL('ARRAY_AGG($(listAlias:name).$(columnName:name)::TEXT)', {
                listAlias: listAlias.join(''), 
                columnName: columnName,
                returnableID: returnableIDAlias
            });

            // Convert to array type for WHERE
            whereSQL = formatSQL('array[$(listAlias:name).$(columnName:name)]', {
                listAlias: listAlias.join(''),
                columnName: columnName
            });
            
            // add 1 to listAlias number to make a new unique alias
            listAlias[1] += 1;

        } else if(['obs'].includes(referenceType)) {

            appendSQL = null;

            selectSQL = formatSQL('$(featureTable:name).$(columnName:name)', {
                featureTable: feature,
                columnName: columnName,
                returnableID: returnableIDAlias
            });

        } else if(['item-id', 'item-non-id'].includes(referenceType)) {

            appendSQL = null;

            selectSQL = formatSQL('$(pgpParam:raw).$(columnName:name)', {
                pgpParam: (isWithinBaseItem ? baseItem : '$(alias:name)'),
                columnName: columnName,
                returnableID: returnableIDAlias
            });
            
        } else if(referenceType == 'item-factor') {

            let factorForeignKey = `${tableName}_id`;

            appendSQL = formatSQL('LEFT JOIN $(factorTableName:name) AS $(factorAlias:name) \
                                       ON $(factorAlias:name).factor_id = $(pgpParam:raw).$(fk:name)', {
                                           factorTableName: tableName,
                                           factorAlias: factorAlias.join(''),
                                           pgpParam: isWithinBaseItem ? baseItem : '$(alias:name)',
                                           fk: factorForeignKey
                                       });
        
            selectSQL = formatSQL('$(factorAlias:name).$(columnName:name)', {
                factorAlias: factorAlias.join(''),
                columnName: columnName,
                returnableID: returnableIDAlias
            });

            // add 1 to factorAlias number to make a new unique alias
            factorAlias[1] += 1;

        } else if(referenceType == 'obs-factor') {

            let factorForeignKey = `${tableName}_id`;

            appendSQL = formatSQL('LEFT JOIN $(factorTableName:name) AS $(factorAlias:name) \
                                       ON $(factorAlias:name).factor_id = $(feature:name).$(fk:name)', {
                                           factorTableName: tableName,
                                           factorAlias: factorAlias.join(''),
                                           feature: feature,
                                           fk: factorForeignKey
                                       });
        
            selectSQL = formatSQL('$(factorAlias:name).$(columnName:name)', {
                factorAlias: factorAlias.join(''),
                columnName: columnName,
                returnableID: returnableIDAlias
            });

            // add 1 to factorAlias number to make a new unique alias
            factorAlias[1] += 1;

        } else if(referenceType == 'attribute') {
            // current means the attribute is referenced by the item

            let attributeForeignKey = `${tableName}_id`;

            // setting item or observation reference depending on attribute type
            /* Warning: complicated
                We first check if this is an item returnable so we can pass the base item right away. In this case there are only
                'current' attribute types because it is not possible to see observed attributes when querying an item

                Then, if it is an observation returnable, we check to see if it is 'observed' (joined to the observation) or 
                'current' (joined to the item) and either pass the observation table itself that we know now, or an alias 
                because it will be joined to the item that the observation is joined to which is assigned an alias when the 
                query is being processed in the dynamicSQLEngine
            */
            let obsOrItem;
            if(isItemReturnable) {
                obsOrItem = baseItem;
            } else {
                obsOrItem = (attributeType == 'observed' ? feature : (attributeType == 'current' ? '$(alias:raw)' : null));
            }
            if(obsOrItem === null) throw Error('Invalid attributeType');

            appendSQL = formatSQL('LEFT JOIN $(attributeTableName:name) AS $(attributeAlias:name) \
                                       ON $(attributeAlias:name).attribute_id = $(obsOrItem:name).$(fk:name)', {
                                           attributeTableName: tableName,
                                           attributeAlias: attributeAlias.join(''),
                                           obsOrItem: obsOrItem,
                                           fk: attributeForeignKey
                                       });

            selectSQL = formatSQL('$(tableName:raw).$(columnName:name)', {
                tableName: attributeAlias.join(''),
                columnName: columnName
            });

            // add 1 to attributeAlias number to make a new unique alias
            attributeAlias[1] += 1;

        } else {
            throw Error('Returnable did not match to a valid reference type: ' + referenceType)
        }

        // Wrap PostGIS type in GeoJSON converter for location types
        if(['Point', 'LineString', 'Polygon'].includes(sqlType)) {
            // Don't convert to GeoJSON in the WHERE clause
            whereSQL = selectSQL;
            // Convert to GeoJSON for returning data
            selectSQL = `ST_AsGeoJSON(${selectSQL})`;
        }

        // Add returnableID to the lookup with key = id
        returnableIDLookup[returnableID] = new ReturnableID(feature, baseItem, returnableID, columnID, columnName, columnTree, tableTree, referenceType, appendSQL, selectSQL, whereSQL, frontendName, sqlType, selectorType)

    }

    
    return({
        setupObject,
        setupMobileObject,
        featureOrder,
        columnOrder,
        itemOrder,
        idValidationLookup,
        featureParents,
        returnableIDLookup,
        columnObjects,
    })
}


const featureReturnableMapper = (returnable, currentPath, treeArray, statics) => {
    // destructure statics
    const {
        featureIndices,
        featureNodeObjects,
        featureOrder,
        itemNodeObjects,
        itemOrder,
        columnObjects,
        columnOrder
    } = statics;
    // if observation returnable
    if(['obs', 'obs-list', 'obs-factor', 'special', 'attribute'].includes(returnable['rt__type_name'])) {
        let isAttribute = false;
        let childrenIndex = 0;
        if(returnable['rt__type_name'] == 'attribute') {
            isAttribute = true;
            childrenIndex = 1;
        }

        // Adding to the local column lookup for spreadsheet generation. Should add all returnableIDs
        // within the search path *except* current attributes, because these reference the item and
        // are static. When attempting to upload current attributes to an observation, it doesn't 
        // throw, but instead always interprets them as observed since they have the same columnID
        if(returnable['r__attribute_type'] !== 'current') {
            observationLocalReturnableLookup[returnable.f__table_name].push(returnable)
        }

        // sanity check
        if(!isAttribute) {
            if(currentPath.length !== 0) throw Error(`ReturnableID: ${returnable['r__returnable_id']} is an observation returnable but has a non zero length joinObject.tables`)
        }
        // push observationColumns index
        treeArray.push(childrenIndex);
        // get columnID of columnObject of returnable
        let columnObjectID = columnObjects.filter(obj => obj.additionalInfo.columnID === returnable['c__column_id']).map(obj => obj.additionalInfo.columnID);
            // sanity check
            if(columnObjectID.length !== 1) throw Error(`Returnable with ID: ${returnable['r__returnable_id']} did not match to one column`);
        // get columnObject index
        let columnObjectIndex = columnOrder.indexOf(columnObjectID[0]);
        // get feature index
        let featureIndex = featureOrder.indexOf(returnable['f__table_name'])
        // get index of columnObject index
        let indexOfColumnObjectIndex = featureNodeObjects[featureIndex].children[childrenIndex].indexOf(columnObjectIndex);
        // push index to tree
        treeArray.push(indexOfColumnObjectIndex);
        // finish
        return({
            returnableID: returnable['r__returnable_id'],
            treeID: treeArray,
            isDefault: returnable['r__is_used']
        })
    } else { // then not an observation or attribute returnable
        // push to tree
        treeArray.push(2);
        // remove observation_... -> item_... from path
        currentPath.splice(0, 2)
        // calling itemReturnableMapper
        return itemReturnableMapper(returnable, currentPath, treeArray, statics);
    }
}


const itemReturnableMapper = (returnable, currentPath, treeArray, statics, hasTraversedNonID = false) => {
    // destructure statics
    const {
        featureIndices,
        featureNodeObjects,
        featureOrder,
        itemNodeObjects,
        itemOrder,
        columnObjects,
        columnOrder
    } = statics;
    // if returnable is within item
    if(currentPath.length == 0) {
        const isLocal = returnable.non_obs_i__table_name === returnable.i__table_name;
        let childrenID;
        // if id-column
        if(['item-id'].includes(returnable['rt__type_name'])) {
            childrenID = 0;
            // FIS lookup handling
            if(!hasTraversedNonID && returnable.non_obs_i__table_name !== null) {
                itemFISLookup[returnable.non_obs_i__table_name].push(returnable)
            }
            if(!hasTraversedNonID && returnable.f__table_name !== null) {
                observationFISLookup[returnable.f__table_name].push(returnable)
            }
        // attribute
        } else if(returnable['rt__type_name'] == 'attribute') {
            if(isLocal) {
                itemLocalReturnableLookup[returnable.non_obs_i__table_name].push(returnable);
            }
            childrenID = 4;
        // non id column
        } else if(['item-non-id', 'item-list', 'item-factor'].includes(returnable['rt__type_name'])) {
            if(isLocal) {
                itemLocalReturnableLookup[returnable.non_obs_i__table_name].push(returnable);
            }
            childrenID = 2;
        } else {
            console.log(returnable)
            throw Error('This shouldn\'t happen...')
        }
        // push the idColumn index
        treeArray.push(childrenID);
            // get columnID of columnObject of returnable
        let columnObjectID = columnObjects.filter(obj => obj.additionalInfo.columnID === returnable['c__column_id']).map(obj => obj.additionalInfo.columnID);
            // sanity check
            if(columnObjectID.length !== 1) throw Error(`Returnable with ID: ${returnable['r__returnable_id']} did not match to one column`);
        // get columnObject index
        let columnObjectIndex = columnOrder.indexOf(columnObjectID[0]);
        // get item index
        let itemIndex = itemOrder.indexOf(returnable['i__table_name']);
        // get index of columnObject index
        let indexOfColumnObjectIndex = itemNodeObjects[itemIndex].children[childrenID].indexOf(columnObjectIndex);
        // push index to tree
        treeArray.push(indexOfColumnObjectIndex);
        // finish
        return({
            returnableID: returnable['r__returnable_id'],
            treeID: treeArray,
            isDefault: returnable['r__is_used']
        });
    } else { // then returnable is not in item
        let fromItem = currentPath[0];
        let toItem = currentPath[1];
        
        // remove item_... -> item_... from path
        currentPath.splice(0, 2);
        // get isID based on the itemM2M
        let isID = itemM2M.filter(m2m => m2m['i__table_name'] === fromItem && m2m['ri__table_name'] === toItem).map(m2m => m2m['m2m__is_id']);
        // sanity check
        if(isID.length !== 1) throw Error(`ReturnableID: ${returnable['r__returnable_id']} did not match to one item to item relation`);
        // if isID
        if(isID[0] === true) {
            // add index to tree
            treeArray.push(1);
            // get item index
            let itemIndex = itemOrder.indexOf(fromItem);
            // get referenced item index
            let parentItemIndex = itemOrder.indexOf(toItem);
            // get itemNodeObject
            let itemNodeObject = itemNodeObjects[itemIndex];
            // get itemNodeObject nonID itemChildNodePointerObjects
            let nonIDPointerObjects = itemNodeObject.children[1];
            // get index of relevant itemChildNodePointerObject
            let pointerIndex = nonIDPointerObjects.map(e => e.index).indexOf(parentItemIndex);
            // add index to tree
            treeArray.push(pointerIndex);
            // call recursively
            return itemReturnableMapper(returnable, currentPath, treeArray, statics, hasTraversedNonID);
        } else {
            // add index to tree
            treeArray.push(3);
            // get item index
            let itemIndex = itemOrder.indexOf(fromItem);
            // get referenced item index
            let parentItemIndex = itemOrder.indexOf(toItem);
            // get itemNodeObject
            let itemNodeObject = itemNodeObjects[itemIndex];
            // get itemNodeObject nonID itemChildNodePointerObjects
            let nonIDPointerObjects = itemNodeObject.children[3];
            // get index of relevant itemChildNodePointerObject
            let pointerIndex = nonIDPointerObjects.map(e => e.index).indexOf(parentItemIndex);
            // add index to tree
            treeArray.push(pointerIndex);
            // call recursively
            return itemReturnableMapper(returnable, currentPath, treeArray, statics, true);
        };
    };
};


const initialReturnableMapper = (returnable, statics) => {
    // destructure statics
    const {
        featureIndices,
        featureNodeObjects,
        featureOrder,
        itemNodeObjects,
        itemOrder,
        columnObjects,
        columnOrder
    } = statics;
    // init treeArray
    let treeArray = [];
    // set current path to joinObject tables
    let currentPath = Array.from(returnable['r__join_object'].tables);

    // if non observational
    if(returnable['f__table_name'] === null) {
        // is global item?        
        if(returnable['non_obs_i__table_name'] == 'item_global') {
            treeArray.push(2);
        } 
        // then a standard item
        else {
            // push item array index
            treeArray.push(1)
            // get index
            treeArray.push(itemOrder.indexOf(returnable['non_obs_i__table_name']))
        }
        // calling itemReturnableMapper
        return itemReturnableMapper(returnable, currentPath, treeArray, statics);
    } else {
        treeArray.push(0);
        // get feature
        let featureName = returnable['f__table_name'];
        // get index of feature
        let featureIndex = featureOrder.indexOf(featureName);
        // get index of index of feature
        featureIndex = featureIndices.indexOf(featureIndex);
        // push index to treeArray
        treeArray.push(featureIndex);
        // calling featureReturnableMapper
        return featureReturnableMapper(returnable, currentPath, treeArray, statics)
    }
};

// CALLING SETUP FUNCTION
// ============================================================
const { 
    returnableIDLookup,
    idValidationLookup,
    featureParents,
    setupObject,
    setupMobileObject,
    featureOrder,
    columnOrder,
    itemOrder,
    columnObjects,
} = await setupQuery(returnableQuery, columnQuery, allItems, itemM2M, frontendTypes, allFeatures);


// Get all of the columns needed to insert the item
const columnIdTableNameLookup = {};
columnObjects.forEach((columnObject) => {
    columnIdTableNameLookup[columnObject.additionalInfo.columnID] = columnObject.additionalInfo.tableName;
});

const columnIdItemLookup = {};
for(let itemData of Object.entries(itemColumnObject)) {
    for(let id of itemData[1].c__column_id) {
        columnIdItemLookup[id] = itemData[0];
    }
}

// Make filterSetupObject
let filterSetupObject = {
    itemColumnObjectIndices: {},
    itemReturnableIDs: {},
    observationColumnObjectIndices: {},
    observationReturnableIDs: {},
};
// go through all returnables and add
for(let returnable of Object.values(returnableIDLookup)) {
    // unpack
    const {
        ID,
        columnID,
        feature,
        baseItem,
    } = returnable;
    // if item
    if(feature === null) {
        // get itemNodeObject index
        const itemNodeObjectIndex = itemOrder.indexOf(baseItem);
        // check if item exists yet
        if(!(itemNodeObjectIndex in filterSetupObject.itemColumnObjectIndices)) {
            filterSetupObject.itemColumnObjectIndices[itemNodeObjectIndex] = [];
            filterSetupObject.itemReturnableIDs[itemNodeObjectIndex] = [];
        }
        // add columnID
        filterSetupObject.itemColumnObjectIndices[itemNodeObjectIndex].push(columnOrder.indexOf(columnID));
        // add returnableID
        filterSetupObject.itemReturnableIDs[itemNodeObjectIndex].push(ID);
    }
    // then observation
    else {
        // get featureNodeObject index
        const featureNodeObjectIndex = featureOrder.indexOf(feature);
        // check if feature exists yet
        if(!(featureNodeObjectIndex in filterSetupObject.observationColumnObjectIndices)) {
            filterSetupObject.observationColumnObjectIndices[featureNodeObjectIndex] = [];
            filterSetupObject.observationReturnableIDs[featureNodeObjectIndex] = [];
        }
        // add columnID
        filterSetupObject.observationColumnObjectIndices[featureNodeObjectIndex].push(columnOrder.indexOf(columnID));
        // add returnableID
        filterSetupObject.observationReturnableIDs[featureNodeObjectIndex].push(ID);
    }
}

//console.log(returnableIDLookup[78]);
//console.log(itemColumnObject['item_sink'])
//console.log(Object.values(returnableIDLookup).filter(id => [34, 44, 49].includes(id.columnID)))
//console.log(Object.values(returnableIDLookup).filter(id => [523].includes(id.columnID)))
//console.log(returnableIDLookup[523])
//console.log(returnableIDLookup.filter(el => el.appendSQL === null && el.joinObject.refs.length != 0))
//console.log(Object.keys(returnableIDLookup))
//console.log(itemColumnObject)
//console.log(observationItemTableNameLookup)    
//fs.writeFileSync(__dirname + '/setupObjectTry1.json', JSON.stringify(setupObject))

return {
    returnableIDLookup,
    idValidationLookup,
    featureParents,
    setupObject,
    setupMobileObject,
    filterSetupObject,
    allItems,
    itemM2M,
    itemColumnObject,
    requiredItemLookup,
    itemTableNames,
    featureTableNames,
    observationHistory,
    itemHistory,
    observationItemTableNameLookup,
    itemObservationTableNameLookup,
    columnObjects,
    columnIdTableNameLookup,
    columnIdItemLookup,
    itemFISLookup,
    observationFISLookup,
    itemLocalReturnableLookup,
    observationLocalReturnableLookup,
};
}

async function writeToFile(db) {
    try {
        var internalObjects = await asyncWrapper(db);
    } catch(err) {
        console.log(err);
        console.log('Preprocessing failed. Exiting')
        process.exit(1);
    }

    fs.writeFileSync(parentDir(__dirname, 1) + (isTemp ? "/TempSchemas/" : "/Schemas/") + database + "/_internalObjects/internalObjects.json", JSON.stringify(internalObjects));
    console.log('Preprocessing finished. Wrote internalObjects.json to /_internalObjects')

    process.exit(0);
}

writeToFile(db);