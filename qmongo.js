// testing...

'use strict';

module.exports = QMongo;
module.exports.Db = Db;                         // type returned by qmongo.db()
module.exports.Collection = Collection;         // type returned by qmongo.db().collection()
module.exports.Cursor = null;                   // placeholder for find()


var net = require('net');
var util = require('util');
var crypto = require('crypto');

var QBuffer = require('qbuffer');
var utf8 = require('./utf8');
var qbson = require('./qbson');

var putInt32 = qbson.encode.putInt32;
var getUInt32 = qbson.decode.getUInt32;
var getBsonEntities = qbson.decode.getBsonEntities;     // bson_decode of mongodump concat data
var encodeEntities = qbson.encode.encodeEntities;       // bson_encode into buffer

function QMongo( socket, options ) {
    if (!options) options = {};
    this.dbName = options.database || 'test';
    this.collectionName = options.collection || 'test';
    this.socket = socket;
    this.callbacks = new Object();
    this.batchSize = options.batchSize || 400;
    this.qbuf = new QBuffer({ encoding: null });
    this._closed = false;
    this._dispatchRunning = false;
}


// requst opCodes from https://docs.mongodb.com/v3.0/reference/mongodb-wire-protocol/
var OP_REPLY = 1;               // Reply to a client request. responseTo is set.
var OP_MSG = 1000;              // Generic msg command followed by a string.
var OP_UPDATE = 2001;           // Update document.
var OP_INSERT = 2002;           // Insert new document.
//var OP_GET_BY_ID = 2003;      // Formerly used for OP_GET_BY_OID.  Reserved.
var OP_QUERY = 2004;            // Query a collection.
var OP_GET_MORE = 2005;         // Get more data from a query. See Cursors.
var OP_DELETE = 2006;           // Delete documents.
var OP_KILL_CURSORS = 2007;     // Notify database that the client has finished with the cursor.

var FL_R_QUERY_FAILURE = 2;     // QueryFailure response flag


function MongoError(){
    Error.call(this);
}
util.inherits(MongoError, Error);


// mongodb://[username:password@]host1[:port1][,host2[:port2],...[,hostN[:portN]]][/[database][?options]]
// we currently support mongodb://[username:password@]hostname[:port][/[database]]
var connectionPattern = new RegExp(
    "mongodb:\/\/" +            // mongodb://, required
    "(([^:]*)(:(.*))?@)?" +     // username[2]:password[4], optional
    "([^:/]*)(:([0-9]+))?" +    // hostname[5]:port[7], hostname required
    "(\/(.*))?"                 // database[9], optional
);
// class method to connect and return a db object
QMongo.connect = function connect( url, callback ) {
    var parts = url.match(connectionPattern);
    if (!parts) throw new Error("invalid mongo connection string");
    var options = {
        username: parts[2],
        password: parts[4],
        hostname: parts[5],
        port: parts[7] || 27017,
        database: parts[9],
        retryLimit: 200,        // try to reconnect for up to 2 sec
        retryInterval: 10,      // every 1/100 sec
        retryCount: 0,
        allowHalfOpen: true,
    };

    // TODO: parse multiple host:port,host2:port2 params (to use the first)

    // TODO: parse ?options name=value,name2=value2 pairs, extract w, timeout, etc values

    QMongo._reconnect(new QMongo(), options, callback);
};

QMongo._reconnect = function _reconnect( qmongo, options, callback ) {
    if (qmongo._closed) return callback(new Error("connection closed"));
    var socket, returned;
    try {
        var opts = {
            host: options.hostname,
            port: options.port,
            allowHalfOpen: options.allowHalfOpen,
        };
        socket = net.connect(opts);
    }
    catch (err) {
        if (options.retryCount < options.retryLimit) {
            options.retryCount++;
            setTimeout(QMongo._reconnect, options.retryInterval, qmongo, options, callback);
            return;
        }
        returned = true;
        return callback(err);
    }

    socket.on('data', function(chunk) {
        // gather the data and try to deliver.  mutexes and pacing in the delivery func
        qmongo.qbuf.write(chunk);
        deliverRepliesQ(qmongo, qmongo.qbuf);
    });

    // catch socket errors else eg ECONNREFUSED is fatal
    socket.once('error', function(err) {
        // on socket error terminate all calls waiting for replies and reconnect
        // first mark the connection _closed to prevent the callbacks from reusing it
        if (qmongo) {
            qmongo.socket = null;
            qmongo.close();
            qmongo._error(err);
        }
        if (options.retryCount++ < options.retryLimit) {
            setTimeout(QMongo._reconnect, options.retryInterval, qmongo, options, callback);
        }
    });

    socket.once('connect', function() {
        if (returned) return;
        returned = true;

        // successful connection, reset retry count
        qmongo.socket = socket;
        options.retryCount = 0;

        if (!options.username) return callback(null, qmongo);

        // auth with username + password
        qmongo.auth(options.username, options.password, function(err) {
            if (err) console.log("qmongo: auth failed for %s", options.username);
            callback(err, qmongo);
        });
    });
};

