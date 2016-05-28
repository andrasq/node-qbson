// testing...

'use strict';

module.exports = QMongo;
module.exports.Db = Db;                         // type returned by qmongo.db()
module.exports.Collection = Collection;         // type returned by qmongo.db().collection()
module.exports.Cursor = null;                   // placeholder for find()
module.exports.MongoError = MongoError;

// TODO: factor out the callbacked primitives
// qm.opQuery: function( query, fields, skip, limit, cb ) { },
// TODO: the next two can use a precompiled template, poke the cursor id (and limit), copy into a new buffer (??), and write
// Maybe cache a set of write buffers to not have to allocate new each time.
// TODO: figure out a way to do adaptive batch sizes on getMore (ie, result set size efficiency)
// qm.opGetMore: function( cursorId, limit, cb ) { },
// qm.opKillCursors: function( cursorId /* , ... */ ) { },

var net = require('net');
var util = require('util');
var crypto = require('crypto');

var QBuffer = require('qbuffer');
var QList = require('qlist');
var utf8 = require('./utf8');
var qbson = require('./qbson');
var bytes = require('./bytes');

var putInt32 = qbson.encode.putInt32;
var getUInt32 = qbson.decode.getUInt32;
var getBsonEntities = qbson.decode.getBsonEntities;     // bson_decode of mongodump concat data
var encodeEntities = qbson.encode.encodeEntities;       // bson_encode into buffer

/*
 * the q mongo client.  It can make queries itself, or return db and
 * collection objects that embed different db and collection names.
 * All returned objects use the same underlying qm client to talk to mongo.
 */
function QMongo( socket, options ) {
    if (!options) options = {};

    this.socket = socket;
    this.qbuf = new QBuffer({ encoding: null });

    this.queryQueue = new QList();
    this.callbacks = new Object();
    this.sentIds = new Array();

    this.dbName = options.database || 'test';
    this.collectionName = options.collection || 'test';
    this.batchSize = options.batchSize || 400;
    this._closed = false;
    this._deliverRunning = false;
// TODO: rename _pendingRepliesCount, and only increment if a reply is expected (ie opQuery and opGetMore)
// to be able to pump cursor cancel messages without penalty
    this._runningCallsCount = 0;
    this._responseCount = 0;
}

// same as qm.db(dbName).collection(collectionName), but sets the qm object itself
// dbName is optional.
QMongo.prototype.useCollection = function useCollection( dbName, collectionName ) {
    if (!collectionName) { collectionName = dbName; dbName = this.dbName; }
    if (!dbName || !collectionName) throw new Error("dbName and collectionName required");
    this.dbName = dbName;
    this.collectionName = collectionName;
    return this;
}

// request opCodes from https://docs.mongodb.com/v3.0/reference/mongodb-wire-protocol/
var OP_REPLY = 1;               // Reply to a client request. responseTo is set.
var OP_MSG = 1000;              // Generic msg command followed by a string.
var OP_UPDATE = 2001;           // Update document.
var OP_INSERT = 2002;           // Insert new document.
//var OP_GET_BY_ID = 2003;      // Formerly used for OP_GET_BY_OID.  Reserved.
var OP_QUERY = 2004;            // Query a collection.
var OP_GET_MORE = 2005;         // Get more data from a query. See Cursors.
var OP_DELETE = 2006;           // Delete documents.
var OP_KILL_CURSORS = 2007;     // Notify database that the client has finished with the cursor.

// query flags
var FL_Q_RESERVED = 1;          // must be 0
var FL_Q_TAILABLE_CURSOR = 2;
var FL_Q_SLAVE_OK = 4;
var FL_Q_OPLOG_REPLAY = 8;      // internal
var FL_Q_NO_CURSOR_TIMEOUT = 16;
var FL_Q_AWAIT_DATA = 32;       // pump data in multiple "more" replies.  client must then close connection.
var FL_Q_EXHAUST = 64;
var FL_Q_PARTIAL = 128;

