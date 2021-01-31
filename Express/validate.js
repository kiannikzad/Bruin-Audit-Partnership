
/********************
 ******* SETUP ******
 ********************/

const fs = require('fs')

const {idValidationLookup} = require('./setup.js');
let featureItemLookup;

try {
    featureItemLookup = JSON.parse(fs.readFileSync(`${__dirname}/dataRepresentation/schemaAssets/featureItemLookup.json`))
} catch(err) {
    throw Error('Error reading schema assets. Have you constructed the schema yet? Use `npm run construct -- make-schema ...` or `bash ./Express/db/init.sh`')
}

/*
Below is a bunch of generated validation objects which are used in the middleware function below. Validation
is different for the observation query and the item query

*************
** Imports **
*************
idValidationLookup:
    Contains every returnableID and some values for each:
        rootFeature
        feature
        item
        referenceType
        isFilterable
        isSubmission
        sqlType

featureItemLookup:
    Contains every feature and its respective item

******************
** Observation ***
******************
validateObservation:
    Contains every feature and some values for each:
        valid returnableIDs to query
        valid returnableIDs to filter by
        sql type of filterable returnableIDs

globals:
    Contains every submission returnableID:
        filterable submissione returnableIDs
        column returnableIDs

validFeatures
    Array of valid features (just the keys of validateObservation)

**********
** Item **
********** 
validateItem:
    Contains every item and some values for each:
        valid returnableIDs to query
            valid for _item_ if:
                referenceType in item-id, item-non-id, item-list, item-factor, item-location, attribute (current)
                AND
                feature == _item_
                    problem: we want to be able to get data from other items
                    sol: let's try and generate returnables for all items, not just observable items
        valid returnableIDs to filter
        sql type of filterable returnableIDs

validItems:
    Array of valid items (just the keys of validateItem)

*/

// Generate globals
var globals = {
    filter: [],
    column: []
};

for (let id in idValidationLookup) { //>>>>>>>>>>>>>>>>>>  is_submission
    if (idValidationLookup[id].isSubmission === true) {
        globals.column.push(parseInt(id));
        if(idValidationLookup[id].isFilterable === true) {
            globals.filter.push(parseInt(id));
        };
    };
};

// Dynamically generating validateObservation and validateItem by
// looping through all ids in idValidationLookup
var validateObservation = {};
var validateItem = {};

for (let id in idValidationLookup) {
    
    // Removing globals
    if(idValidationLookup[id].feature === null && idValidationLookup[id].rootfeature === null) {
        continue
    }

    // Getting the root feature
    let feature = (idValidationLookup[id].rootfeature === null ? idValidationLookup[id].feature : idValidationLookup[id].rootfeature)

    // if empty or feature not included yet, initialize column and filter array for new feature
    if(!Object.keys(validateObservation).includes(feature)) {
        validateObservation[feature] = {
            column: [],
            filter: [],
            sqlType: []
        };
    }

    let idToInt = parseInt(id); // in case id isn't already an int
    validateObservation[feature]['column'].push(idToInt);
    
    if (idValidationLookup[id].isFilterable) {
        validateObservation[feature]['filter'].push(idToInt);
        validateObservation[feature]['sqlType'].push(idValidationLookup[id].sqlType);
    }
}

let validFeatures = Object.keys(validateObservation);
let validItems = Object.keys(validateItem);


/********************/
//console.log(featureItemLookup);

//console.log('idValidationLookup', idValidationLookup);
//console.log('validate', validateObservation)
//console.log('globals', globals);
//console.log('validateFeatures', validFeatures);








