/*
 * round-trip tests to check interoperatbility
 */

'use strict';

var util = require('util');
var qbson = require('../');
var bson = require('./bson');

var atomicTypes = [
    // numbers
    0, 1, 0.5, 1.5, 0.1, 1e20, 1e-20, 1e234, 1e-234,
    2, 0xFFFF, 0x10000, 0xFFFFFFFF, 0x100000000,
    0, -1, -0.5, -1.5, -0.1, -1e20, -1e-20, -1e234, -1e-234,
    -2, -0xFFFF, -0x10000, -0xFFFFFFFF, -0x100000000,
    10000000000000000, -10000000000000000, 5e-311,
    1/10000000000000000, -1/10000000000000000, -5e-311,
    1e306, -1e306, 1e-306, -1e-306, 1e307, -1e307, 1e-307, -1e-307, 1e308, -1e308, 1e-308, -1e-308,
    1.25e306, -1.25e306, 1.25e307, -1.25e307, 1.25e308, -1.25e308,
    Infinity, -Infinity,
    Math.sqrt(2), Math.sqrt(3), Math.sqrt(5), Math.sqrt(7),

    // other atomic types
    "", "foo", "\x81\x82\x83\x9a\xff\x00", "AB\x00C", "AB\xfffdCD",
    "aaaaaaaaaaaaaaaaaa bbbbbbbbbbbbbbbbbbbbbb ccccccc \u0fff dddddddddddddddddddddddde eeeeeeeeeeeeeeeeeeeeeeeeeeee",
    true, false, null,

    // javascript types
    new Date(0), new Date(), new Date(-1e9),
    /foo/, /foo/im,
];

var javascriptTypes = [
    new Number(0), new Number(1), new Number(-0), new Number(0.1),
];

module.exports = {
    'equal by buffer': {
        'test atomidTypes': function(t) {
            atomicTypes.forEach(function(data) {
                var dataObject = { data: data };
                var bufq = qbson.encode(dataObject);
                var bufb = bson.serialize(dataObject);
                t.deepEqual(bufq, bufb, "data item = " + util.inspect(data));

                var datab = bson.deserialize(bufq);
                var dataq = qbson.decode(bufb);
                t.deepEqual(datab, dataObject, "data item = " + data);
                t.deepEqual(dataq, dataObject, "data item = " + data);
            })
            t.done();
        },
    },

    'equal by string': {
    },

    'plausible by existence': {
        'Decimal128': function(t) {
            var item = { a: new qbson.Decimal128(1, 2, 3, 4) };
            var bufq = qbson.encode(item);
            t.equal(typeof bson.deserialize(bufq).a, 'object');
            t.deepEqual(qbson.decode(bufq), item);
            t.done();
        },
    },

    'equal by custom comparison': {
        'NaN': function(t) {
            [NaN, -NaN, 1/NaN, -1/NaN].forEach(function(data) {
                var bufq = qbson.encode({ a: data });
                t.ok(isNaN(bson.deserialize(bufq).a));
                var bufb = bson.serialize({ a: data });
                t.ok(isNaN(qbson.decode(bufb).a));
            })
            t.done();
        },

        '-0': function(t) {
            var bufq = qbson.encode({ a: -0 });
            t.equal(qbson.decode(bufq).a, 0);
            t.equal(1/qbson.decode(bufq).a, -Infinity);
            t.equal(bson.deserialize(bufq).a, 0);
            t.done();
        },

        'undefined': function(t) {
            var bufq = qbson.encode({ a: undefined });
            t.strictEqual(qbson.decode(bufq).a, undefined);
            t.strictEqual(bson.deserialize(bufq).a, undefined);
            t.done();
        },
    },
}
