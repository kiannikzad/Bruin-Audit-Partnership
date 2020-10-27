// DATABASE CONNECTION AND QUERY //
// ============================================================
// We need to query the metadata tables at the beginning of each session to get data for the setup object,
// querying, upload, and more. Everything that queries the metadata tables to recieve this information
// should go here and then the other files can import the information
// ============================================================
// pg-promise library for async database queries and promise based wrapper
// only used in this file for helpers, not querying
const pgp = require("pg-promise")();

// pg-native for native libpq C library bindings which we need for sync queries
const Client = require('pg-native')
const client = new Client()
// sync connecting to the database
client.connectSync('host=localhost port=5432 dbname=meta connect_timeout=5')

/* TO DO
close the db connection!

joinPath Generation

add alias to selectSQL 

We impose that:
    no item can reference a location type more than once

test: each feature has exactly one returnableID with realGeo === true

either joinSQL and joinObject where joinObject is put through rRS and joinObject as appended
    or 

in:
    column, table, and item (to get metadata_column)
    feature to query

if location:
    columnArray.push('location_id', `${tableName}_id`)
    tableArray.push(tableName, itemTableName)

if item-list:
    samika's code

So, what do we have to do?
joinCols and joinTabs stay the same

appendSQL 
'$(inputAlias:name) <some SQL> $(outputAlias:name)'
standard:
null

selectSQL
'<some SQL> $(joinAlias:name).columnName'
standard:
'$(joinAlias:name).columnName'


// construct the joinObject based on the reference type
        {
            columns: Array,
            tables: Array,
            appendSQL: String,
            selectSQL: String
        }
        switch (col.ReferenceTypeName) {
            case 'item-id':
                // in item
                joinObject.selectSQL = pgp.as.format('a$(alias:raw).$(columnName:raw) AS $(returnableAlias:raw)', {
                    returnableAlias: returnableID,
                    columnName: col.columnName
                });
                break;
            case 'item-non-id':
                // in item 
                joinObject.selectSQL = pgp.as.format('a$(alias:raw).$(columnName:raw)', {
                    alias: returnableID,
                    columnName: col.columnName
                });
                break;
            case 'item-list':
                // list
                joinObject.selectSQL = pgp.as.format('a$(listTableName:raw).$(columnName:raw)', {
                    listTableName: col.tableName,
                    columnName: col.columnName
                });
                // needs custom SQL for join
                joinSQL = pgp.as.format('INNER JOIN m2m_$(listTableName:raw) \
                                        ON m2m_$(listTableName:raw).item_id = $(alias:raw).item_id \
                                        INNER JOIN $(listTableName:raw) \
                                        ON $(listTableName:raw).list_id = m2m_$(listTableName:raw).list_id', {
                    listTableName: col.tableName, 
                    alias: returnableID
                })
                break;
            case 'item-location':
                joinObject.selectSQL = pgp.as.format('a$(locationTableName:raw).$(columnName:raw)', {
                    locationTableName: ,
                    columnName: col.columnName
                });
                break;
            case 'item-factor':
                break;
            case 'obs':
                break;
            case 'obs-global':
                break;
            case 'obs-list':
                break;
            case 'obs-factor':
                break;
            case 'special':
                break;
            case 'attribute':
                break;
        }







*/
function generateJoins(column, table, item, feature) {
    
}

// QUERIES //
// ==================================================
/*
let rawQuery = client.querySync('SELECT f.table_name as f__table_name, f.num_feature_range as f__num_feature_range, f.information as f__information, \
                                 f.frontend_name as f__frontend_name, rf.table_name as rf__table_name, c.column_id as c__column_id, c.frontend_name as c__frontend_name, c.column_name as c__column_name, \
                                 c.table_name as c__table_name, c.reference_column_name as c__reference_column_name, c.reference_table_name as c__reference_table_name, \
                                 c.information as c__information, c.is_nullable as c__is_nullable, c.is_default as c__is_default, c.is_global as c__is_global, \
                                 c.is_ground_truth as c__is_ground_truth, fs.selector_name as fs__selector_name, ins.selector_name as ins__selector_name, \
                                 sql.type_name as sql__type_name, rt.type_name as rt__type_name, ft.type_name as ft__type_name, ft.type_description as ft__type_description \
                                 FROM metadata_column as c \
                                 LEFT JOIN metadata_feature AS f ON c.feature_id = f.feature_id \
                                 LEFT JOIN metadata_feature AS rf ON c.rootfeature_id = rf.feature_id \
                                 LEFT JOIN metadata_selector AS fs ON c.filter_selector = fs.selector_id \
                                 LEFT JOIN metadata_selector AS ins ON c.input_selector = ins.selector_id \
                                 LEFT JOIN metadata_sql_type AS sql ON c.sql_type = sql.type_id \
                                 LEFT JOIN metadata_reference_type AS rt ON c.reference_type = rt.type_id \
                                 LEFT JOIN metadata_frontend_type AS ft ON c.frontend_type = ft.type_id');

                                 */

