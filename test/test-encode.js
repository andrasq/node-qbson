'use strict';

var assert = require('assert');
var util = require('util');
var BSON = require('./bson');
var qbson = require('../');
var bsonTypes = require('../lib/bson-types');
var bsonSize = require('../lib/bson-size');

// wrap unsupported language features in eval() to not crash during file parse
function _tryEval(src) { try { return eval(str) } catch (e) { } }
function _tryEvalErr(src) { try { return eval(str) } catch (e) { return err } }

// tests by expected encoded hex string
var data = [
    [ "string", "1300000002610007000000737472696e670000" ],
    [ "str\x00ng", "1300000002610007000000737472006e670000" ],
    [ new Buffer("AAAA"), "1100000005610004000000004141414100" ],
    [ (typeof Symbol !== 'undefined') ? Symbol('Symbol Name') : null, (typeof Symbol !== 'undefined') ? "180000000e61000c00000053796d626f6c204e616d650000" : "08000000 <0a 6100 > 00" ],
    // [ _tryEval('Symbol("Symbol Name")') || null, _tryEval('Symbol()') && "180000000e61000c00000053796d626f6c204e616d650000" || "08000000 <0a 6100 > 00" ],
    // NOTE: bson encodes `undefined` as value `null`
    [ undefined, "0800000006610000" ],       // T_UNDEFINED
    // [ undefined, "080000000a610000" ],          // T_NULL
    [ qbson.ObjectId('0102030405060708090a0b0c'), "14 00 00 00 07 61 00 01 02 03 04 05 06 07 08 09 0a 0b 0c 00" ],
    [ new qbson.Timestamp(1, 2), "10 00 00 00 11 61 00 02 00 00 00 01 00 00 00 00" ],
    [ new qbson.Long(0x10000000, 2), "10000000126100020000000000001000" ],
    [ new qbson.MinKey(), "08000000ff610000" ],
    [ new qbson.MaxKey(), "080000007f610000" ],

    [ function (ab) { return 123 }, "29000000 <0d 6100 1d000000 '66756e6374696f6e 202861622920 7b20 72657475726e20313233 207d'+00> 00" ],
    [ new String("abc"), "10000000 02 6100 04000000 61626300 00" ],
    // NOTE: BSON.serialize encodes `new Number(1)` as the empty object {}
    [ new Number(1), "0c000000 10 6100 01000000 00" ],
    [ new Number(1.5), "10000000 01 6100 000000000000f83f 00" ],
    [ new Boolean(true), "09000000 08 6100 01 00" ],
    [ new Boolean(false), "09000000 08 6100 00 00" ],
    // TODO: [ new bsonTypes.Binary("foo"), "..." ],
    [ {x:1, y:null}, "{ 17000000 03 6100 { 0f000000 <10 7800 01000000> <0a 7900> 00 } 00 }" ],
    // FIXME: how should this encode? include y, or omit? Include as null, or undefined?  (bson omits by default)
    // We encode as T_UNDEFINED, all native types.
    // TODO: add options to configure behavior later.
    [ {x:1, y:undefined}, "{ 17000000 03 6100 { 0f000000 <10 7800 01000000> <06 7900> 00 } 00 }" ],

    // encodes as DbRef: asciiz refname, ObjectId
    // NOTE: decoding this format breaks bson
//    [ new bsonTypes.DbRef("foo", new bsonTypes.ObjectId("000000000000")),
//        "{ 18000000 0c 6100 { 666f6f00 303030303030303030303030 } 00" ],
    // X encodes as { $ref: "foo", $id: ObjectId() }
    //    "{ 2c000000 03 6100 { 24000000 <02 2472656600 04000000 666f6f00> <07 24696400 303030303030303030303030> 00 } 00 }" ],
    [ [undefined], "0d000000 04 6100 [ 05000000 00 ] 00" ],
];
for (var i=0; i<data.length; i++) {
    // squeeze out spaces from the hex string, for easier cut-and-paste
    data[i][1] = data[i][1].replace(/[^0-9a-fA-F]/g, "");

    //var bson = BSON.serialize({ a: data[i] });
    //console.log("AR:", bson.length, bson);
    var buf = qbson.encode({ a: data[i][0] });
//console.log("AR: encoded as '%s'", buf.toString('hex'), data[i][0]);
//console.log("AR:", buf.length, data[i][0], buf.toString('hex'), data[i][1]);
    assert.equal(buf.toString('hex'), data[i][1]);

    // BSON breaks on some data; skip those
    // qbson will encode `undefined` (deprecated), which is not handled correctly by BSON
    if (data[i][0] === undefined) continue;

    var decoded = BSON.deserialize(buf);

    if (!data[i][0]) assert.strictEqual(decoded.a, data[i][0]);

    var err = _tryEvalErr('if (data[i][0].constructor === Symbol) assert.deepEqual("Symbol(" + decoded.a + ")", String(data[i][0]))');
    if (err && !/Symbol is not defined/.test(err.message)) throw err;

    switch (data[i][0] != null && data[i][0].constructor) {
    case Buffer:
        // { _bsontype: 'Binary', buffer: buf }
        assert.deepEqual(decoded.a.buffer, data[i][0]);
        break;
    // case Symbol:
    //     assert.deepEqual("Symbol(" + decoded.a + ")", data[i][0].toString());
    //     break;
    case qbson.ObjectId:
        assert.equal(decoded.a, String(data[i][0]));
        break;
    case qbson.Timestamp:
        // high 4 bytes are timestamp, low 4 bytes are sequence number
        assert.ok(decoded.a.high_ == data[i][0].hi || decoded.a.high == data[i][0].hi); // bson@4.0 breaking field rename
        assert.ok(decoded.a.low_ == data[i][0].lo || decoded.a.low == data[i][0].lo);   // bson@4.0 breaking field rename
        break;
    case qbson.Long:
        // NOTE: BSON.deserialize returns Long as a number if it fits!
        assert.ok(decoded.a.high_ == data[i][0].hi || decoded.a.high == data[i][0].hi); // bson@4.0 breaking field rename
        assert.ok(decoded.a.low_ == data[i][0].lo || decoded.a.low == data[i][0].lo);   // bson@4.0 breaking field rename
        break;
    default:
        // bson.deserialize encodes `new Number(1)` as the empty object {}
    }
}

