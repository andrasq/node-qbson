'use strict';

var assert = require('assert');
var qbson = require('./qbson.js');

var ObjectId = require('./object-id');

var ids = [
    "000000000000000000000000",
    "ffffffffffffffffffffffff",
    "000000000000000000000001",
    "800000000000000000000000",
    "111111111111111111111111",
    "888888888888888888888888",
    "aaaaaaaaaaaaaaaaaaaaaaaa",
];

// foreach id in 0000 FFFF 0001 8000 8888 1111 AAAA
for (var i=0; i<ids.length; i++) {
    var id, str, buf = new Buffer(12);

    //   should create id from string
    id = new ObjectId().setFromString(ids[i]);
    assert(id);
    assert.equal(id.getTimestamp() / 1000 >>> 0, parseInt(ids[i].slice(0, 8), 16));
    
    //   should create id from buffer
    id = new ObjectId().setFromBuffer(new Buffer(ids[i], 'hex'), 0, 12);
    assert(id);
    assert.equal(id.getTimestamp() / 1000 >>> 0, parseInt(ids[i].slice(0, 8), 16));

    //   should convert id to string
    str = id.toString();
    assert.equal(str, ids[i]);

    //   should copy id to buffer
    id.copyToBuffer(buf, 0);
    assert.deepEqual(buf.slice(0, 12).toString('hex'), ids[i]);
}

// should generate id
var id1 = new ObjectId().toString();
assert(id1 > '');

// should generate a different id
var id2 = new ObjectId().toString();
assert(id2 > '');
assert(id1 != id2);

// should generate 10k different ids
var newIds = [];
var t1 = Date.now();
for (var i=0; i<10000; i++) newIds.push(new ObjectId().toString());
var t2 = Date.now();
newIds.sort();
for (var i=1; i<10000; i++) assert(newIds[i] != newIds[i-1]);

// time to generate should be < 10ms (ie > 1m/s)
assert(t2 - t1 < 100);

// bytesToHex
var buf = new Buffer([ 0, 1, 2, 3, 4, 127, 128, 129, 254, 255 ]);
assert.equal(ObjectId.bytesToHex(buf, 0, buf.length), buf.toString('hex', 0, buf.length));

// bytesToBase64
var x, timeit = require('qtimeit');
var data = [
    new Buffer([ 1 ]),
    new Buffer([ 1, 1 ]),
    new Buffer([ 1, 1, 1 ]),
    new Buffer([ 1, 1, 1, 1 ]),
    new Buffer([ 1, 1, 1, 1, 1 ]),
    new Buffer([ 255 ]),
    new Buffer([ 255, 255 ]),
    new Buffer([ 255, 255, 255 ]),
    new Buffer([ 0, 1, 2, 3, 4, 127, 128, 129, 254, 255 ]),
];
for (var i=0; i<data.length; i++) {
    var buf = data[i];
    assert.equal(ObjectId.bytesToBase64(buf, 0, buf.length), buf.toString('base64', 0, buf.length));
}
var buf = new Buffer(1);
for (var i=0; i<256; i++) {
    buf[0] = i;
    assert.equal(ObjectId.bytesToBase64(buf, 0, 1), buf.toString('base64'));
}
//timeit(400000, function(){ x = buf.toString('hex') });
//timeit(400000, function(){ x = buf.toString('hex', 0, buf.length) });
// 3.1m/s base64 or hex, 10x less gc
// *BUT* 1.2m/s if have to slice a sub-range (...but can pass in base/bound)
buf = new Buffer([1,2,3,4,5,6,7,8,9,10,11,12]);
timeit(400000, function(){ x = ObjectId.bytesToBase64(buf, 0, buf.length) });
//timeit(400000, function(){ x = buf.toString('base64', 0, buf.length) });
//timeit(400000, function(){ x = ObjectId.bytesToHex(buf, 0, buf.length) });
//timeit(400000, function(){ x = buf.toString('hex', 0, buf.length) });
// sw loop is faster up to 6 bytes (2 iterations)
// 2.8m/s base64, 6.6m/s hex (hexPairs)
//console.log("AR: expect", buf.toString('base64'));
//console.log("AR:    got", ObjectId.bytesToBase64(buf, 0, buf.length));
//console.log("AR: mem", process.memoryUsage());