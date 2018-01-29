'use strict';

var assert = require('assert');
var BSON = new (require('bson'))();
var qbson = require('./qbson');

// floats
var data = [
    0, 1, 0.5, 1.5, 0.1, 1e20, 1e-20, 1e234, 1e-234,
    -0, -1, -0.5, -1.5, -0.1, -1e20, -1e-20, -1e234, -1e-234,
    10000000000000000, -10000000000000000, 5e-311,
    1/10000000000000000, -1/10000000000000000, -5e-311,
    1e306, -1e306, 1e-306, -1e-306, 1e307, -1e307, 1e-307, -1e-307, 1e308, -1e308, 1e-308, -1e-308,
    1.25e306, -1.25e306, 1.25e307, -1.25e307, 1.25e308, -1.25e308,
    Infinity, -Infinity, NaN, -NaN,
    Math.sqrt(2), Math.sqrt(3), Math.sqrt(5), Math.sqrt(7),
];
for (var i=0; i<data.length; i++) {
    var buf = BSON.serialize({ a: data[i] });
    if (isNaN(data[i])) assert(isNaN(qbson.decode(buf).a));
    else assert.strictEqual(qbson.decode(buf).a, data[i]);
}

var buf, obj;

// Symbol
buf = new Buffer([ 0x18, 0, 0, 0, 0x0e, 0x61, 0, 0x0c, 0, 0, 0, 0x53, 0x79, 0x6d, 0x62, 0x6f, 0x6c, 0x20, 0x4e, 0x61, 0x6d, 0x65, 0, 0 ]);
obj = qbson.decode(buf);
assert.equal(typeof obj.a, 'symbol');
assert.equal(obj.a.toString(), 'Symbol(Symbol Name)');