// response flags
var FL_R_CURSOR_NOT_FOUND = 1;
var FL_R_QUERY_FAILURE = 2;     // QueryFailure response flag
var FL_R_SHARD_CONFIG_STALE = 4; // internal
var FL_R_AWAIT_CAPABLE = 8;     // always set mongo v1.6 and above

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
QMongo.connect = function connect( url, options, callback ) {
    if (!callback) { callback = options; options = {} }
    var parts = url.match(connectionPattern);
    if (!parts) throw new Error("invalid mongo connection string");
    var options = {
        username: parts[2],
        password: parts[4],
        hostname: parts[5],
        port: parts[7] || 27017,
        database: parts[9],
        retryInterval: 10,      // try to reconnect every 1/100 sec
        retryLimit: 200,        // for up to 2 sec
        retryCount: 0,
        allowHalfOpen: true,
    };

    // TODO: parse multiple host:port,host2:port2 params (to use the first)
    // TODO: parse ?options name=value,name2=value2 pairs, extract w, timeout, etc values
    // TODO: make reconnect retryLimit (0 to disable) externally configurable

    QMongo._reconnect(new QMongo(), options, callback);
};
// TODO: emit events? esp 'error', maybe 'disconnect'

// TODO: move into wire.js
QMongo._reconnect = function _reconnect( qmongo, options, callback ) {
    if (qmongo._closed) return callback(new Error("connection closed"));
    var socket, returned;
    try {
        var opts = {
            host: options.host || options.hostname,
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
        setImmediate(deliverRepliesQ, qmongo, qmongo.qbuf);
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
    this.sentIds = new Array();
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



// append a find command to the query queue
// the query queue meters the requests, and better supports a reconnect
QMongo.prototype.find = function find( query, options, callback, _ns ) {
    if (!callback && typeof options === 'function') { callback = options; options = {}; }
    if (options.fields && typeof options.fields !== 'object') return callback(new Error("fields must be an object"));
    var ns = _ns || this.dbName + '.' + this.collectionName;
    var qInfo;
    this.queryQueue.push(qInfo = {
        cb: callback,
        raw: options.raw,
        // TODO: impose our own default limit unless higher is specified
        bson: buildQuery(0, ns, query, options.fields, options.skip || 0, options.limit || 0x7FFFFFFF),
    });
    this.scheduleQuery();
    return new QueryReply(qInfo);

    // TODO: need an actual cursor to stream results of a complex sort
    // For now, batch large datasets explicitly.
}

// launch more find calls
QMongo.prototype.scheduleQuery = function scheduleQuery( ) {
    var qInfo, id;
    // TODO: make the concurrent call limit configurable,
    // best value depends on how much latency is being spanned
    while (this._runningCallsCount < 3 && (qInfo = this.queryQueue.shift())) {
        // TODO: no reason why the queued queries cant be retried after a reconnect
        if (this._closed) return qInfo.cb(new Error("connection closed"));
        if (!this.socket) return qInfo.cb(new Error("not connected"));

        id = _makeRequestId();
        putInt32(id, qInfo.bson, 4);

        // TODO: rename callbacks -> cbMap
        // FIXME: do not kill self, emit error
        if (this.callbacks[id]) throw new Error("qmongo: assertion error: duplicate requestId " + id);

        // send the query on its way
        // data is actually transmitted only after we already installed the callback handler
        this.socket.write(qInfo.bson);
        qInfo.bson = 'sent';
        this.callbacks[id] = qInfo;
        this.sentIds.push(id);
        this._runningCallsCount += 1;
        // TODO: should try to yield between passes to interleave with replies
    }
}

function QueryReply( qInfo ) {
    this.qInfo = qInfo;
}
QueryReply.prototype.toArray = function toArray( callback ) {
    this.qInfo.cb = callback;
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
// simplest to use integers, a binary string eg "\x00\x01\x02" is 37% slower
// note: 5% penalty for large numbers as ids (ie, million+)
var _lastRequestId = 0;
function _makeRequestId( ) {    
    return ++_lastRequestId;
}



function buildQuery( reqId, ns, query, fields, skip, limit ) {
    // allocate a buffer to hold the query
    // TODO: keep buffers of the common sizes on free lists
    var szQuery = qbson.encode.guessSize(query);
    var szFields = qbson.encode.guessSize(fields);
    var bufSize = 16 + 4+(3*ns.length+1)+8 + 1 + szQuery + szFields;;
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
    // TRY: return pack(buf, offset, ['i', length, 'i', reqId, 'i', respTo, 'i', opCode]);
    putInt32(length, buf, offset+0);
    putInt32(reqId, buf, offset+4);
    putInt32(respTo, buf, offset+8);
    putInt32(opCode, buf, offset+12);
    return offset+16;
}

// TODO: make this a method?
// nb: qbuf is as fast as concatenating chunks explicitly, in spite of having to slice to peek at length
function deliverRepliesQ( qmongo, qbuf ) {
    var handledCount = 0;
    var limit = 4;                              // how many replies to process before yielding the cpu

    if (qmongo._deliverRunning) return;
    if (qbuf.length < 4) return;

    qmongo._deliverRunning = true;

    var len;
    for (;;) {
        // yield to the event loop after limit replies, and schedule the remaining work
        if (handledCount >= limit) {
            setImmediate(function(){ deliverRepliesQ(qmongo, qbuf) });
            break;
        }

        // stop if next response is not fully arrived
        if (qbuf.length <= 4) break;
        // TODO: add a readInt32LE() method on qbuf to not have to slice (peek slices)
        len = getUInt32(qbuf.peek(4), 0);
        if (len > qbuf.length) break;

        // decode the reply header to know what we got
        var buf = qbuf.read(len);
        var header = decodeHeader(buf, 0);
        if (header.opCode !== OP_REPLY) {
            // TODO: handle this better, maybe emit 'warning'
            console.log("qmongo: not a reply, skipping unexpected opCode " + header.opCode);
            continue;
        }

        // find the callback that gets this reply.  Need to know if to decode `raw`
        var qInfo = qmongo.callbacks[header.responseTo];
        if (qInfo) qmongo.callbacks[header.responseTo] = 0;
        else {
            // TODO: handle this better, maybe emit 'warning'
            console.log("qmongo: not ours, ignoring reply to %d", header.responseTo, qInfo);
            continue;
        }

        // decode the reply itself, retrieve and decode the returned documents
        var reply = decodeReply(buf, 16, buf.length, qInfo.raw);
        var docs = reply.documents;
        var err = null;
        if (reply.responseFlags & (FL_R_CURSOR_NOT_FOUND | FL_R_QUERY_FAILURE)) {
            if (reply.responseFlags & FL_R_QUERY_FAILURE) {
                // QueryFailure flag is set, respone will consist of one document with a field $err (and code)
                reply.error = qbson.decode(reply.documents[0]);
                docs = null;
                // send MongoError for query failure and bad bson
                err = new MongoError('QueryFailure');
                for (var k in reply.error) err[k] = reply.error[k];
            }
            else if (reply.responseFlags & FL_R_CURSOR_NOT_FOUND) {
                reply.error = new MongoError('CursorNotFound');
                docs = null;
                err = reply.error;
            }
        }

        // FIXME: clean up: if got limit docs but there is a cursor too, close the cursor
        if (docs.length >= qInfo.limit && reply.cursorId) {
            // cursor is left open because the wire protocol has no way to indicate
            // whether the query was the first batch of many, or the entire result set.
            // qm.opKillCursors(reply.cursorId);
            // where closeCursor has a pre-prepared command template, pokes the cursor id, and writes it ;-)
        }

        // dispatch reply to its callback
        qInfo.cb(err, docs, reply.cursorId);
        qmongo._runningCallsCount -= 1;
        handledCount += 1;
        qmongo._responseCount += 1;

        // every 8k replies compact the callback map (adds 4% overhead, but needed to not leak mem)
        // Runtime is not affected by compaction with up to 500k concurrent calls.
        if ((qmongo._responseCount & 0x1FFF) === 0 /*&& qmongo._runningCallsCount < 100*/) {
            // 2x faster to gc the object by the list of keys than to delete from 50k
            compactCbMap(qmongo);
        }

        // TODO: yield to the event loop periodically
    }
    qmongo._deliverRunning = false;
    qmongo.scheduleQuery();
}


function compactCbMap( qmongo ) {
    var cbMap2 = new Object(), sentIds2 = new Array();
    var cbMap = qmongo.callbacks, sentIds = qmongo.sentIds;

    var id, item;
    for (var i=0; i<sentIds.length; i++) {
        id = sentIds[i];
        if (cbMap[id]) {
            cbMap2[id] = cbMap[id];
            sentIds2.push(cbMap[id]);
        }
    }
    qmongo.callbacks = cbMap2;
    qmongo.qInfo = sentIds2;

}

function decodeHeader( buf, offset ) {
    return {
        length: getUInt32(buf, offset+0),
        requestId: getUInt32(buf, offset+4),            // response id generated by mongod
        responseTo: getUInt32(buf, offset+8),           // id we supplied with the request we made
        opCode: getUInt32(buf, offset+12),
    };
}

// TODO: move mongo protocol code out into a separate file (lib/qmongo.js vs lib/wire.js)
// including encodeHeader, decodeHeader, decodeReply
function decodeReply( buf, base, bound, raw ) {
    var low32 = getUInt32(buf, base+4), high32 = getUInt32(buf, base+8);
    var reply = {
        responseFlags: getUInt32(buf, base),
        cursorId: (low32 && high32) ? new qbson.Long(low32, high32) : 0,
        startingFrom: getUInt32(buf, base+12),
        numberReturned: getUInt32(buf, base+16),
        error: null,
        documents: new Array(),
    };
    base += 20;

    // documents are end-to-end concatenated bson objects (mongodump format)
    // TODO: non-blocking decode, take a callback
    while (base < bound) {
        var obj, len = getUInt32(buf, base);
        // return a complete bson object if raw, or decode faster without buf.slice to object
        var obj = raw ? buf.slice(base, base+len) : getBsonEntities(buf, base+4, base+len-1, new Object())
        reply.documents.push(obj);
        base += len;
    }
    if (base !== bound) {
        // FIXME: clean up without killing self. (eg, make a method, and emit 'error')
        console.log("qmongo: incomplete entity, header:", decodeHeader(buf, base), "flags:", reply.responseFlags.toString(16),
            "buf:", buf.strings(base), buf.slice(base-30), "error:", reply.error);
        throw new MongoError("corrupt bson, incomplete entity " + base + " of " + bound);
    }
    if (reply.documents.length !== reply.numberReturned) {
        // FIXME: handle this better
        throw new MongoError("did not get expected number of documents, got " + reply.documents.length + " vs " + reply.numberReturned);
    }

    return reply;
}

// quicktest:
if (process.env['NODE_TEST'] === 'qmongo') {

// instrument Buffer to easily examine strings contained in the binary data
Buffer.INSPECT_MAX_BYTES = require('buffer').INSPECT_MAX_BYTES = 80;   // note: require('buffer') !== Buffer ??
Buffer.prototype.strings = function(base, bound) {
    if (!base) base = 0;
    if (!bound) bound = Math.min(this.length, base + Buffer.INSPECT_MAX_BYTES);
    var s = "";
    for (var i=base; i<bound; i++) {
        s += (this[i] >= 0x20 && this[i] < 128) ? String.fromCharCode(this[i]) : '.';
    }
    return s;
}

var assert = require('assert');

var mongo = QMongo;
//var mongo = require('mongodb').MongoClient;

mongo.connect("mongodb://@localhost/", function(err, db) {
    if (err) throw err;
    var n = 0;
    var t1 = Date.now();
    // caution: 1e6 pending calls crashed my mongod!
    var nloops = 5000;
    var limit = 200;
    var expect = nloops * limit;
    // caution: mongodb needs `true`, mongo server accepts `1`
    var options = { limit: limit, raw: true };

    console.log("AR:", process.memoryUsage());
    var t1 = Date.now();
  for (var i=0; i<nloops; i++)
    db.db('kinvey').collection('kdsdir').find({}, options).toArray(function(err, docs) {
        if (err) { console.log("AR: find error", err); throw err; }
        assert((options.raw && Buffer.isBuffer(docs[0])) || (!options.raw && docs[0]._id) || console.log(docs[0]));
        n += docs.length;
        if (n >= expect) {
            var t2 = Date.now();
            console.log("AR: got %dk docs in %d ms", nloops * limit / 1000, t2 - t1);
            console.log("AR:", process.memoryUsage());
            db.close();
console.log("AR:", process.memoryUsage());
//console.log("AR:", db);
            // 1.5m/s raw 200@ (1.5m/s raw 1k@), 128k/s decoded (9.2mb rss after 2m items raw, 40.1 mb 1m dec)
            // mongodb: 682k/s raw 200@, 90.9k/s decoded (15.9 mb rss after 2m items raw, 82.7 mb 1m decoded ?!)
            // 1m 200@, raw: .66 sec qmongo vs 1.6 sec mongodb, 45 mb vs 150 mb rss
            //        , decoded: 7.7 sec vs 11.2 sec, 46 mb vs 82 mb rss
            // 1m 20000@, raw: .79 sec qmongo vs 1.2 sec mongodb, 108 mb vs 308 mb rss
            //          , decoded: 10 sec vs 11 sec, 96 (or 82) mb vs 335 mb rss
        }
    })
});

}