// error out all calls waiting for a reply from this connection
QMongo.prototype._error = function _error( err ) {
    for (var id in this.callbacks) {
        this.callbacks[id](err);
    }
    this.callbacks = new Object();
    return this;
};

QMongo.prototype.close = function close( ) {
    if (this.socket) this.socket.end();
    this._closed = true;
    this.socket = null;
    return this;
};

QMongo.prototype.db = function db( dbName ) {
    return new Db(this, dbName);
}

function Db( qmongo, dbName ) {
    this.qmongo = qmongo;
    this.dbName = dbName;
}
Db.prototype.collection = function collection( collectionName, callback ) {
    var coll = new Collection(this.qmongo, this.dbName, collectionName);
    return (callback) ? callback(null, coll) : coll;
}
Db.prototype = Db.prototype;

function Collection( qmongo, dbName, collectionName ) {
    this.qmongo = qmongo;
    this.dbName = dbName;
    this.collectionName = collectionName;
}
Collection.prototype.runCommand = function runCommand( cmd, args, callback ) {
    return this.qmongo.runCommand(cmd, args, callback);
}
Collection.prototype.find = function find( query, options, callback ) {
    var _ns = this.dbName + '.' + this.collectionName;          // namespace to use
    return this.qmongo.find(query, options, callback, _ns);     // and have qmongo make the call
}
Collection.prototype = Collection.prototype;



QMongo.prototype.find = function find( query, options, callback, _ns ) {
    if (!callback && typeof options === 'function') { callback = options; options = {}; }
    if (this._closed) return callback(new Error("connection closed"));
    if (!this.socket) return callback(new Error("not connected"));
    if (options.fields && typeof options.fields !== 'object') return callback(new Error("fields must be an object"));

    var ns = _ns || this.dbName + '.' + this.collectionName;
    var id = _getRequestId();
    if (this.callbacks[id]) throw new Error("qmongo: assertion error: duplicate requestId " + id);
    var queryBuf = buildQuery(id, ns, query, options.fields, options.skip || 0, options.limit || 0x7FFFFFFF);

    // start the query on its way
    // data is actually transmitted only after we already installed the callback handler
    this.socket.write(queryBuf);

    // then install the callback handler and return a cursor that can act on the returned data
    // TODO: this works for toArray, but must rework for nextObject()
    return new QueryReply(this.callbacks[id] = {
        cb: callback,
        tm: Date.now(),
        raw: options.raw,
    });

    // TODO: need a cursor to stream the results of a complex sort (ie, not a single key)
    // For now, batch large datasets explicitly.
}

function QueryReply( cbInfo ) {
    this.cbInfo = cbInfo;
}
QueryReply.prototype.toArray = function toArray( callback ) {
    this.cbInfo.cb = callback;
}
QueryReply.prototype.batchSize = function batchSize( length ) {
    // TODO: later
    return this;
}
QueryReply.prototype = QueryReply.prototype;

QMongo.prototype.runCommand = function runCommand( cmd, args, callback ) {
    if (!callback) { callback = args; args = null; }
    this.collection('$cmd').find(cmd, {w: 1, limit: 1}, callback);
}

// compute the hex md5 checksum
function md5sum( str ) {
    var cksum = crypto.createHash('md5').update(str).digest('hex');
    return cksum;
}