var obj = { a: undefined };
var buf = qbson.encode(obj);
assert.deepEqual(qbson.decode(buf), obj);

// tests that compare against BSON.serialize
// Note that BSON does not handle all items; those are tested above.
var items = [
    1,
    -2.5,
    3e200,
    "foo",
    "foo\x81bar",
    function(x) { return x + 1234 },
    null,
    true,
    false,
    // undefined, -- bson skips undefined values, qb
    {},
    {x:1, foo: {}},
    [],
    [1, 2.5, {three:3}, ['four']],
    new Date(),
    new Date(1234567890),
// TODO: ObjectId encodes as an object with BSON
//    new qbson.ObjectId('1234abcd1234'),
    /foo/,
//    /foo/img, //-- bson 1.0.4 breaks test, it stores 'sim' instead of 'gim' (invalid, flags must be sorted)
//    /foo/imguy, //-- bson 1.0.4 breaks test, it stores 'sim' instead of 'gim' (invalid, flags must be sorted)
];
for (var i=0; i<items.length; i++) {
    var bytes = qbson.encode({ a: items[i] });
    var a = qbson.decode(bytes).a;
    // note: on node pre-v8, /g regex flag proxies for /s
    assert.equal(String(a), String(items[i]));
    var bsonDecoded = BSON.deserialize(bytes);
    var bson = BSON.serialize({ a: items[i] }, { serializeFunctions: true });
//console.log("AR: test", bytes, bson);
    assert.equal(bytes.toString('hex'), bson.toString('hex'), "test item " + i + ': ' + items[i] + ': ' + bytes.toString('hex') + ' vs bson ' + bson.toString('hex'));
}

var rex = parseInt(process.versions.node) >= 8 ? new RegExp('foo', 'imsu') : /foo/im;
var rexflags = parseInt(process.versions.node) >= 8 ? ['i', 'm', 's', 'u'] : ['i', 'm'];
assert.deepEqual(qbson.decode(qbson.encode({ a: rex })).a, rex);
rexflags.forEach(function(flag) { assert.deepEqual(qbson.decode(qbson.encode({ a: new RegExp('foo', flag) })).a, new RegExp('foo', flag)) });

// custom classes encode as objects
function MyClass() { this.a = 1; }
var buf = qbson.encode({ a: new MyClass() });
var buf2 = qbson.encode({ a: { a: 1 } });
assert.deepEqual(buf, buf2);

// guessSize
assert.equal(bsonSize.guessSize([]), 5);
assert.equal(qbson.encode([]).length, 5);
assert.equal(bsonSize.guessSize([1]), 12);
assert.equal(bsonSize.guessSize({}), 5);
assert.equal(qbson.encode({}).length, 5);
assert.equal(bsonSize.guessSize([[]]), 13);
assert.equal(qbson.encode([[]]).length, 13);
assert.deepEqual(qbson.decode(qbson.encode([[]])), [[]]);

// 3-deep array
var buf = qbson.encode({"": [[]]});
assert.deepEqual(qbson.decode(buf), {"": [[]]});

// Decimal128
var buf = qbson.encode({ a: new bsonTypes.Decimal128(1, 2, 3, -1) });
//console.log(buf, BSON.deserialize(buf));
assert.deepEqual(qbson.decode(buf), { a: new bsonTypes.Decimal128(1, 2, 3, 0xffffffff) });
