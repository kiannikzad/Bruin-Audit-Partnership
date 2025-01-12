const fs = require('fs');
const multer = require('multer');
const child = require("child_process");
const archiver = require("archiver");

const {
    createNewDatabase,
    checkDatabaseNameIsValid,
    cleanUpDatabaseGeneration,
    checkApiKeyIsValid,
} = require("./executive.js");
const { parentDir } = require("../utils.js");
const { readInternalObjectsFromDisk } = require('../preprocess/load.js');
const { computeValidationObjects } = require('../parse/validate.js');

const isDeployment = process.argv.some(e => ['-d', '--deploy'].includes(e));

function generationError(type, message, cleanupObject={}) {
    // clean up the temp files asynchronously
    cleanUpDatabaseGeneration(cleanupObject)
    // return error message
    return `GENERATIONERROR: ${JSON.stringify({type, message})}`
}

// 1. Download the CSV, GeoJSON, or JSON file
async function download(req, res, next) {
    // get database name and conversion type from query parameter (a little weird for a 
    // POST request but neccessary because multer must pipe to a file before it reads anything)
    res.locals.dbName = req.query.name;
    res.locals.genType = req.query.type;
    res.locals.dbFeatureName = req.query.featureName;
    res.locals.separator = req.query.separator;
    if(!(res.locals.dbName && /^[A-Za-z ]{4,20}$/.test(res.locals.dbName) && /^[A-Za-z]/.test(res.locals.dbName))) {
        res.write(generationError("Formatting Error", "Database name must contain only letters and spaces and be 4-20 characters."));
        return res.end();
    }
    res.locals.dbSqlName = res.locals.dbName.toLowerCase().replaceAll(" ", "_");

    // First, check for name collision
    const isDatabaseNameValid = await checkDatabaseNameIsValid(res.locals);
    if(!isDatabaseNameValid) {
        res.write(generationError("Formatting Error", "A Database exists with that name, try another."));
        return res.end();
    }

    // At this point we know that a database doesn't exist with the name that has
    // been given, so on arbitrary errors we can wipe everything without risk of data loss
    try {
        
        // set header for streaming response and begin generation stream
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Connection', 'keep-alive');   
        res.write("GENERATIONSTART: " + res.locals.dbSqlName + "\n");

        // get api key if it exists
        const dbApiKey = req.headers["db-api-key"];
        if(dbApiKey) {
            // check for validity
            const isApiKeyValid = await checkApiKeyIsValid(res.locals.executiveDatabaseConnection, dbApiKey);
            if(isApiKeyValid) {
                res.locals.hasValidDbApiKey = true;
            } else {
                res.write(generationError("Authentication Error", "API Key provided is not valid."));
                return res.end();
            }
        } else {
            res.locals.hasValidDbApiKey = false;
        }

        if(res.locals.genType === "CSV") {
            res.locals.uploadFileName = "csv.csv";
        } else if (res.locals.genType === "GeoJSON") {
            res.locals.uploadFileName = "geojson.json";
        } else if (res.locals.genType === "Custom") {
            res.locals.uploadFileName = "custom.json";
        } else {
            res.write(generationError("Formatting Error", "Must use CSV, GeoJSON, or custom JSON."));
            return res.end();
        }
    
        // create temp folder and uploader
        let tempDirName;
        if(res.locals.hasValidDbApiKey) {
            tempDirName = parentDir(__dirname, 1) + "/Schemas/" + res.locals.dbSqlName;
        } else {
            tempDirName = parentDir(__dirname, 1) + "/TempSchemas/" + res.locals.dbSqlName;
        } 
        // make parent dir
        fs.mkdirSync(tempDirName);
        // make schema dir, "default" since entire process is one-shot
        fs.mkdirSync(tempDirName + "/default");
        fs.mkdirSync(tempDirName + "/_internalObjects");
        res.locals.dbTempDirName = tempDirName;
        res.locals.dbLogFileName = res.locals.dbTempDirName + "/default/Schema_Construction_SQL.sql";
        res.locals.dbLogFileNameInsertion = res.locals.dbTempDirName + "/default/Data_Insertion_SQL.sql";
        const fileStorage = multer.diskStorage({
            destination: (req, file, cb) => {
                cb(null, tempDirName + "/default");
            },
            filename: (req, file, cb) => {
                cb(null, file.fieldname);
            }
        })
        const upload = multer({
            storage: fileStorage,
            limits: {fileSize: 1073741824}, // 1 GB limit
            fileFilter: (req, file, cb) => {
                if(file.mimetype !== "text/csv" && file.mimetype !== "application/vnd.ms-excel" && file.mimetype !== "application/json") {
                    cb(new Error("Invalid file type. Must be CSV, GeoJSON, or JSON"));
                } else {
                    cb(null, true);
                }
            }
        }).any();
        // Upload the file
        res.write(`${res.locals.genType} received, uploading... (this might take a minute)\n`)
        const uploadPromise = new Promise((resolve, reject) => {
            upload(req, res, (err) => {
                if(err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
        try {
            await uploadPromise;
            res.locals.fileSize = (await fs.promises.stat(res.locals.dbTempDirName + "/default/" + res.locals.uploadFileName)).size;
            // success, pass to next middleware
            res.write("File successfully uploaded!\n");
            res.write("Starting conversion to TDG objects...\n");
            return next();
        } catch(err) {
            console.log(err);
            res.write(generationError("File Conversion Error", err, {
                cleanFiles: tempDirName
            }))
            return res.end();
        }

    } catch(err) {
        console.log(err)
        res.write(generationError("File Conversion Error", err, {
            cleanFiles: res.locals.dbTempDirName
        }));
        return res.end();
    }
}

// 2. Convert the CSV, GeoJSON, or JSON file to TDG features.jsonc and columns.jsonc objects
function convert(req, res, next) {
    try {
        // if Custom, destructure features, columns, and submission
        if(res.locals.genType === "Custom") {
            res.write("Using custom objects...");
            const obj = JSON.parse(fs.readFileSync(res.locals.dbTempDirName + "/default/custom.json"));
            // write features and columns
            fs.writeFileSync(res.locals.dbTempDirName + "/default/features.jsonc", obj.features);
            fs.writeFileSync(res.locals.dbTempDirName + "/default/columns.jsonc", obj.columns);
            fs.mkdirSync(`${res.locals.dbTempDirName}/submissionsWithoutReturnables`);
            fs.writeFileSync(res.locals.dbTempDirName + "/submissionsWithoutReturnables/submissionObject_1.jsonc", obj.submission);
            return res.next();
        } else {
            // spawn conversion program
            const conversionParams = [
                parentDir(__dirname) + "/construct/convert/converter.js",
                "--parseType=" + res.locals.genType.toLowerCase(),
                "--featureName=" + res.locals.dbFeatureName,
                "--auditorName=" + "TDG Auto-convert",
                "--tempFolderName=" + res.locals.dbTempDirName + "/default"
            ];
            if(res.locals.separator) {
                conversionParams.push("--separator=" + res.locals.separator);
            }
            conversionNodejsProcess = child.execFile("node", conversionParams, (err, stdout, stderr) => {
                if(err) {
                    // clean up
                    console.log(err)
                    res.write(generationError("File Conversion Error", err, {
                        cleanFiles: res.locals.dbTempDirName
                    }));
                    return res.end();
                } else {
                    res.write("File conversion complete!\n");
                    res.write("Starting database construction...\n");
                    return next();
                }
            });
        
            // capture logs
            conversionNodejsProcess.stdout.on("data", (data) => {
                res.write(data);
            });
        }
    } catch(err) {
        console.log(err);
        res.write(generationError("File Conversion Error", err, {
            cleanFiles: res.locals.dbTempDirName
        }));
        return res.end();
    }
}

// 3. Construct a new database from the TDG objects
async function construct(req, res, next) {
    try {
        // 1. Insert row into executive database
        // 2. Create new database and run v6
        const { userPassword, userEmail, deletionTimer } = await createNewDatabase(res);
        res.locals.userEmail = userEmail;
        res.locals.userPassword = userPassword;
        res.locals.deletionTimer = deletionTimer;
    
        res.write("New PostgreSQL database created: " + res.locals.dbSqlName + "\n");
    
        // 3. Run construction script on new database
        const constructionParams = [
            parentDir(__dirname) + "/construct/cli.js",
            "make-schema",
            res.locals.dbSqlName, // database
            "default", // "default" schema for one-shot conversion and generation
            "--postgresdb=" + res.locals.dbSqlName,
            "--streamQueryLogs=" + res.locals.dbLogFileName
        ];
        if(!res.locals.hasValidDbApiKey) {
            constructionParams.push("--temp")
        }
        if(isDeployment) {
            constructionParams.push("--deploy");
        }
        constructionNodejsProcess = child.execFile("node", constructionParams, (err, stdout, stderr) => {
            if(err) {
                // clean up
                console.log(err)
                res.write(generationError("File Conversion Error", err, {
                    cleanFiles: res.locals.dbTempDirName,
                    cleanDatabase: {
                        dbName: res.locals.dbSqlName,
                        executiveDatabaseConnection: res.locals.executiveDatabaseConnection
                    },
                    clearDeletionTimer: res.locals.deletionTimer
                }));
                return res.end();
            } else {
                res.write("Database successfully constructed!\n");
                res.write("Starting data insertion...\n");
                return next();
            }
        })
    
        // capture logs
        constructionNodejsProcess.stdout.on("data", (data) => {
            res.write(data);
        });
    } catch(err) {
        console.log(err)
        res.write(generationError("Database Construction Error", err, {
            cleanFiles: res.locals.dbTempDirName,
            cleanDatabase: {
                dbName: res.locals.dbSqlName,
                executiveDatabaseConnection: res.locals.executiveDatabaseConnection
            },
            clearDeletionTimer: res.locals.deletionTimer
        }));
        return res.end();
    }
}

// 4. Fill the submissionObject with correct returnable IDs
function fillReturnables(req, res, next) {
    try {
        const fillParams = [
            parentDir(__dirname) + "/construct/convert/fillReturnables.js",
            "--featureName=" + res.locals.dbFeatureName,
            "--dbFolderName=" + res.locals.dbTempDirName,
            "--schema=default" 
        ];
        if(isDeployment) {
            fillParams.push("--deploy");
        }
        fillReturnablesNodejsProcess = child.execFile("node", fillParams,
            (err, stdout, stderr) => {
                if(err) {
                    // clean up
                    console.log(err)
                    res.write(generationError("Data Insertion Error", err, {
                        cleanFiles: res.locals.dbTempDirName,
                        cleanDatabase: {
                            dbName: res.locals.dbSqlName,
                            executiveDatabaseConnection: res.locals.executiveDatabaseConnection
                        },
                        clearDeletionTimer: res.locals.deletionTimer
                    }));
                    return res.end();
                } else {
                    res.write("Successfully filled returnables...\n");
                    return next();
                }
            }
        )
    
        // capture logs
        fillReturnablesNodejsProcess.stdout.on("data", (data) => {
            res.write(data);
        });
    } catch(err) {
        console.log(err)
        res.write(generationError("Data Insertion Error", err, {
            cleanFiles: res.locals.dbTempDirName,
            cleanDatabase: {
                dbName: res.locals.dbSqlName,
                executiveDatabaseConnection: res.locals.executiveDatabaseConnection
            },
            clearDeletionTimer: res.locals.deletionTimer
        }));
        return res.end();
    }
}

// 5. Write internalObjects.js to the database folder
function preprocess(req, res, next) {
    try {
        const setupParams = [parentDir(__dirname) + "/preprocess/setup.js", "--database=" + res.locals.dbSqlName, "--no-log"];
        if(!res.locals.hasValidDbApiKey) {
            setupParams.push("--temp");
        }
        if(isDeployment) {
            setupParams.push("--deploy");
        }
        preprocessNodejsProcess = child.execFile("node",
            setupParams,
            (err, stdout, stderr) => {
                if(err) {
                    // clean up
                    console.log(err)
                    res.write(generationError("Data Insertion Error", err, {
                        cleanFiles: res.locals.dbTempDirName,
                        cleanDatabase: {
                            dbName: res.locals.dbSqlName,
                            executiveDatabaseConnection: res.locals.executiveDatabaseConnection
                        },
                        clearDeletionTimer: res.locals.deletionTimer
                    }));
                    return res.end();
                } else {
                    res.write("Successfully completed preprocessing...\n");
                    // Invalidate and reload the preprocess and validation cache
                    readInternalObjectsFromDisk();
                    computeValidationObjects();
                    return next();
                }
            }
        )
    
        // capture logs
        preprocessNodejsProcess.stdout.on("data", (data) => {
            res.write(data);
        });
    } catch(err) {
        console.log(err)
        res.write(generationError("Data Insertion Error", err, {
            cleanFiles: res.locals.dbTempDirName,
            cleanDatabase: {
                dbName: res.locals.dbSqlName,
                executiveDatabaseConnection: res.locals.executiveDatabaseConnection
            },
            clearDeletionTimer: res.locals.deletionTimer
        }));
        return res.end();
    }
}

// 6. Insert the data into the database
function insert(req, res, next) {
    try {
        const insertionParams = [
            parentDir(__dirname) + "/insert/manual.js",
            "--postgresdb=" + res.locals.dbSqlName,
            "--dbFolderName=" + res.locals.dbTempDirName,
            "--schema=default",
            "--streamQueryLogs=" + res.locals.dbLogFileNameInsertion
        ];
        if(isDeployment) {
            insertionParams.push("--deploy");
        }
        insertNodejsProcess = child.execFile("node", insertionParams,
            (err, stdout, stderr) => {
                if(err) {
                    // clean up
                    console.log(err)
                    res.write(generationError("File Conversion Error", err, {
                        cleanFiles: res.locals.dbTempDirName,
                        cleanDatabase: {
                            dbName: res.locals.dbSqlName,
                            executiveDatabaseConnection: res.locals.executiveDatabaseConnection
                        },
                        clearDeletionTimer: res.locals.deletionTimer
                    }));
                    return res.end();
                } else {
                    // First, create and write the zip file
                    res.write("Generating zip file with database image\n");
                    const output = fs.createWriteStream(`${res.locals.dbTempDirName}/${res.locals.dbSqlName}_database_image.zip`);
                    const archive = archiver("zip", {
                        zlib: { level: 6 },
                    });
                    archive.pipe(output);

                    const instructions = "\
TDG database self-generation instructions\n\n\
1. Begin in an environment with PostgreSQL 12 or greater\n\
2. Run Schema_Construction_SQL.sql with psql command line file runner\n\
3. Run Data_Insertion_SQL.sql with psql command line file runner\n\
4. The database is now fully constructed. You may now psql into the SQL command line and run raw SQL commands. To generate raw SQL commands, use the 'Download Query as SQL' button on the Query Data page\n";
                    archive.append(instructions, { name: "INSTRUCTIONS.txt" });

                    archive.file(`${res.locals.dbTempDirName}/default/Schema_Construction_SQL.sql`, { name: "Schema_Construction_SQL.sql" });
                    archive.file(`${res.locals.dbTempDirName}/default/Data_Insertion_SQL.sql`, { name: "Data_Insertion_SQL.sql" });

                    archive.finalize().then(() => {
                        // Done!
                        res.write("GENERATIONSUCCESS: " + JSON.stringify({
                            userPassword: res.locals.userPassword,
                            userEmail: res.locals.userEmail,
                            dbSqlName: res.locals.dbSqlName,
                        }));
                        res.status(201)
                        res.end();
                    });
                }
            }
        )
    
        // capture logs
        insertNodejsProcess.stdout.on("data", (data) => {
            res.write(data);
        });
    } catch(err) {
        console.log(err)
        res.write(generationError("Data Insertion Error", err, {
            cleanFiles: res.locals.dbTempDirName,
            cleanDatabase: {
                dbName: res.locals.dbSqlName,
                executiveDatabaseConnection: res.locals.executiveDatabaseConnection
            },
            clearDeletionTimer: res.locals.deletionTimer
        }));
        return res.end();
    }
}

module.exports = {
    download,
    convert,
    construct,
    fillReturnables,
    preprocess,
    insert,
}