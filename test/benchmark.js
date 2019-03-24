/**
 * Copyright (C) 2019 Andras Radics
 * Licensed under the Apache License, Version 2.0
 */

// npm install qtimeit bson buffalo https://github.com/andrasq/node-q-msgpack https://github.com/andrasq/node-json-simple

var qtimeit = require('qtimeit');

var BSON = require('./bson');
var qbson = require('../');
var buffalo = require('buffalo');
var msgpack = require('q-msgpack');
var jss = require('json-simple');
var Bsonext = tryRequire('bson-ext');
var bsonext = Bsonext && new Bsonext([Bsonext.Binary, Bsonext.Code, Bsonext.DBRef, Bsonext.Decimal128, Bsonext.Double, Bsonext.Int32, Bsonext.Long, Bsonext.Map, Bsonext.MaxKey, Bsonext.MinKey, Bsonext.ObjectId, Bsonext.BSONRegExp, Bsonext.Symbol, Bsonext.Timestamp]);;
var msgpackjavascript = tryRequire('/home/andras/src/msgpack-javascript.git/');
var bion = require('bion');
var qxpack = tryRequire('../dev/qxpack');

function tryRequire(name) { try { return require(name) } catch (e) { return null } }

var newBuffer = require('../lib/new-buffer');

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
    //'text': "some \xfftf8 Text",
    // 'text 250': new Array(51).join("xxxxx"),
    //'text 250 20% utf8': new Array(51).join("xxxx\u00ff"),
    //'{}': {},
    //'regex': /fo[o]/i,
//    'array[5]': [1,2,3,4,5],
//    'array[sparse 5]': [1,,,,5],
//    'object[5]': {a:1,b:2,c:3,d:4,e:5},
    // 'array[100]': array100,
    // 'object[100]': object100,
//    'nested array[5]': [1,[2,[3,[4,[5]]]]],
//    'nested object[5]': {a:{b:{c:{d:{e:5}}}}},
    // ObjectId
    'canonical test object': { a: "ABC", b: 1, c: "DEFGHI\xff", d: 12345.67e-1, e: null },
//    'msgpack test': {"a":1.5,"b":"foo","c":[1,2],"d":true,"e":{}},
    //'test object with text 250 20%utf8': { a: "ABC", b: 1, c: "DEFGHI\xff", d: 12345.67e-1, e: null, f: str250utf8 },
    //'teeeest object': { aaaa: "ABC", bbbb: 1, cccc: "DEFGHI\xff", dddd: 12345.67e-1, eeee: null },
    //'anav2 item': anav2,
    //'anav2r item': anav2r,
    //'logline': require('./logline'),
//'test': { 'very large payload': 'x'.repeat(100000) }
}
var x, jx, y, jy, qx, qy;

function createBuffer(data) { return Buffer.from ? Buffer.from(data) : new Buffer(data) }

qtimeit.bench.timeGoal = 5;
qtimeit.bench.visualize = true;
qtimeit.bench.showRunDetails = false;
//qtimeit.bench.baselineAvg = 500e3;
//qtimeit.bench.showTestInfo = false;

for (k in datasets) {
    var data = { a: datasets[k] };
    console.log("\n%s ----", k, JSON.stringify(data).slice(0, 400));

    var bytes = BSON.serialize(data);
    var bytes = qbson.encode(data);
    var xj = (JSON.stringify(data));
    var msgpackbytes = newBuffer.from(msgpackjavascript.pack(data));
    var bionbytes = bion.encode(data);
    if (qxpack) var qxbyte = qxpack.encode(data);
    var y;

if (0)
    qtimeit.bench({
        'qbson.encode': function() {
            x = qbson.encode(data);
        },
    })

if (1)
    console.log("");
    console.log("encode:");
    qtimeit.bench({
        'bson': function() {
            x = BSON.serialize(data);
        },
        'buffalo.serialize': function() {
            x = buffalo.serialize(data);
        },
        'q-msgpack': function() {
            x = msgpack.encode(data);
        },
        'qbson': function() {
            qx = qbson.encode(data);
        },
        'json': function() {
            jx = newBuffer.from(JSON.stringify(data));
        },
        'json-simple': function() {
            x = newBuffer.from(jss.encode(data));
        },
        'bson-ext': function() {
            if (!bsonext) return;
            x = bsonext.serialize(data);
        },
        'msgpackjavascript': function() {
            x = newBuffer.from(msgpackjavascript.pack(data));
        },
        'bion': function() {
            x = bion.encode(data);
        },
        'qxpack': function() {
            x = qxpack.encode(data);
        },
    })

if (1)
    console.log("");
    console.log("decode:");
    qtimeit.bench({
        'bson': function() {
            y = BSON.deserialize(bytes);
        },
        'buffalo.parse': function() {
            y = buffalo.parse(bytes);
        },
        'qbson': function() {
            qy = qbson.decode(bytes);
        },
        'json': function() {
            jy = JSON.parse(xj);
        },
        'json-simple': function() {
            jy = jss.decode(xj);
        },
        'bson-ext': function() {
            if (!bsonext) return;
            y = bsonext.deserialize(bytes);
        },
        'msgpackjavascript': function() {
            y = msgpackjavascript.unpack(msgpackbytes);
        },
        'bion': function() {
            y = bion.decode(bionbytes);
        },
        'qxpack': function() {
            y = qxpack.decode(qxbyte);
        },
    })
    qtimeit.bench.showPlatformInfo = false;
}
//console.log(x.length, JSON.stringify(x).slice(0, 400));
//if (x) console.log(x.length, x);
if (y) console.log(JSON.stringify(y).slice(0, 400));
//if (qx) console.log(qx.length, qx, qbson.decode(qx));