QMongo.prototype.auth = function auth( username, password, callback ) {
    var self = this;
    self.runCommand({ getnonce: 1}, function(err, ret) {
        if (err) return callback(err);
        self.runCommand({
            authenticate: 1,
            nonce: ret.nonce,
            user: username,
            key: md5sum(ret.nonce + username + md5sum(username + ":mongo:" + password))
        },
        function(err) {
// FIXME: does not error out on invalid creds?? eg foo@localhost vs @localhost
            callback(err)
        });
        // gets "field missing/wrong type in received authenticate command" if no mechanism
        // mechanism PLAIN only in enterprise version
    });
}

// speed up access
QMongo.prototype = QMongo.prototype;



// return a request id that is not used by any of the current calls
// TODO: should be per object (per socket, actually)
var _freeRequestIds = Array();
var _lastRequestId = 0;
function _getRequestId( ) {    
    return _freeRequestIds.shift() || ++_lastRequestId;
}
function _recycleRequestId( id ) {
    // reuse ids 1..16k, those are the fastest hash indexes.  Strings are fast, large numbers are very slow.
    if (id === _lastRequestId) _lastRequestId--;
    else if (id < 16000) _freeRequestIds.push(id);
}



function buildQuery( reqId, ns, query, fields, skip, limit ) {
    // allocate a buffer to hold the query
    // TODO: keep buffers of the common sizes on free lists
    var szQuery = qbson.encode.guessSize(query);
    var szFields = qbson.encode.guessSize(fields);
    var bufSize = 16 + 4+(3*ns.length+1)+8 + 1;
    // normalize query sizes for easier reuse (TODO: maintain own free list)
    if (bufSize < 1000) bufSize = 1000;
    var msg = new Buffer(bufSize);

    // build the query
    var offset = 0;
    offset = putInt32(0, msg, 16);                              // flags, must be set
    offset = utf8.encodeUtf8Overlong(ns, 0, ns.length, msg, 20); // ns
    msg[offset++] = 0;  // NUL byte cstring terminator
    offset = putInt32(skip, msg, offset);          // skip
    offset = putInt32(limit, msg, offset);         // limit
    offset = qbson.encode.encodeEntities(query, msg, offset);   // query
    if (fields) offset = qbson.encode.encodeEntities(fields, msg, offset);  // fields
    msg = msg.slice(0, offset);

    // encode the header once the final size is known
    // zero out respTo to keep mongo happy
    offset = encodeHeader(msg, 0,  offset, reqId, 0, OP_QUERY);

    return msg;
}

function encodeHeader( buf, offset, length, reqId, respTo, opCode ) {
//    return pack(buf, offset, ['i', length, 'i', reqId, 'i', respTo, 'i', opCode]);
    putInt32(length, buf, offset+0);
    putInt32(reqId, buf, offset+4);
    putInt32(respTo, buf, offset+8);
    putInt32(opCode, buf, offset+12);
    return offset+16;
}

// TODO: make this a method?
// nb: as fast as concatenating chunks explicitly, in spite of having to slice to peek at length
function deliverRepliesQ( qmongo, qbuf ) {
    var handledCount = 0;
    var limit = 2;                              // how many replies to process before yielding the cpu

    if (qmongo._dispatchRunning) return;
    if (qbuf.length < 4) return;

    qmongo._dispatchRunning = true;

    var len;
    // TODO: create qbuf api to peek at bytes without having to slice ... maybe qbuf.getInt(pos) ?
    while (qbuf.length >= 36 && (len = getUInt32(qbuf.peek(4), 0)) <= qbuf.length) {
        // stop if limit reached

        // stop if next response is not fully arrived
        // TODO: add a readInt32LE() method on qbuf to not have to slice
        if (qbuf.length <= 4) break;
        len = getUInt32(qbuf.peek(4), 0);
        if (len > qbuf.length) break;

        // yield to the event loop after limit replies, and schedule the remaining work
        if (handledCount >= limit) {
            setImmediate(function(){ deliverRepliesQ(qmongo, qbuf) });
            break;
        }

        // decode to reply header to know what to do with it
        // even error replies return a header
        var buf = qbuf.read(len);
        var header = decodeHeader(buf, 0);
        if (header.opCode !== OP_REPLY) {
            // TODO: handle this better
            console.log("qmongo: not a reply, skipping opCode " + header.opCode);
            continue;
        }

        // find the callback that gets this reply
        var cbInfo = qmongo.callbacks[header.responseTo];
        if (!cbInfo) {
            console.log("qmongo: reply not ours, ignoring responseTo %d", reply.header.responseTo, cbInfo);
            continue;
        }

        var reply = decodeReply(buf, 0, buf.length, cbInfo.raw);
        reply.header = header;
        var err = null;
        if (reply.responseFlags & FL_R_QUERY_FAILURE) {
            // QueryFailure flag is set, respone will consist of one document with a field $err (and code)
            reply.error = qbson.decode(reply.documents[0]);
            reply.documents = [];
            // MongoError comes from query failures and bad bson
            err = new MongoError();
            for (var k in reply.error) err[k] = reply.error[k];
        }

        // dispatch reply to its callback
        qmongo._responseCount += 1;
        cbInfo.cb(err, reply.documents);

        handledCount += 1;
    }
    qmongo._dispatchRunning = false;
}