let returnableQuery = client.querySync('SELECT \
                                        \
                                        f.table_name as f__table_name, f.num_feature_range as f__num_feature_range, f.information as f__information, \
                                        f.frontend_name as f__frontend_name, \
                                        \
                                        rf.table_name as rf__table_name, \
                                        \
                                        c.column_id as c__column_id, c.frontend_name as c__frontend_name, c.column_name as c__column_name, c.table_name as c__table_name, \
                                        c.observation_table_name as c__observation_table_name, c.subobservation_table_name as c__subobservation_column_name, \
                                        c.information as c__information, c.is_nullable as c__is_nullable, c.is_default as c__is_default, c.accuracy as c__accuracy, \
                                        \
                                        fs.selector_name as fs__selector_name, \
                                        ins.selector_name as ins__selector_name, \
                                        sql.type_name as sql__type_name, \
                                        rt.type_name as rt__type_name, \
                                        ft.type_name as ft__type_name, ft.type_description as ft__type_description, \
                                        \
                                        r.returnable_id as r__returnable_id, r.frontend_name as r__frontend_name, r.is_used as r__is_used, r.join_object as r__join_object, r.is_real_geo as r__is_real_geo, \
                                        \
                                        i.table_name as i__table_name, i.frontend_name as i__frontend_name \
                                        \
                                        FROM metadata_column as c \
                                        LEFT JOIN metadata_returnable AS r ON c.column_id = r.column_id \
                                        LEFT JOIN metadata_feature AS f ON r.feature_id = f.feature_id \
                                        LEFT JOIN metadata_feature AS rf ON r.rootfeature_id = rf.feature_id \
                                        LEFT JOIN metadata_selector AS fs ON c.filter_selector = fs.selector_id \
                                        LEFT JOIN metadata_selector AS ins ON c.input_selector = ins.selector_id \
                                        LEFT JOIN metadata_sql_type AS sql ON c.sql_type = sql.type_id \
                                        LEFT JOIN metadata_reference_type AS rt ON c.reference_type = rt.type_id \
                                        LEFT JOIN metadata_item AS i ON c.metadata_item_id = i.item_id \
                                        LEFT JOIN metadata_frontend_type AS ft ON c.frontend_type = ft.type_id');

let columnQuery = client.querySync('SELECT \
                                    \
                                    c.column_id as c__column_id, c.frontend_name as c__frontend_name, c.column_name as c__column_name, c.table_name as c__table_name, \
                                    c.observation_table_name as c__observation_table_name, c.subobservation_table_name as c__subobservation_column_name, \
                                    c.information as c__information, c.is_nullable as c__is_nullable, c.is_default as c__is_default, c.accuracy as c__accuracy, \
                                    \
                                    fs.selector_name as fs__selector_name, \
                                    ins.selector_name as ins__selector_name, \
                                    sql.type_name as sql__type_name, \
                                    rt.type_name as rt__type_name, \
                                    ft.type_name as ft__type_name, ft.type_description as ft__type_description, \
                                    \
                                    i.table_name as i__table_name, i.frontend_name as i__frontend_name \
                                    \
                                    FROM metadata_column as c \
                                    LEFT JOIN metadata_selector AS fs ON c.filter_selector = fs.selector_id \
                                    LEFT JOIN metadata_selector AS ins ON c.input_selector = ins.selector_id \
                                    LEFT JOIN metadata_sql_type AS sql ON c.sql_type = sql.type_id \
                                    LEFT JOIN metadata_reference_type AS rt ON c.reference_type = rt.type_id \
                                    LEFT JOIN metadata_item AS i ON c.metadata_item_id = i.item_id \
                                    LEFT JOIN metadata_frontend_type AS ft ON c.frontend_type = ft.type_id');

