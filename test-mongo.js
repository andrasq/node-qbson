var net = require('net');
var qbson = require('./qbson');
var utf8 = require('./utf8');
var QBuffer = require('qbuffer');

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


function encodeMongoCommand( header, cmd ) {
    var flags = cmd.flags || 0;
    var collectionName = cmd.collectionName;
    var skip = cmd.skip || 0;
    var limit = cmd.limit || defaultBatchSize;
}


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
        header: decodeHeader(buf, base),
        responseFlags: getUInt32(buf, base+16),
        cursorId: new qbson.Long(getUInt32(buf, base+20), getUInt32(buf, base+24)),
        startingFrom: getUInt32(buf, base+28),
        numberReturned: getUInt32(buf, base+32),
        documents: new Array(),
    };
    base += 16 + 20;

    // documents are end-to-end concatenated bson objects (mongodump format)
    while (base < bound) {
        var len = getUInt32(buf, base);
// RACE? without the next console.log, offset error.  With it, runs fine.
//console.log("AR: decoding from %d to %d", base, base+len, buf.length);
        // return raw items, separate but do not decode the returned documents
        var obj = buf.slice(base+4, base+len-1);
//var obj = qbson.decode.getBsonEntities(buf, base+4, base+len-1, new Object());
        reply.documents.push(obj);
        base += len;
    }
    if (base !== bound) throw new Error("corrupt bson, incomplete entity " + base + " of " + bound);
    return reply;
}

var query = {};
var fields = {_id:1, a:1};
var szQuery = qbson.encode.guessSize(query);
var szFields = qbson.encode.guessSize(fields);
var collectionName = 'test.test';
var msg = new Buffer(16 + 4+(3*collectionName.length+1)+8 + 1);
var offset = 0;
encodeHeader(msg, 0,  0, 1, 0, 2004);
offset = utf8.encodeUtf8Overlong(collectionName, 0, collectionName.length, msg, 20);    // ns
msg[offset++] = 0;
offset = qbson.encode.putInt32(0, msg, offset);         // skip
offset = qbson.encode.putInt32(1, msg, offset);        // limit
offset = qbson.encode.encodeEntities(query, msg, offset);
//offset = qbson.encode.encodeEntities(fields, msg, offset);
qbson.encode.putInt32(offset, msg, 0);  // messageLength
msg = msg.slice(0, offset);
console.log("AR: BUILT", msg);

function fptime(){
    var t = process.hrtime();
    return t[0] + t[1] * 1e-9;
}

var qbuf = new QBuffer({ encoding: null });

var prevChunk = null;
function dispatchReplies( chunk, handler ) {
    // FIXME: O(n^2) buffer concat for multi-part replies!!
    if (prevChunk) chunk = Buffer.concat([prevChunk, chunk]);

    // need at least the 16 byte header to decode
    var offs = 0;
    while (offs + 16 < chunk.length) {
        // FIXME: decode header here, not in the reply!  we need the length
        if (offs + 4 >= chunk.length) break;
        var len = getUInt32(chunk, offs);
        var end = offs + len;
        if (end > chunk.length) break;
console.log("AR: decoding reply from/to", len, offs, offs+len);
        var reply = decodeReply(chunk, offs, end);
//console.log("AR: got reply", reply);
        offs = end;
    }
    if (offs < chunk.length) prevChunk = offs ? chunk.slice(offs) : chunk;

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

socket.on('connect', function() {
console.log("AR: connect");
    t1 = fptime();
    for (var i=0; i<4000; i++) socket.write(msg);
    t2 = fptime();
    console.log("AR: sent 4k queries in %d s", t2 - t1);
    // can send 200k queries per second (find any limit 1)
    // can receive 115k replies per second (113B single entity)
    setTimeout(function(){ socket.end() }, 4000);
    t1 = fptime();
});

socket.on('data', function(chunk) {
//console.log("AR: data", t1, t2);
    t2 = fptime();
console.log("AR: got response in", t2 - t1, "sec");
//console.log("AR: got chunk", chunk);
    t1 = fptime();
    // mongo can send 37.5k 699B responses per second.  Decoding is extra.

    dispatchReplies(chunk);
});
socket.on('error', function(err) {
console.log("AR: error");
    console.log("AR: socket error", err);
});
