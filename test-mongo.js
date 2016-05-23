var net = require('net');
var qbson = require('./qbson');
var utf8 = require('./utf8');
var QBuffer = require('qbuffer');


var OP_REPLY = 1;
var OP_QUERY = 2004;

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
        console.log("incomplete entity, header:", reply.header, reply.responseFlags.toString(16), buf.slice(base), reply.error);
        throw new Error("corrupt bson, incomplete entity " + base + " of " + bound);
    }
    if (numberFound !== reply.numberReturned) {
        // FIXME: handle this better
        throw new Error("git not get expected number of documents, got " + numberFound + " vs " + reply.numberReturned);
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

var qbuf = new QBuffer({ encoding: null });

var prevChunk = null;
function dispatchReplies( chunk, handler, cb ) {
    // FIXME: O(n^2) buffer concat for multi-part replies!!
    if (prevChunk) chunk = Buffer.concat([prevChunk, chunk]);

    var offs = 0;
    while (offs + 4 < chunk.length) {
        var replyLength = getUInt32(chunk, offs);
console.log("AR: MARK", replyLength, offs, chunk.length, chunk.slice(offs));
        if (offs + replyLength > chunk.length) break;

        var header = decodeHeader(chunk, offs);
        switch (header.opCode) {
        case OP_REPLY:
console.log("AR: about to decode nbytes from/to", replyLength, offs, offs+replyLength, chunk.slice(offs), header);
            var reply = decodeReply(chunk, offs, offs+replyLength);
            reply.header = header;
            var err = null;
            if (reply.responseFlags & 2) {
                // QueryFailure flag is set, respone will consist of one document with a field $err (and code)
                reply.error = qbson.decode.getBsonEntities(reply.documents[0], 0, reply.documents[0].length, {})
                err = new Error();
                for (var k in reply.error) err[k] = reply.error[k];
            }
console.log("AR: reply is", reply);
            handler(err, reply);
            break;
        default:
            throw new Error("unhandled opCode " + header.opCode);
        }
        offs += replyLength;

    }
    if (offs < chunk.length) prevChunk = offs ? chunk.slice(offs) : chunk;
    cb();

/**
    // FIXME: qbuf does not work... ?

    qbuf.write(chunk);
console.log("AR: qbuf.length", qbuf.length, qbuf.peek(4));
    if (qbuf.length < 4) return;

    var len;
    while ((len = getUInt32(qbuf.peek(4), 0)) < qbuf.length) {
console.log("AR: len", len);
        var buf = qbuf.read(len);
        var reply = decodeReply(buf, 0, buf.length);
console.log("AR: got reply", reply);
    }
/**/

}


var t1 = fptime(), t2, t3;
var socket = net.connect({ port: 27017, host: 'localhost' });
//var socket = net.connect("/tmp/mongodb-27017.sock");  -- gets bad data in response?

var _nQueries = 10000;
var _nReplies = 0;

socket.on('connect', function() {
console.log("AR: connect");
    t1 = fptime();
    for (var i=0; i<_nQueries; i++) {
        var msg = buildQuery('test.test', {}, {}, 0, 1);
        socket.write(msg);
    }
    t2 = fptime();
    console.log("AR: built and sent 4k queries in %d s", t2 - t1);
    // can send 200k queries per second (find any limit 1)
    // can build and send 95k queries per second (4.4.0 could to 110k/s)
    // can receive 115k replies per second (113B single entity)
    // can build/receive 6500 calls / sec (1 entity, just _id, pipelined)
    //setTimeout(function(){ socket.end() }, 2000);
    t1 = fptime();
});

socket.on('data', function(chunk) {
//console.log("AR: data", t1, t2);
    t2 = fptime();
console.log("AR: got response in", t2 - t1, "sec, nb:", chunk.length);
//console.log("AR: got chunk", chunk /*, chunk.toString()*/, prevChunk);
    t1 = fptime();
    // mongo can send 37.5k 699B responses per second.  Decoding is extra.

//    socket.pause();
    dispatchReplies(chunk, function(err, reply){ _nReplies += 1 }, function(err, n){
console.log("AR: got reply, calls/replies", _nQueries, _nReplies);
//        socket.resume();
        if (_nReplies === _nQueries) socket.end();
    });
});
socket.on('error', function(err) {
console.log("AR: error");
    console.log("AR: socket error", err);
});
