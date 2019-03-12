'use strict';

var assert = require('assert');
var qbson = require('./qbson.js');

var ObjectId = require('./object-id');

module.exports = {
    'pause for _getNow timers to expire': function(t) {
        setTimeout(t.done.bind(t), 200);
    },
}

id = ObjectId();
assert.ok(id instanceof ObjectId);

id = new ObjectId();
assert.ok(id instanceof ObjectId);

id = ({ ObjectId: ObjectId }).ObjectId();
assert.ok(id instanceof ObjectId);

id = ObjectId("1234ABCD1234");
assert.equal(String(id), "313233344142434431323334");

id = ObjectId("12341234ABCDABCD12341234");
assert.equal(String(id), "12341234abcdabcd12341234");

id = ObjectId("010203040A0B0C0D01020304");
assert.equal(String(id), "010203040a0b0c0d01020304");

id = ObjectId("                        ");
assert.equal(String(id), "000000000000000000000000");

id = ObjectId(new Buffer("123412341234"));
assert.ok(id instanceof ObjectId);
assert.equal(id.toString(), "313233343132333431323334");

id = ObjectId.createFromBuffer(new Buffer([1,2,3,4,1,2,3,4,1,2,3,4]));
assert.ok(id instanceof ObjectId);
assert.equal(id.toString(), "010203040102030401020304");
assert.equal(id.valueOf(), "010203040102030401020304");


// should roll across seconds, should throw on sequence wrap
var idbuf = [,,,,,,,,,,,,], x;
id = new ObjectId();
console.time('generateId');
// generate enough ids to guarantee at least one sequence wrap
for (var i=0; i<10000000; i++) id.generateId(idbuf);            // 55m/s SKL 4.5g if didnt pause
console.timeEnd('generateId');
console.time('new id get');
for (var i=0; i<1000000; i++) { new ObjectId()._get() }         // 44m/s SKL 4.5g
console.timeEnd('new id get');
console.time('bytesToHex');
for (var i=0; i<1000000; i++) ObjectId.bytesToHex(idbuf, 0, 12);
console.timeEnd('bytesToHex');
console.time('setFromString');
for (var i=0; i<1000000; i++) id.setFromString('123456789abc123456789abc');
console.timeEnd('setFromString');

assert.throws(function() { new ObjectId("1234") });
assert.throws(function() { new ObjectId("123412341234", 2) });
assert.throws(function() { new ObjectId("123412341234123412341234", 2) });
assert.throws(function() { new ObjectId(1) });
assert.throws(function() { new ObjectId(true) });


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
assert(id2 > id1);

// should generate 10k different ids
var newIds = [];
var t1 = Date.now();
for (var i=0; i<10000; i++) newIds.push(new ObjectId().toString());
var t2 = Date.now();
for (var i=1; i<10000; i++) assert(newIds[i] > newIds[i-1], newIds[i-1] + ' -> ' + newIds[i]);

// time to generate should be < 10ms (ie > 1m/s)
assert(t2 - t1 < 100);

// should wrap sequence
var id1 = new ObjectId().toString();
ObjectId._setSeq(0x1000000);
var id2 = new ObjectId().toString();
assert(id2.slice(-6) == '000000');
assert(id2.slice(0, 8) > id1.slice(0, 8), id1 + ' -> ' + id2);

// bytesToHex
var buf = new Buffer([ 0, 1, 2, 3, 4, 127, 128, 129, 254, 255 ]);
assert.equal(ObjectId.bytesToHex(buf, 0, buf.length), buf.toString('hex', 0, buf.length));

/**
var timeit = require('qtimeit');
var x;

//timeit(400000, function(){ x = buf.toString('hex') });
//timeit(400000, function(){ x = buf.toString('hex', 0, buf.length) });
// 3.1m/s base64 or hex, 10x less gc
// *BUT* 1.2m/s if have to slice a sub-range (...but can pass in base/bound)
var idbuf = [,,,,,,,,,,,,];
buf = new Buffer([1,2,3,4,5,6,7,8,9,10,11,12]);
timeit(2000000, function(){ x = new ObjectId() });
timeit(2000000, function(){ x = new ObjectId(buf, 0, 12) });
timeit(2000000, function(){ x = new ObjectId("123412341234") });
timeit(2000000, function(){ x = new ObjectId("123412341234123412341234") });
timeit(2000000, function(){ x = ObjectId.generateId(idbuf) });
//timeit(400000, function(){ x = ObjectId.bytesToHex(buf, 0, buf.length) });
//timeit(400000, function(){ x = buf.toString('hex', 0, buf.length) });
// sw loop is faster up to 6 bytes (2 iterations)
// 2.8m/s base64, 6.6m/s hex (hexPairs)
//console.log("AR: expect", buf.toString('base64'));
//console.log("AR: mem", process.memoryUsage());
/**/