let allItems = client.querySync('SELECT i.table_name as i__table_name, i.frontend_name as i__frontend_name, t.type_name as t__type_name, \
                                 i.creation_privilege as i__creation_privilege \
                                 FROM metadata_item AS i \
                                 LEFT JOIN metadata_item_type AS t ON i.item_type = t.type_id');

let itemM2M = client.querySync('SELECT i.table_name as i__table_name, i.frontend_name as i__frontend_name, t.type_name as t__type_name, \
                                i.creation_privilege as i__creation_privilege, \
                                m2m.is_id as m2m__is_id, m2m.is_nullable as m2m__is_nullable, m2m.frontend_name as m2m__frontend_name, \
                                ri.table_name as ri__table_name \
                                FROM metadata_item AS i \
                                LEFT JOIN metadata_item_type AS t ON i.item_type = t.type_id \
                                INNER JOIN m2m_metadata_item AS m2m ON m2m.item_id = i.item_id \
                                INNER JOIN metadata_item AS ri ON m2m.referenced_item_id = ri.item_id');

let frontendTypes = client.querySync('SELECT type_name FROM metadata_frontend_type');

let allFeatures = client.querySync('SELECT f.table_name as f__table_name, f.num_feature_range as f__num_feature_range, f.information as f__information, \
                                    f.frontend_name as f__frontend_name, ff.table_name as ff__table_name, \
                                    i.table_name as i__table_name, i.frontend_name as i__frontend_name \
                                    FROM metadata_feature AS f \
                                    LEFT JOIN metadata_feature as ff ON f.parent_id = ff.feature_id \
                                    LEFT JOIN metadata_item as i ON f.observable_item_id = i.item_id');




// CALLING SETUP FUNCTION AND EXPORTING
// ============================================================
const {returnableIDLookup, idColumnTableLookup, featureParents, setupObject} = setupQuery(rawQuery, frontendTypes, allFeatures)

console.log(idColumnTableLookup)
//console.log(returnableIDLookup)
    
module.exports = {
    returnableIDLookup: returnableIDLookup,
    idColumnTableLookup: idColumnTableLookup,
    featureParents: featureParents,
    sendSetup: sendSetup
}




// RETURNABLE ID CLASS
// ============================================================
class ReturnableID {
    constructor(feature, ID, columnTree, tableTree, returnType, joinSQL, selectSQL, dataColumn) {
        this.ID = ID
        this.feature = feature
        this.dataColumn = dataColumn
        this.returnType = returnType
        this.joinSQL = joinSQL
        this.selectSQL = selectSQL

        this.joinObject = this.makeJoinObject(columnTree, tableTree, ID)

        Object.freeze(this)
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

            // recursiveReferenceSelection input. Note parentAlias is always input as -1 because the function
            // selects references from the feature_... table and builds out. -1 indicates a join to this table
            return {parentAlias: -1, ID: ID, refs: joinListArray}
        }
    }
}




// HOISTED FUNCTIONS //
// ============================================================

