qmongo
======

Greatly simplified no-frills very fast mongodb driver for nodejs.


        var Qm = require('qm');
        var qm = new Qm(socket);
        qm.auth(username, password, database, function(err, db) {
            db.useCollection('admin', 'users');
            db.find(
        })

Api
---

qmongo.connect( url, options, callback(err, qm) )

new qmongo.QMongo( socket [,options] )

qm.auth( username, password, database )

qm.useCollection( [dbName,] collectionName )

qm.find( query, options, callback(err, documents) )


Options:
- skip
- limit
- raw

qm.runCommand( cmd, args, callback(err, reply) )
