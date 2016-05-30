// testing...

'use strict';

module.exports = QMongo;
// TODO: rename classes QmDb, QmCollection, QmCursor for better traceability
module.exports.Db = Db;                         // type returned by qmongo.db()
module.exports.Collection = Collection;         // type returned by qmongo.db().collection()
module.exports.Cursor = Cursor;                 // type returned by find()
module.exports.MongoError = MongoError;

// TODO: the next two can use a precompiled template, poke the cursor id (and limit), copy into a new buffer (??), and write
// Maybe cache a set of write buffers to not have to allocate new each time.
// TODO: figure out a way to do adaptive batch sizes on getMore (ie, result set size efficiency)

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
function putStringZ( str, buf, offset ) {
    offset = utf8.encodeUtf8Overlong(str, 0, str.length, buf, offset);
    buf[offset++] = 0;
    return offset;
}

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
    this.batchSize = options.batchSize || 10000;
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


function _noop() {
}

function MongoError(){
    Error.call(this);
}
util.inherits(MongoError, Error);

function maybeCallback( callback, err, ret ) {
    if (callback) callback(err, ret);
    else if (err) throw err;
    else return ret;
}

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
    var connectOptions = {
        // parsed options
        username: parts[2],
        password: parts[4],
        hostname: parts[5],
        port: parts[7] || 27017,
        database: parts[9],
        // built-in options
        // TODO: expose some of these built-ins, allow the user to override
        retryInterval: 10,      // try to reconnect every 1/100 sec
        retryLimit: 200,        // for up to 2 sec
        retryCount: 0,
        // user-provided options
        allowHalfOpen: options.allowHalfOpen !== undefined ? options.allowHalfOpen : true,
    };
    var mongoOptions = {
        batchSize: options.batchSize,
    };

    // TODO: parse multiple host:port,host2:port2 params (to use the first)
    // TODO: parse ?options name=value,name2=value2 pairs, extract w, timeout, etc values
    // TODO: make reconnect retryLimit (0 to disable) externally configurable

    QMongo._reconnect(new QMongo(null, mongoOptions), connectOptions, callback);
};
// TODO: emit events? esp 'error', maybe 'disconnect'