// Returns a validation middleware function depending on the initialization parameters
function validationConstructor(init) {
 
    // if item use item validation objects
    if(init == 'item') {

        return itemOrObservation(validateItem, null, validItems)

    // if observation use observation object
    } else if(init == 'observation') {

        return itemOrObservation(validateObservation, globals, validFeatures)

    // else throw
    } else {

        throw Error('Invalid validationConstructor initialization');

    }
    

    function itemOrObservation(validate, globals, validateFeatures) {

        //// `V`alidate request feature, columns, and filters ////
        return (req, res, next) => {

            // item_... or obs_... depending on endpoint
            let feature = (init == 'item' ? 'item_' + res.locals.parsed.features : 'observation_' + res.locals.parsed.features);
            let universalFilters = res.locals.parsed.universalFilters;


            if(!validateFeatures.includes(feature)) {
                return res.status(400).send(`Bad Request 2201: ${feature} is not a valid feature`);
            };

            // Validate columns for feature

            for(let column of res.locals.parsed.columns) {
                if(!validate[feature]['column'].includes(parseInt(column)) && !globals.column.includes(parseInt(column))) {
                    return res.status(400).send(`Bad Request 2202: ${column} is not a valid column for the ${feature} feature`);
                };
            };

            // Validate filters for feature and operators for filters

            let index = 0;
            let filterIDKeys = Object.keys(res.locals.parsed.filters);    

            for(let filter of filterIDKeys) {
                // if not a valid filter for this feature or not a global filter
                if(!validate[feature]['filter'].includes(parseInt(filter)) && !globals.filter.includes(parseInt(filter))) { 
                    return res.status(400).send(`Bad Request 2203: ${filter} is not a valid filter for the ${feature} feature`);
                } else {
                    let operator = res.locals.parsed.filters[filter]['operation'];
                    let field = res.locals.parsed.filters[filter]['value'];

                    if(validate[feature]['sqlType'][index] == 'TEXT') {
                        if(operator != '=' && operator != 'Exists' && operator != 'Does not exist') {
                            return res.status(400).send(`Bad Request 2204: ${operator} is not a valid operator for the ${filter} filter`);
                        }
                        field.forEach(function(item) {
                            if(!isText(item)) {
                                return res.status(400).send(`Bad Request 1604: Field for id: ${filter} must be text`);
                            }
                        });
                    } else if(validate[feature]['sqlType'][index] == 'NUMERIC') {
                        field.forEach(function(item) {
                            if(!isNumber(item)) {
                                return res.status(400).send(`Bad Request 1605: Field for id: ${filter} must be numeric`);
                            }
                        });
                    } else if(validate[feature]['sqlType'][index] == 'TIMESTAMPTZ') {
                        field.forEach(function(item) {
                            if(!isValidDate(item)) {
                                return res.status(400).send(`Bad Request 1606: Field for id: ${filter} must be a valid date in mm-dd-yyyy format`);
                            }
                        });
                    }
                }
                index++;
            };

            var filters = Object.keys(universalFilters);
            // Validate universalFilters query
            if (hasDuplicates(filters)) {
                return res.status(400).send(`Bad Request 2205: Cannot have duplicate filters.`);
            } else if(filters.includes('sorta') && filters.includes('sortd')) {
                return res.status(400).send(`Bad Request 2206: Cannot use both sorta and sortd.`);
            } else if(filters.includes('offset') && (!filters.includes('sorta') && !filters.includes('sortd'))) {
                return res.status(400).send(`Bad Request 2207: Offset requires either sorta or sortd.`);
            } else if(filters.includes('limit') && !filters.includes('offset')) {
                return res.status(400).send(`Bad Request 2208: Limit requires offset.`);
            }

            // Validate universalFilters input fields
            for(let filter of filters) {
                // Validate field
                if (filter == 'limit' && !isPositiveIntegerOrZero(universalFilters[filter])) {
                    return res.status(400).send(`Bad Request 2209: Field for ${filter} must be zero or a postiive integer.`);
                } else if (filter == 'offset' && !isPositiveInteger(universalFilters[filter])) {
                    return res.status(400).send(`Bad Request 2210: Field for ${filter} must be a postiive integer.`);
                } else if (filter == 'sorta' || filter == 'sortd') {
                    if (!validate[feature]['column'].includes(parseInt(universalFilters[filter])) && !globals.filter.includes(parseInt(universalFilters[filter]))) {
                        return res.status(400).send(`Bad Request 2210: Field for ${filter} must be a positive integer.`);
                    }
                }
            }

            // Passing to query.js
            next();
        }

    }

}

//// Helper validation functions ////

function hasDuplicates(array) {
    return (new Set(array)).size !== array.length;
}

function isText(field) {
    if(!/^[a-zA-Z]+$/.test(field)) {
        return false;
    }
    return true;
}

function isNumber(field) {
    if(!/^[1-9]+$/.test(field)) {
        return false;
    }
    return true;
}

function isValidDate(field)
{
    var matches = /^(\d{1,2})[-](\d{1,2})[-](\d{4})$/.exec(field);
    if (matches == null) return false;
    var d = matches[2];
    var m = matches[1] - 1;
    var y = matches[3];
    var composedDate = new Date(y, m, d);
    return composedDate.getDate() == d &&
            composedDate.getMonth() == m &&
            composedDate.getFullYear() == y;
}

function isPositiveIntegerOrZero(field) {
    var n = Math.floor(Number(field));
    return n !== Infinity && String(n) === field && n >= 0;
}

function isPositiveInteger(field) {
    var n = Math.floor(Number(field));
    return n !== Infinity && String(n) === field && n > 0;
}

function isValidEmail(email) {
    if(/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+$/.test(email)) {
        return true
    } else {
        return false
    }
}

module.exports = {
    validationConstructor,
    hasDuplicates,
    isText,
    isNumber,
    isValidDate,
    isValidEmail
};