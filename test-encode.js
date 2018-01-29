'use strict';

var assert = require('assert');
var BSON = new (require('bson'))();
var qbson = require('./qbson');
var bsonTypes = require('./bson-types');

// tests by expected encoded hex string
var data = [
    [ "string", "1300000002610007000000737472696e670000" ],
    [ new Buffer("AAAA"), "1100000005610004000000004141414100" ],
    [ Symbol("Symbol Name"), "180000000e61000c00000053796d626f6c204e616d650000" ],
    [ undefined, "0800000006610a00" ],
    [ qbson.ObjectId('0102030405060708090a0b0c'),       "14 00 00 00 07 61 00 01 02 03 04 05 06 07 08 09 0a 0b 0c 00" ],
    [ new bsonTypes.Timestamp(1, 2),                    "10 00 00 00 11 61 00 02 00 00 00 01 00 00 00 00" ],
    // [ new bsonTypes.DbRef("collname", new bsonTypes.ObjectId("12345678abcd")), "1d0000000c6100636f6c6c6e616d650031323334353637386162636400" ],
];
for (var i=0; i<data.length; i++) {
    // squeeze out spaces from the hex string, for easier cut-and-paste
    data[i][1] = data[i][1].replace(/ /g, "");

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

    switch (decoded.a._bsontype) {
    // BSON decodes binary data into an encapsulated object, not a buffer,
    // but encodes a Buffer into subtype 0 binary (ie, encode is not reversible)
    case 'Binary':
        assert.deepEqual(decoded.a.buffer, data[i][0]);
        break;

    // BSON decodes Symbol into an internal object type whose typeof is not 'symbol'
    case 'Symbol':
        assert.deepEqual("Symbol(" + decoded.a + ")", data[i][0].toString());
        break;

    case 'ObjectID':
        assert.equal(decoded.a, String(data[i][0]));
        break;

    case 'Timestamp':
        // high 4 bytes are timestamp, low 4 bytes are sequence number
        assert.equal(decoded.a.high_, data[i][0].time);
        assert.equal(decoded.a.low_, data[i][0].seq);
        break;

    default:
        assert.deepEqual(decoded, { a: data[i][0] });
        break;
    }
}

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
    /foo/img,
    /foo/imguy,
];
for (var i=0; i<items.length; i++) {
    var bytes = qbson.encode({ a: items[i] });
    var bsonDecoded = BSON.deserialize(bytes);
    var bson = BSON.serialize({ a: items[i] }, { serializeFunctions: true });
//console.log("AR: test", bytes, bson);
    assert.equal(bytes.toString('hex'), bson.toString('hex'), null, "test item " + i);
}
