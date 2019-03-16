/**
 * Copyright (C) 2019 Andras Radics
 * Licensed under the Apache License, Version 2.0
 */

var qtimeit = require('qtimeit');

var BSON = require('./test/bson');
var qbson = require('./');
var buffalo = require('buffalo');

var str250 = new Array(51).join('xxxxx');
var str250utf8 = new Array(51).join('xxxx\x00ff');
var array100 = []; for (var i=0; i<100; i++) array100[i] = i;
var object100 = {}; for (var i=0; i<100; i++) object100[i] = i;
var anav2r = {
    _id: '20190317.itemtype1234', cc: 12345, au: 12, tu: 123, ds: 1234567, fs: 123456
};
var anav2 = {
    _id: '20190317.itemtype1234',
    lmt: new Date().toISOString(),
    u: {
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: null,
        bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb: null,
        cccccccccccccccccccccccccccccccccccc: null,
        dddddddddddddddddddddddddddddddddddd: null,
    }
};
var datasets = {
//    'int': 1234,
//    'float': 1234.5,
//    'text': "some \xfftf8 Text",
    // 'text 250': new Array(51).join("xxxxx"),
//    'text 250 20% utf8': new Array(51).join("xxxx\u00ff"),
//    '{}': {},
//    'regex': /fo[o]/i,
//    'array[5]': [1,2,3,4,5],
//    'array[sparse 5]': [1,,,,5],
//    'object[5]': {a:1,b:2,c:3,d:4,e:5},
    // 'array[100]': array100,
    // 'object[100]': object100,
//    'nested array[5]': [1,[2,[3,[4,[5]]]]],
//    'nested object[5]': {a:{b:{c:{d:{e:5}}}}},
    // ObjectId
    'canonical test object': { a: "ABC", b: 1, c: "DEFGHI\xff", d: 12345.67e-1, e: null },
    //'test object with text 250 20%utf8': { a: "ABC", b: 1, c: "DEFGHI\xff", d: 12345.67e-1, e: null, f: str250utf8 },
    //'teeeest object': { aaaa: "ABC", bbbb: 1, cccc: "DEFGHI\xff", dddd: 12345.67e-1, eeee: null },
    'anav2 item': anav2,
    //'anav2r item': anav2r,
// FIXME: encode for this is *very* slow... because it exceeds the magic 100k fast-array limit? but only pushing chars!
// A: because cannot array.write the string into the array, must copy byte-by-byte.  Or build a tree of objects, and just make a buffer out of long strings?
//'test': { 'very large payload': 'x'.repeat(100000) }
}
var x;

function createBuffer(data) { return Buffer.from ? Buffer.from(data) : new Buffer(data) }

qtimeit.bench.timeGoal = .4;
qtimeit.bench.visualize = true;
qtimeit.bench.showRunDetails = false;
//qtimeit.bench.showTestInfo = false;

for (k in datasets) {
    var data = { a: datasets[k] };
    console.log("\n%s ----", k, JSON.stringify(data).slice(0, 400));

    var bytes = BSON.serialize(data);
    // var bytes = qbson.encode(data);
    var xj = createBuffer(JSON.stringify(data));
    var y;

if (0)
    qtimeit.bench({
        'qbson.encode': function() {
            x = qbson.encode(data);
        },
    })

if (0)
    qtimeit.bench({
        'bson': function() {
            x = BSON.serialize(data);
        },
        'buffalo.serialize': function() {
            x = buffalo.serialize(data);
        },
        'json': function() {
            x = createBuffer(JSON.stringify(data));
        },
        'qbson': function() {
            x = qbson.encode(data);
        },
    })

if (1)
    qtimeit.bench({
        'bson': function() {
            y = BSON.deserialize(bytes);
        },
        'buffalo.parse': function() {
            y = buffalo.parse(bytes);
        },
        'json': function() {
            y = JSON.parse(xj);
        },
        'qbson': function() {
            y = qbson.decode(bytes);
        },
    })
    qtimeit.bench.showPlatformInfo = false;
}
//console.log(x.length, JSON.stringify(x).slice(0, 400));
if (x) console.log(x.length, x);
