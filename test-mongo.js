/**
 * test of using qbson to talk to mongodb
 *
 * 2016-05-23 - AR.
 */

'use strict';

var net = require('net');
var qbson = require('./qbson');
var utf8 = require('./utf8');
var QBuffer = require('qbuffer');
var util = require('util');

function MongoError(){ Error.call(this); }
util.inherits(MongoError, Error);

var OP_REPLY = 1;
var OP_QUERY = 2004;

var FL_R_QUERY_FAILURE = 2;     // QueryFailure response flag

/**

Opcode Name     Value   Comment
OP_REPLY        1       Reply to a client request. responseTo is set.
OP_MSG          1000    Generic msg command followed by a string.
OP_UPDATE       2001    Update document.
OP_INSERT       2002    Insert new document.
RESERVED        2003    Formerly used for OP_GET_BY_OID.
OP_QUERY        2004    Query a collection.
OP_GET_MORE     2005    Get more data from a query. See Cursors.
OP_DELETE       2006    Delete documents.
OP_KILL_CURSORS 2007    Notify database that the client has finished with the cursor.

query flags:
0 - reserved, must be 0.
1 - TailableCursor
2 - SlaveOk
3 - OplogReplay (internal)
4 - NoCursorTimeout (10 min recycle abandoned cursors)
5 - AwaitData (block waiting for more data, or timeout)
6 - Exhaust (stream in multiple "more" packages until done.  Most efficient for bulk)
7 - PartialOk (if some shards are down, better some data than none)
8-31 - reserved, must be 0.

struct MsgHeader {
    int32   messageLength; // total message size, including this
    int32   requestID;     // identifier for this message
    int32   responseTo;    // requestID from the original request
                           //   (used in responses from db)
    int32   opCode;        // request type - see table below
}

// 1000, deprecated, drivers need not implement
struct OP_MSG {
    MsgHeader header;  // standard message header
    cstring   message; // message for the database
}

// 2004
struct OP_QUERY {
    MsgHeader header;                 // standard message header
    int32     flags;                  // bit vector of query options.  See below for details.
    cstring   fullCollectionName ;    // "dbname.collectionname"
    int32     numberToSkip;           // number of documents to skip
    int32     numberToReturn;         // number of documents to return
                                      //  in the first OP_REPLY batch
    document  query;                  // query object.  See below for details.
  [ document  returnFieldsSelector; ] // Optional. Selector indicating the fields
                                      //  to return.  See below for details.
}

struct OP_REPLY {
    MsgHeader header;         // standard message header
    int32     responseFlags;  // bit vector - see details below
    int64     cursorID;       // cursor id if client needs to do get more's
    int32     startingFrom;   // where in the cursor this reply is starting
    int32     numberReturned; // number of documents in the reply
    document* documents;      // documents
}

**/


var putInt32 = qbson.encode.putInt32;
var getUInt32 = qbson.decode.getUInt32;

function encodeHeader( buf, offset, length, reqId, respTo, opCode ) {
    putInt32(length, buf, offset+0);
    putInt32(reqId, buf, offset+4);
    // respTo is db-side only, but if not set mongo does not reply?
    putInt32(respTo, buf, offset+8);
    putInt32(opCode, buf, offset+12);
    return offset+16;
}

function decodeHeader( buf, offset ) {
    return {
        length: getUInt32(buf, offset+0),
        requestId: getUInt32(buf, offset+4),
        responseTo: getUInt32(buf, offset+8),
        opCode: getUInt32(buf, offset+12),
    };
}

function decodeReply( buf, base, bound ) {
    var reply = {
        // TODO: flatten header fields into reply
        header: null, // caller already has the header
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
        // return raw items, separate but do not decode the returned documents
        var obj = buf.slice(base+4, base+len-1);
        reply.documents.push(obj);
        base += len;
        numberFound += 1;
    }
    if (base !== bound) {
        // FIXME: clean up without killing self.
        console.log("incomplete entity, header:", decodeHeader(buf, base), reply.responseFlags.toString(16), buf.strings(base), buf.slice(base-30), reply.error);
        throw new MongoError("corrupt bson, incomplete entity " + base + " of " + bound);
    }
    if (numberFound !== reply.numberReturned) {
        // FIXME: handle this better
        throw new MongoError("did not get expected number of documents, got " + numberFound + " vs " + reply.numberReturned);
    }

    return reply;
}

var _lastRequestId = 0;
function makeRequestId( ) {
    return ++_lastRequestId;
}

function buildQuery( ns, query, fields, skip, limit ) {
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
    encodeHeader(msg, 0,  offset, makeRequestId(), 0, OP_QUERY);

    return msg;
}


function fptime(){
    var t = process.hrtime();
    return t[0] + t[1] * 1e-9;
}

