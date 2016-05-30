qmongo
======

Simple mongodb driver for nodejs, similar to `mongodb`.

        var creds = "mongodb://user:pass@host/database";
        qmongo.connect(creds, function(err, qm) {
            var query = { };
            qm.db('test').collection('test').find(query).toArray(function(err, docs) {
                // retrieved documents in docs
            })
        })


Api
---

### qmongo

#### qmongo.connect( credsString, [options,] callback(err, qm) )

### QMongo

#### qm.db( dbName )

#### qm.auth( username, password, database )

#### qm.useCollection( [dbName,] collectionName )

#### qm.find( query, [options], [callback(err, cursor)] )

#### qm.runCommand

#### qm.close( )

### Db

#### db.collection( collectionName )

#### db.runCommand

#### db.close( )

### Collection

#### collection.find( query, options, [callback(err, cursor)] )

#### cursor.toArray( callback(err, documentsArray) )

#### cursor.nextObject( callback(err, item) )

#### cursor.close( )


Related Work
------------

- [mongodb](https://npmjs.org/package/mongodb) - the official driver
- [mongolian](https://npmjs.org/package/mongolian) - simple alternate driver, no longer maintained
- [qmongo](https://github.com/andrasq/node-qbson) - this one
- [qbson](https://github.com/andrasq/node-qbson) - fast BSON encoding/decoding and implementation notes