QMongo.prototype.isConnected = function isConnected( ) {
    return this.socket ? true : false;
}

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
        setImmediate(deliverReplies, qmongo, qmongo.qbuf);
    });

    // catch socket errors else eg ECONNREFUSED is fatal
    socket.once('error', function(err) {
        // on socket error terminate all calls waiting for replies and reconnect
        // first mark the connection _closed to prevent the callbacks from reusing it
        if (qmongo) {
            qmongo.socket = null;       // socket also signals that is connected
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
        qmongo.auth(options.username, options.password, options.database, function(err) {
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
Db.prototype.runCommand = function runCommand( cmd, args, callback ) {
    if (!callback) { callback = args; args = null; }
    this.qmongo.db(this.dbName).collection('$cmd').find(cmd, {w: 1, limit: 1}, function(err, ret) {
        return err ? callback(err) : callback(null, ret[0]);
    });
}
Db.prototype = Db.prototype;

function Collection( qmongo, dbName, collectionName ) {
    this.qmongo = qmongo;
    this.dbName = dbName;
    this.collectionName = collectionName;
}
Collection.prototype.find = function find( query, options, callback ) {
    var _ns = this.dbName + '.' + this.collectionName;          // namespace to use
    return this.qmongo.find(query, options, callback, _ns);     // and have qmongo make the call
}
Collection.prototype = Collection.prototype;



/*
// append a find command to the query queue
// the query queue meters the requests, and better supports a reconnect
//
// TODO: consider how to return an array to the callback of find, but also use it as a Cursor
// TODO: we would like toArray to set the EXHAUST flag on the query about to be sent
// (that would need the callback to be left registered until got a zero cursorId)
 */
QMongo.prototype.find = function find( query, options, callback, _ns ) {
    if (!callback && typeof options === 'function') { callback = options; options = {}; }
    if (options.fields && typeof options.fields !== 'object') {
        return maybeCallback(callback, new Error("fields must be an object"));
    }
    var ns = _ns || this.dbName + '.' + this.collectionName;
    var queryLimit = options.limit || this.batchSize;
    if (queryLimit > this.batchSize) queryLimit = this.batchSize;

    return this.opQuery(options, ns, options.skip || 0, queryLimit, query, options.fields, callback)
}

QMongo.prototype.killCursor = function killCursor( cursorId ) {
    // Note: no benefit to batching cursors sent to opKillCursor
    if (cursorId) this.opKillCursors(cursorId);
}

// send more calls to the db server
QMongo.prototype.scheduleQuery = function scheduleQuery( ) {
    var qInfo, id;
    // TODO: make the concurrent call limit configurable,
    // best value depends on how much latency is being spanned
    // 10% faster with 300 if making 50k concurrent calls, 25% for 500k
    while (this._runningCallsCount < 3 && (qInfo = this.queryQueue.shift())) {
        // TODO: no reason why the queued queries cant be retried after a reconnect
        if (qInfo.cb) {
            if (this._closed) return qInfo.cb(new Error("connection closed"));
            if (!this.socket) return qInfo.cb(new Error("not connected"));
        }

        id = _makeRequestId();
        putInt32(id, qInfo.bson, 4);

        // TODO: rename callbacks -> cbMap
        // FIXME: do not kill self, emit error
        if (this.callbacks[id]) throw new Error("qmongo: assertion error: duplicate requestId " + id);

        // send the query on its way
        // data is actually transmitted only after we already installed the callback handler
        var bson = qInfo.bson, len = getUInt32(qInfo.bson, 0);
        if (len < bson.length) bson = bson.slice(0, len);
        if (this.socket) this.socket.write(bson);
        if (bson[12] === (OP_QUERY & 0xFF) || bson[12] === (OP_GET_MORE & 0xFF)) this._runningCallsCount += 1;
        qInfo.bson = 'sent';

        // not all ops expect (or get) a reply.
        if (qInfo.cb) {
            this.callbacks[id] = qInfo;
            this.sentIds.push(id);
        }
        // TODO: should try to yield between passes to interleave with replies
// TODO: time out queries (callbacks) that take too long.
    }
}

QMongo.prototype.opKillCursors = function opKillCursors( cursors ) {
    var bson = new Buffer(16 + 8 + 8 * arguments.length);
    cursors = Array.isArray(cursors) ? cursors : arguments;

    // header: total length, reqId, repsonseTo, opCode
    putInt32(bson.length, bson, 0);
    // reqId filled in by scheduleQuery
    putInt32(0, bson, 8);
    putInt32(OP_KILL_CURSORS, bson, 12);

    // opKillCursors: ZERO, cursorCount, cursorIds back-to-back
    putInt32(0, bson, 16);
    putInt32(cursors.length, bson, 20);
    for (var i=0; i<cursors.length; i++) {
        cursors[i].put(bson, 24 + 8*i);
    }

    this.queryQueue.push(/*qInfo =*/ {
        cb: null,
        bson: bson
    });
    this.scheduleQuery();
}

// TODO: normalize query sizes for easier reuse?
// TODO: move the work of buildQuery in here
// var bson = new Buffer(16 + (4 + (3*ns.length+1) + 8 + 1) +
//     qbson.encode.guessSize(query) + (fields ? qbson.guessSize(fields) : 0));
QMongo.prototype.opQuery = function opQuery( options, ns, skip, limit, query, fields, callback ) {
    var bson = buildQuery(0, ns, query, fields, skip, limit);

    var qInfo;
    this.queryQueue.push(qInfo = {
        cb: callback || _noop,
        raw: options.raw,
        exhaust: false,
        bson: bson,
    });
    _setOptionFlags(options, bson, 16);

    this.scheduleQuery();
    var cursor = new Cursor(qInfo, this, ns, options.limit || Infinity);
    if (callback) callback(null, cursor);
    return cursor;
}

function _setOptionFlags( options, bson, offset) {
    // all 7 query flags go into the same byte
    if (options.tailableCursor) bson[offset] |= FL_Q_TAILABLE_CURSOR;
    if (options.slaveOk) bson[offset] |= FL_Q_SLAVE_OK;
    if (options.awaitData) bson[offset] |= FL_Q_WAIT_DATA;
    // FL_Q_EXHAUST
    // FL_Q_PARTIAL
}

QMongo.prototype.opGetMore = function opGetMore( ns, limit, cursorId, raw, callback ) {
    // TODO: normalize query sizes for easier reuse?
    var bson = new Buffer(16 + 12 + qbson.encode.guessSize(ns));

    putInt32(0, bson, 16);                      // ZERO
    var offset = putStringZ(ns, bson, 20);      // ns - why is namespace needed?
    putInt32(limit, bson, offset);              // limit
    offset = cursorId.put(bson, offset+4);      // cursor Id

    // id -1 as a placeholder, responseTo 0
    encodeHeader(bson, 0, offset, -1, 0, OP_GET_MORE);

    var qInfo;
    this.queryQueue.push(qInfo = {
        cb: callback,
        bson: bson,
        raw: raw,
    });
    this.scheduleQuery();
}


function Cursor( qInfo, qm, ns, fetchLimit ) {
    this.qInfo = qInfo;
    this.qm = qm;
    this.ns = ns;
    // fetchLimit is the user-specified max documents to return,
    // as opposed to the internal batch limit.  It is cleared to 0
    // when the cursor is closed and no more data will be read.
    this.fetchLimit = fetchLimit;

    this.batchSize = this.qm.batchSize;
    this.cursorId = 0;          // set once results start arriving, cleared when done
    this.docs = null;           // the array of matching documents
    this._refillSelf = null;    //
    this._refillCb = null;
    this._refillError = null;

    var self = this;
    qInfo.cb = this._getRefillSelf();
}
// merge in a new batch of docs into our exiting bunch
Cursor.prototype._refill = function _refill( err, docs, cursorId ) {
    this.cursorId = cursorId;   // if cursor still live
    if (!docs) {
        this.close();           // always get docs unless error
        this._refillError = err;
    }
    else {
        if (!this.docs) this.docs = docs;       // first batch
        else for (var i=0; i<docs.length; i++) this.docs.push(docs[i]);
        this.fetchLimit -= docs.length;
        if (!this.fetchLimit) this.close();
    }
}
// create and cache a closure to refill our documents store and notify the interested callback
Cursor.prototype._getRefillSelf = function _getRefillSelf( ) {
    if (!this._refillSelf) {
        var self = this;
        this._refillSelf = function _refillSelf(err, docs, cursorId) {
            self._refill(err, docs, cursorId);
            if (self._refillCb) self._refillCb();
        }
    }
    return this._refillSelf;
}
// close the query to free the cursor memory on the server
Cursor.prototype.close = function close( ) {
    if (this.cursorId) {
        this.qm.killCursor(this.cursorId);
        this.cursorId = 0;      // cannot read more data
        this.fetchLimit = 0;    // not expecting more data
        // already fetched documents are not cleared, so it`s possible
        // to keep fetching items from a closed cursor.  This way we can
        // close the cursor as soon as we got the last batch.
    }
}
// return the next item from the result set
// TODO: prefetch next batch when running low on items?
Cursor.prototype.nextObject = function nextObject( cb ) {
    // if have some items on hand, return one
    if (this.docs && this.docs.length) {
        var doc = this.docs.shift();
        return cb(null, doc);
    }
    // if still waiting for the next batch, get notified once arrived
    if (this.fetchLimit > 0) {
        var self = this;
        if (self.cursorId) self.qm.opGetMore(self.ns, self.cursorFetchSize(), self.cursorId, self.qInfo.raw, self._getRefillSelf());
        this._refillCb = function() { return self.nextObject(cb); }
    }
    // if out of data and no way to fetch more, indicate done with null
    else return cb(this._refillError, null);
}
// return the next batchSize items from the result set
Cursor.prototype.fetchBatch = function nextBatch( batchSize, cb ) {
// TODO: writeme: fetch this many elements from the result stream
}
Cursor.prototype.cursorFetchSize = function cursorFetchSize( ) {
    return (this.fetchLimit < this.batchSize) ? this.fetchLimit : this.batchSize;
}
// fetch all remaining items in the result set
// nb: using getRefillSelf() is much slower, loses the fast path advantage
Cursor.prototype.toArray = function toArray( callback ) {
    var self = this, fetchLimit = self.fetchLimit;
    this.qInfo.cb = function refill(err, docs, cursorId) {
       if (docs && docs.length >= fetchLimit) {
            // fast path: single batch, no errors
            self.close();
            return callback(null, docs);
        }
        self._refill(err, docs, cursorId);
        if (err) return callback(err);
        else if (self.cursorId) self.qm.opGetMore(self.ns, self.cursorFetchSize(), cursorId, self.qInfo.raw, refill);
        else return callback(null, self.docs);
    }
}
Cursor.prototype.batchSize = function batchSize( length ) {
    this.batchSize = batchSize;
    return this;
}
Cursor.prototype = Cursor.prototype;

// expose runCommand on the underlying qm object as well, runs against the qm.dbName db
QMongo.prototype.runCommand = Db.prototype.runCommand;

// compute the hex md5 checksum
function md5sum( str ) {
    var cksum = crypto.createHash('md5').update(str).digest('hex');
    return cksum;
}

QMongo.prototype.auth = function auth( username, password, database, callback ) {
    if (!callback) { callback = database; database = null; }
    if (!database) database = 'admin';

    var self = this;
    self.db(database).runCommand({ getnonce: 1}, function(err, ret) {
        if (!err && !ret.ok) err = new Error("auth error: code " + ret.code + ", " + ret.errmsg);
        if (err) return callback(err);
        self.db(database).runCommand({
            authenticate: 1,
            nonce: ret.nonce,
            user: username,
            key: md5sum(ret.nonce + username + md5sum(username + ":mongo:" + password))
        },
        function(err, ret) {
            if (!err && !ret.ok) err = new Error("auth error: code " + ret.code + ", " + ret.errmsg);
            callback(err);
        });
    });
}

// speed up access
QMongo.prototype = QMongo.prototype;



// return a request id that is not used by any of the current calls
// CAUTION:  returns a monotonically increasing integer 1..2^32-1,
// then repeats.  Ids will overlap after 4 billion requests.
// TODO: should be per object (per socket, actually)
// Simplest to use integers, a binary string eg "\x00\x01\x02" is 37% slower.
// Large numbers (millions) are 5% slower than small numbers (under 16k).
var _lastRequestId = 0;
function _makeRequestId( ) {
    _lastRequestId = (_lastRequestId + 1) & 0xFFFFFFFF;
    return _lastRequestId || (_lastRequestId = 1);
}



function buildQuery( reqId, ns, query, fields, skip, limit ) {
    // allocate a buffer to hold the query
    var szQuery = qbson.encode.guessSize(query);
    var szFields = qbson.encode.guessSize(fields);
    var bufSize = 16 + 4+(3*ns.length+1)+8 + 1 + szQuery + szFields;;
    // TODO: normalize query sizes for easier reuse?
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

    // encode the header once the final size is known
    // zero out respTo to keep mongo happy
    encodeHeader(msg, 0,  offset, reqId, 0, OP_QUERY);

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
// TODO: this function is not getting optimized -- fix or work around
function deliverReplies( qmongo, qbuf ) {
    var handledCount = 0;
    var limit = 4;                              // how many replies to process before yielding the cpu

    if (qmongo._deliverRunning) return;
    if (qbuf.length < 4) return;

    qmongo._deliverRunning = true;

    var len;
    for (;;) {
        // yield to the event loop after limit replies, and schedule the remaining work
        if (handledCount >= limit) {
            setImmediate(function(){ deliverReplies(qmongo, qbuf) });
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
// TODO: do not clear callback if exhausting the cursor
        if (qInfo) qmongo.callbacks[header.responseTo] = 0;
        else {
            // TODO: handle this better, maybe emit 'warning'
            console.log("qmongo: not ours, ignoring reply to %d", header.responseTo, qInfo);
            continue;
        }

        // decode the reply itself, retrieve and decode the returned documents
        var reply = decodeReply(buf, 16, buf.length, qInfo.raw);
        var docs = reply.documents;     // always an array
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
                var err = new MongoError('CursorNotFound');
                docs = null;
            }
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
// TRY: re-time whether decoding as a separate step is any slower
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
var aflow = require('aflow');

var mongo = QMongo;
//var mongo = require('mongodb').MongoClient;

mongo.connect("mongodb://@localhost", {batchSize: 5000}, function(err, db) {
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
    db.db('kinvey').collection('kdsdir').find({}, options, function(err, cursor) {
if (1) {
        aflow.repeatUntil(
            function(done) {
                cursor.nextObject(function(err, doc) {
//console.log("AR: aflow got", err);
                    if (doc) n += 1;
                    done(err, !doc);
                });
            },
            function(err) {
                if (err) console.log("AR: nextObject err", err, n, expect);
//console.log("AR: done, n, expect", n, expect);
                if (n >= expect) {
                    var t2 = Date.now();
                    console.log("AR: got %dk docs in %d ms", n / 1000, t2 - t1);
                    console.log("AR:", process.memoryUsage());
                    db.close();
                }
                if (err) db.close();
            }
        );
}
if (0) {
        cursor.toArray(function(err, docs) {
            if (err) { console.log("AR: find error", err); throw err; }
            assert((options.raw && Buffer.isBuffer(docs[0])) || (!options.raw && docs[0]._id) || console.log(docs[0]));
            n += docs.length;
            if (n >= expect) {
                var t2 = Date.now();
                console.log("AR: got %dk docs in %d ms", nloops * limit / 1000, t2 - t1);
                console.log("AR: toArray returned %d docs", docs.length);
                console.log("AR:", process.memoryUsage());
                assert.equal(docs.length, limit);
//console.log("AR: got", docs[0], qbson.decode(docs[0]));
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
}
    });
});

}