var prevChunk = null;
var chunks = new Array();
function handleReplies( chunk, handler, cb ) {
    // FIXME: O(n^2) buffer concat for multi-part replies!!
    if (prevChunk) { chunk = Buffer.concat([prevChunk, chunk]); prevChunk = null }

    var offs = 0, replyLength;
    while (offs + 4 < chunk.length) {
        replyLength = getUInt32(chunk, offs);
        if (offs + replyLength > chunk.length) break;

        var header = decodeHeader(chunk, offs);
        var reply, err = null;
        if (header.opCode !== OP_REPLY) {
            // TODO: what to do about it?
            console.log("qmongo: skipping stray opcode " + header.opCode);
        }
        else {
            reply = decodeReply(chunk, offs, offs+replyLength);
            reply.header = header;
            var err = null;
            if (reply.responseFlags & 2) {
                // QueryFailure flag is set, respone will consist of one document with a field $err (and code)
                reply.error = qbson.decode.getBsonEntities(reply.documents[0], 0, reply.documents[0].length, {})
                err = new MongoError();
                for (var k in reply.error) err[k] = reply.error[k];
            }
// FIXME: RACE: without this write, get a decode error!
//console.log("AR: reply is", reply);
            handler(err, reply);
        }
        offs += replyLength;
    }
    if (offs < chunk.length) prevChunk = offs ? chunk.slice(offs) : chunk;
    cb();
}

// nb: as fast as concatenating chunks explicitly, in spite of having to slice to peek at length
function handleRepliesQ( qbuf, limit, handler, callback ) {
    var handledCount = 0;

    if (qbuf.length < 4) return callback(null, handledCount);

    var len;
    // TODO: create qbuf api to peek at bytes without having to slice ... maybe qbuf.getInt(pos) ?
    while (qbuf.length >= 36 && (len = getUInt32(qbuf.peek(4), 0)) <= qbuf.length) {
        if (len < 36) {
            // FIXME: handle this -- maybe treat as a socket error?
            throw new MongoError("garbled data, too short for a response");
        }
        var buf = qbuf.read(len);
        var header = decodeHeader(buf, 0);
        if (header.opCode !== OP_REPLY) {
            // FIXME: handle this
            console.log("qmongo: skipping stray opcode " + header.opCode);
        }
        else {
            var reply = decodeReply(buf, 0, buf.length);
            reply.header = header;
            var err = null;
            if (reply.responseFlags & FL_R_QUERY_FAILURE) {
                // QueryFailure flag is set, respone will consist of one document with a field $err (and code)
                reply.error = qbson.decode.getBsonEntities(reply.documents[0], 0, reply.documents[0].length, {})
                err = new MongoError();
                for (var k in reply.error) err[k] = reply.error[k];
            }
// ... is 3% *faster* to decode all replies to objects?? ... cache effects, or real? (less time, higher cpu% - buf malloc?)
for (var i=0; i<reply.documents.length; i++) {
    var doc = reply.documents[i];
    reply.documents[i] = qbson.decode.getBsonEntities(doc, 0, doc.length, new Object());
}
            handler(err, reply);
        }
        handledCount += 1;
    }
    callback(err, handledCount);
}


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
var t1 = fptime(), t2, t3;
var socket = net.connect({ port: 27017, host: 'localhost' });
//var socket = net.connect("/tmp/mongodb-27017.sock");  -- gets bad data in response?

var _nQueries = 100000;
var _nReplies = 0;

socket.on('connect', function() {
console.log("AR: connect");
    t1 = fptime();
    for (var i=0; i<_nQueries; i++) {
        var msg = buildQuery('test.test', {}, null/*{_id: 1, a:1, b:1, x:1}*/, 0, 1);
        socket.write(msg);
    }
    t2 = fptime();
    console.log("AR: built and sent %d queries in %d s", _nQueries, t2 - t1);
    // can send 200k queries per second (find any limit 1)
    // can build and send 95k queries per second (4.4.0 could to 110k/s)
    // can receive 115k replies per second (113B single entity)
    // can build/receive 38k calls / sec (pipelined, 1 entity all fields; 30k/s 4 fields: if all fields, fields obj not serialized!)
    //setTimeout(function(){ socket.end() }, 2000);
    t1 = fptime();
});

var qbuf = new QBuffer({ encoding: null });
socket.on('data', function(chunk) {
//console.log("AR: data", t1, t2);
    t2 = fptime();
//console.log("AR: got response in", t2 - t1, "sec, nb:", chunk.length);
//console.log("AR: got chunk", chunk /*, chunk.toString()*/, prevChunk);
    t1 = fptime();
    // mongo can send 37.5k 699B responses per second.  Decoding is extra.

    function dispatchReply(err, reply) {
// FIXME: TODO:
        _nReplies += 1;
    }

    qbuf.write(chunk);
    handleRepliesQ(qbuf, 1000000, dispatchReply, function(err, n) {
        if (_nReplies === _nQueries) socket.end();
    });
});

socket.on('error', function(err) {
console.log("AR: error");
    console.log("AR: socket error", err);
});
