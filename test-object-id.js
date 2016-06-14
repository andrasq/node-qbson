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