function decodeHeader( buf, offset ) {
    return {
        length: getUInt32(buf, offset+0),
        requestId: getUInt32(buf, offset+4),
        responseTo: getUInt32(buf, offset+8),
        opCode: getUInt32(buf, offset+12),
    };
}

function decodeReply( buf, base, bound, raw ) {
// TODO: move mongo protocol code out into a separate file (lib/qmongo.js vs lib/wire.js)
// TODO: decode to object here? (to recycle buffers sooner)
    var reply = {
        // TODO: flatten header fields into reply
        header: null, // filled in by caller who already parsed it to know to call us
        responseFlags: getUInt32(buf, base+16),
        cursorId: new qbson.Long(getUInt32(buf, base+20), getUInt32(buf, base+24)),
        startingFrom: getUInt32(buf, base+28),
        numberReturned: getUInt32(buf, base+32),
        error: null,
        documents: new Array(),
    };
    base += 16 + 20;

    // documents are end-to-end concatenated bson objects (mongodump format)
    var numberFound = 0;
    while (base < bound) {
        var len = getUInt32(buf, base);
        var obj = buf.slice(base, base+len);    // return complete bson objects
        if (!raw) obj = qbson.decode(obj);
        reply.documents.push(obj);
        base += len;
        numberFound += 1;
    }
    if (base !== bound) {
        // FIXME: clean up without killing self.
        console.log("qmongo: incomplete entity, header:", decodeHeader(buf, base), "flags:", reply.responseFlags.toString(16),
            "buf:", buf.strings(base), buf.slice(base-30), "error:", reply.error);
        throw new MongoError("corrupt bson, incomplete entity " + base + " of " + bound);
    }
    if (numberFound !== reply.numberReturned) {
        // FIXME: handle this better
        throw new MongoError("did not get expected number of documents, got " + numberFound + " vs " + reply.numberReturned);
    }

    return reply;
}


// quicktest:
if (process.env['NODE_TEST'] === 'qmongo') {

var assert = require('assert');

var mongo = QMongo;
//var mongo = require('mongodb').MongoClient;

mongo.connect("mongodb://@localhost/", function(err, db) {
    if (err) throw err;
    var n = 0;
    var t1 = Date.now();
    var nloops = 5000;
    var limit = 200;
    var expect = nloops * limit;
    var options = { limit: limit, raw: true };

    console.log("AR:", process.memoryUsage());
    var t1 = Date.now();
  for (var i=0; i<nloops; i++)
    db.db('kinvey').collection('kdsdir').find({}, options).toArray(function(err, docs) {
        if (err) throw err;
        assert(docs[0]._id || Buffer.isBuffer(docs[0]) || console.log(docs[0]));
        n += docs.length;
        if (n >= expect) {
            var t2 = Date.now();
            console.log("AR: got %dk docs in %d ms", nloops * limit / 1000, t2 - t1);
            console.log("AR:", process.memoryUsage());
            db.close();
            console.log("AR:", process.memoryUsage());
            // 1.2m/s raw 200@ (1.5m/s raw 1k@), 128k/s decoded (9.2mb rss after 2m items raw, 40.1 mb 1m dec)
            // mongodb: 682k/s raw 200@, 90.9k/s decoded (15.9 mb rss after 2m items raw, 82.7 mb 1m decoded ?!)
        }
    })
});

}
