'use strict';

var assert = require('assert');
var BSON = require('./bson');
var qbson = require('../qbson');
var bson = require('./bson');

// coverage-safe polyfills for node that need it
eval('assert.deepStrictEqual = assert.deepStrictEqual || assert.deepEqual;');
eval('if (!Buffer.alloc) Buffer.alloc = Buffer.allocUnsafe = function(n) { return new Buffer(n) }');
eval('if (parseInt(process.versions.node) < 6) { Object.defineProperty(Buffer, "from", { writable: true, value: function(a, b, c) { return new Buffer(a, b, c) } }) };');

// wrap unsupported language features in eval() to not crash during file parse
function _tryEval(src) { try { return eval(str) } catch (e) { } }
function _tryEvalErr(src) { try { return eval(str) } catch (e) { return err } }

var data = [
    // numbers
    0, 1, 0.5, 1.5, 0.1, 1e20, 1e-20, 1e234, 1e-234,
    -0, -1, -0.5, -1.5, -0.1, -1e20, -1e-20, -1e234, -1e-234,
    10000000000000000, -10000000000000000, 5e-311,
    1/10000000000000000, -1/10000000000000000, -5e-311,
    1e306, -1e306, 1e-306, -1e-306, 1e307, -1e307, 1e-307, -1e-307, 1e308, -1e308, 1e-308, -1e-308,
    1.25e306, -1.25e306, 1.25e307, -1.25e307, 1.25e308, -1.25e308,
    Infinity, -Infinity, NaN, -NaN,
    Math.sqrt(2), Math.sqrt(3), Math.sqrt(5), Math.sqrt(7),

    // other atomic types
    "", "foo", "\x81\x82\x83\x9a\xff\x00",
    true, false, null,

    new Date(1234567890), new Date(0), new Date(222222222),
    /foo/, /foo/mig,

    function(x){ return x + 1234 },

    new qbson.MinKey(), new qbson.MaxKey(),
    new Buffer("\x01\x00\x02"),

    // compound
    [], [1,2,3], [,,1,2,],
    {}, {x:1}, {x:{y:{}}},
];
for (var i=0; i<data.length; i++) {
    if (typeof data[i] === 'number') var buf = qbson.encode({ a: data[i] });
    else var buf = BSON.serialize({ a: data[i] }, { serializeFunctions: true });
    if (isNaN(data[i])) assert(isNaN(qbson.decode(buf).a));
    else assert.deepStrictEqual(qbson.decode(buf).a, data[i]);
}

var buf = BSON.serialize({ a: new BSON.Long(1, -2) });
var x = qbson.decode(buf);
assert.equal(x.a.hi, -2 >>> 0);
assert.equal(x.a.lo, 1);
assert.equal(x.a.valueOf(), -2 * 0x100000000 + 1);

var buf = BSON.serialize({ a: new BSON.Timestamp(1, -2) });
var x = qbson.decode(buf);
assert.equal(x.a.hi, 1);
assert.equal(x.a.lo, -2 >>> 0);

var buf = BSON.serialize({ a: new BSON.MinKey() });
var x = qbson.decode(buf);
assert(x.a instanceof qbson.MinKey);

var buf = BSON.serialize({ a: new BSON.MaxKey() });
var x = qbson.decode(buf);
assert(x.a instanceof qbson.MaxKey);

var id = new qbson.ObjectId();
var buf = qbson.encode({ a: new qbson.DbRef("refname", new qbson.ObjectId("112233445566778899aabbcc")) });
var x = qbson.decode(buf);
assert.equal(x.a.$ref, 'refname');
assert(x.a.$id instanceof qbson.ObjectId);
assert.equal(x.a.$id.toString(), '112233445566778899aabbcc');
var xx = bson.deserialize(buf);
assert.ok(xx.a.db == 'refname' || xx.a.collection == 'refname');        // bson@4.0 breaking change to field names
assert.equal(xx.a.oid.toString(), '112233445566778899aabbcc');

var obj = function(abc){ return 123 + ab };
obj.scope = { ab: 12 };
var buf = qbson.encode({ a: obj });
var x = qbson.decode(buf);
assert(typeof x.a === 'function');
assert.deepEqual(x.a.scope, { ab: 12 });
assert.equal(String(x.a), String(obj));
assert.equal(x.a(1), 135);
// FIXME:
//assert(/^function\s*(abc)\s*{ return 123 + ab }$/.test(x.a.valueOf().toString()));

// objectId
var x = qbson.decode(new Buffer([20, 0, 0, 0, 7, 0x61, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 0]));
assert(x.a instanceof qbson.ObjectId);
assert.equal(String(x.a), '0102030405060708090a0b0c');

// obsolete undefined type
var x = qbson.decode(new Buffer([8, 0, 0, 0, 6, 0x61, 0, 0]));
assert.deepStrictEqual(x, { a: undefined });

// unknown type
assert.throws(function() { qbson.decode(new Buffer([7, 0, 0, 0, 0x55, 0, 0])) }, /unsupported bson .* 0x55/);

// overran end
assert.throws(function() { qbson.decode(qbson.encode({ a: {} }).slice(0, -1)) }, /overran/);

// bad stored string length
var buf = qbson.encode({ a: "foobar" });
buf[7] = 5;  // break length (was 6+1 = 7)
assert.throws(function() { qbson.decode(buf) }, /invalid/);

// ignores invalid regex flags
var buf = bson.serialize({ a: /foo/i });
assert.deepEqual(String(qbson.decode(buf).a), '/foo/i');
buf[11] = '3'.charCodeAt(0);  // change flag to invalid '3'
assert.deepEqual(String(qbson.decode(buf).a), '/foo/');

// allows regex string containing ascii NUL (yikes)
var buf = bson.serialize({ a: /foobar/i });
buf[8] = 0;  // poke NUL into middle of 'foo'
assert.deepEqual(String(qbson.decode(buf).a), '/f\x00obar/i');
buf[9] = 0;  // poke an adjacent NUL
assert.deepEqual(String(qbson.decode(buf).a), '/f\x00\x00bar/i');
// FIXME: this still breaks
// buf[12] = 0;  // wipe the trailing 'r', now ends in pretend empty flags
// assert.deepEqual(String(qbson.decode(buf).a), '/f\x00\x00ba\x00/i');


var buf, obj;

// values that BSON handles differently
var data = [
    undefined,
    new Buffer("foobar"),
    /foo\x00bar/, /foo\x00\x00\x00bar/, /foo\x00\x00/mig,
];

// Symbol
buf = new Buffer([ 0x18, 0, 0, 0, 0x0e, 0x61, 0, 0x0c, 0, 0, 0, 0x53, 0x79, 0x6d, 0x62, 0x6f, 0x6c, 0x20, 0x4e, 0x61, 0x6d, 0x65, 0, 0 ]);
obj = qbson.decode(buf);
assert.equal(typeof obj.a, (typeof Symbol !== 'undefined') ? 'symbol' : 'string'); 
_tryEval("assert.equal(obj.a.toString(), 'Symbol(Symbol Name)');");

// field names
var arr = [];
arr[1] = 1;
arr[22] = 22;
arr[333] = 333;
arr[4444] = 4444;
arr[55555] = 55555;
arr[666666] = 666666;
obj = { a: arr };
buf = qbson.encode(obj);
assert.deepEqual(qbson.decode(buf), obj);