function setupQuery(rawQuery, frontendTypes, allFeatures) {

    let returnableIDLookup = [];
    let idColumnTableLookup = {};
    let featureParents = {};
    let setupObject = {};

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
    


    const datatypeArray = ['hyperlink', 'string', 'bool'];

    // Construct columnObjects
    // ==================================================
    const columnOrder = columnQuery.map(row => row['c__column_id']);

    let columnObjects = columnQuery.map((row, i) => {

        // filterSelector
        let fSelector = (row['fs__selector_name'] === null ? null : {selectorKey: row['fs__selector_name'], selectorValue: null})

        // inputSelector
        let iSelector = (row['ins__selector_name'] === null ? null : {selectorKey: row['ins__selector_name'], selectorValue: null})

        // datatype
        let datatype = datatypeArray.indexOf(row['ft__type_name'])
        
        return(
            {
                additionalInfo: {
                    observation: row['c__observation_table_name'],
                    subobservation: row['c__subobservation_table_name'],
                    item: row['i__table_name'],
                    columnID: row['c__column_id'],
                    columnName: row['c__column_name'],
                    tableName: row['c__table_name'],
                    referenceType: row['rt__type_name'],
                    columnID: row['c__column_id']
                },
                object: {
                    default: row['c__is_default'],
                    frontendName: row['c__frontend_name'],
                    filterSelector: fSelector,
                    inputSelector: iSelector,
                    datatype: datatype,
                    nullable: row['c__is_nullable'],
                    information: row['c__information'],
                    accuracy: row['c__accuracy']
                }
            }
        );
    });
    // Construct itemNodeObject
    // ==================================================
    /*
    {
        “children”: [[Number,...], [itemChildNodePointerObject,...], [Number,...], \ 
                    [itemChildNodePointerObject,...]],
        “frontendName”: String,
        “information”: String 
    }

    {
        “children”: ID columns indexes, ID itemNodeObject indexes,
                    nonID column indexes, non ID itemNodeObject indexes
        “frontendName”: 
        “information”: 
    } */

// INFO: item information does not exist right now

    const itemOrder = allItems.map(row => row['i__table_name']);

    

    let itemNodeObjects = allItems.map(item => {
        // getting frontend name
        let frontendName = item['i__frontend_name'];

        // getting non-id columns
        const nonIDColumns = columnObjects.filter(col => col.additionalInfo.item === item['i__table_name'] && ['item-non-id', 'item-list', 'item-location', 'item-factor'].includes(col.additionalInfo.referenceType));

        // non-id column indices
        const nonIDColumnIndices = nonIDColumns.map(col => columnOrder.indexOf(col.additionalInfo.columnID));

        // getting id columns
        const IDColumns = columnObjects.filter(col => col.additionalInfo.item === item['i__table_name'] && ['item-id'].includes(col.additionalInfo.referenceType));

        // id column indices
        const IDColumnIndices = IDColumns.map(col => columnOrder.indexOf(col.additionalInfo.columnID));

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

        return ({
            children: [IDColumnIndices, IDitemChildNodePointerObjects, nonIDColumnIndices, nonIDitemChildNodePointerObjects],
            frontendName: row['i__frontend_name']
        })
    });



    /*

    featureNodeObject
    {
        “children”: [[Number,...], [Number,...], Number],
        “frontendName”: String,
        “information”: String,
        //“numFeatureRange”: Number|NULL,
        //ground truth location
        “featureChildren”: [Number,...]
    }

    {
        “children”: observationColumns, attributeColumns, itemIndex
        “frontendName”: 
        “information”: 
        //“numFeatureRange”: 
        //ground truth location
        “featureChildren”: indexes of feature children
    }

    */
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

    let featureNodeObjects = allFeatures.map((el) => {

        let frontendName = el['f__frontend_name']
        let information = el['f__information']
        let numFeatureRange = el['f__num_feature_range'] 

        // get array of children
        let directChildren = (el['ff__table_name'] === null ? parentSubfeatureLookup[el['f__table_name']] : [])
        // get indicies
        directChildren = directChildren.map((child) => featureOrder.indexOf(child))

        // observation columns
        // filter on observable reference type and column item matching feature item
        let observationColumns = columnObjects.filter(e => ['obs', 'obs-list', 'obs-factor', 'obs-global', 'special'].includes(e.additionalInfo.referenceType) && el['i__table_name'] === e.additionalInfo.item);

        // observation column indicies
        let observationColumnIndices = observationColumns.map(col => columnOrder.indexOf(col.additionalInfo.columnID));

        // attribute columns
        // filter on attribute reference type and column item matching feature item
        let attributeColumns = columnObjects.filter(e => ['attribute'].includes(e.additionalInfo.referenceType) && el['i__table_name'] === e.additionalInfo.item);

        // attribute column indicies
        let attributeColumnIndices = attributeColumns.map(col => columnOrder.indexOf(col.additionalInfo.columnID));

        // observable item
        let observableItem = el['i__table_name'];

        // observable item index
        let observableItemIndex = itemOrder.indexOf(observableItem);

// INFO: numFeatureRange is commented out
        return({
            children: [observationColumnIndices, attributeColumnIndices, observableItemIndex],
            frontendName: frontendName,
            information: information,
            // numFeatureRange: numFeatureRange,
            featureChildren: directChildren
        })
    })





    setupObject.subfeatureStartIndex = allFeatures.map((feature) => (feature['ff__table_name'] === null ? false : true)).indexOf(true);
    setupObject.globalColumns = columnObjects.filter((row) => row[0] === true).map((row) => row[1]);
    setupObject.datatypes = frontendTypes;
    setupObject.featureColumns = featureColumns;


    // Construct idColumnTableLookup
    // ============================================================                                  
    for(let row of rawQuery) {

        let id = row['c__column_id'].toString();

        let filterable = (row['fs__selector_name'] === null ? false : true)

        idColumnTableLookup[id] = {
            column: row['c__column_name'],
            table: row['c__table_name'],
            rootfeature: row['rf__table_name'],
            feature: row['f__table_name'],
            referenceColumn: row['c__reference_column_name'],
            referenceTable: row['c__reference_table_name'],
            filterable: filterable,
            sqlType: row['sql__type_name'],
            groundTruthLocation: row['c__is_ground_truth']
        }
    }

    // Construct featureParents
    // ============================================================
    allFeatures.map((el) => [el['f__table_name'], el['ff__table_name']]).forEach((el) => {
        featureParents[el[0]] = el[1]
    });

    // Construct returnableIDs
    // ============================================================
    for(let row of rawQuery) {
        
        //  console.log(row)  //
        let selectSQL = null;
        let joinSQL = null;

        // Get feature table as string
        const feature = row['f__table_name']

        // Get column id as string
        const ID = row['c__column_id'];

        // Get column tree
        const columnTree = row['c__reference_column_name']
        //console.log(columnTree) 

        // Get table tree
        const tableTree = row['c__reference_table_name']
        
        // Get return type
        const returnType = row['rt__type_name']

        // Get data column
        const dataColumn = row['c__column_name']

        // Writing custom SQL for custom queries
        // Auditor Name coalesce
        if(row['c__frontend_name'] == 'Auditor Name' && row['rt__type_name'] == 'special') {

            joinSQL = 'LEFT JOIN tdg_auditor_m2m ON \
                            tdg_observation_count.observation_count_id = tdg_auditor_m2m.observation_count_id \
                            INNER JOIN tdg_users AS tdg_users_auditor_name ON tdg_auditor_m2m.user_id = tdg_users_auditor_nameuser_id';

            selectSQL = "COALESCE($(feature:value).data_auditor, concat_ws(' ', tdg_users_auditor_name.data_first_name, tdg_users_auditor_name.data_last_name))";

        // Standard Operating Procedure
        } else if(row['c__frontend_name'] == 'Standard Operating Procedure' && row['rt__type_name'] == 'special') { 

            joinSQL = 'LEFT JOIN tdg_sop_m2m ON\
                            tdg_observation_count.observation_count_id = tdg_sop_m2m.observation_count_id \
                            INNER JOIN tdg_sop ON tdg_sop_m2m.sop_id = tdg_sop.sop_id'

            selectSQL = 'tdg_sop.data_name'

        } else if(row['rt__type_name'] == 'obs-list') {

            joinSQL= pgp.as.format('INNER JOIN $(tableName:value)_m2m \
                                    ON $(tableName:value)_m2m.observation_id = $(feature:value).observation_id \
                                    INNER JOIN $(tableName:value) \
                                    ON $(tableName:value).list_id = $(tableName:value)_m2m.list_id', {feature: row['f__table_name'], tableName : row['c__table_name']})
        
            // Add STRING_AGG() here? ... yes, Oliver!
            selectSQL = pgp.as.format('$(table:value).$(column:value)', {table:row['c__table_name'], column: row['c__column_name']})
            

        } else {
            selectSQL = `$(table:value).${row['c__column_name']}`
        }

        // Add returnableID to the lookup with key = id
        returnableIDLookup.push(new ReturnableID(feature, ID, columnTree, tableTree, returnType, joinSQL, selectSQL, dataColumn))

    }

    // for record in metadata
        //if special type
            //custom sql


    return({
        setupObject: setupObject,
        idColumnTableLookup: idColumnTableLookup,
        featureParents: featureParents,
        returnableIDLookup: returnableIDLookup
    })
}

function sendSetup(req, res) {

    var serverLastModified = Date.now() // for now

    let cycleTime = Date.now() - res.locals.cycleTime[0]
    console.log(`Sent setupObject in ${cycleTime} ms`)
    
    // Check last modified
    // if(res.locals.parsed['lastModified'] < serverLastModified) { // setup is new
    if(true) {

        setupObject['setupLastModified'] = serverLastModified
        return res.status(200).json(setupObject) //send object
        
    } else {

        setupObject['setupLastModified'] = serverLastModified
        return res.status(304).json(setupObject) //send object - not modified

    }
}



