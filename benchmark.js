/**
 * Copyright (C) 2019 Andras Radics
 * Licensed under the Apache License, Version 2.0
 */

var qtimeit = require('qtimeit');

var qbson = require('./');
var bson = require('bson');

var BSON = new bson();

var str250 = new Array(51).join('xxxxx');
var str250utf8 = new Array(51).join('xxxx\x00ff');
var array100 = []; for (var i=0; i<100; i++) array100[i] = i;
var object100 = {}; for (var i=0; i<100; i++) object100[i] = i;
var datasets = {
//    'int': 1234,
//    'float': 1234.5,
//    'text': "some \xfftf8 Text",
    // 'text 250': new Array(51).join("xxxxx"),
//    'text 250 20% utf8': new Array(51).join("xxxx\u00ff"),
//    '{}': {},
//    'regex': /fo[o]/i,
    'array[5]': [1,2,3,4,5],
    'object[5]': {a:1,b:2,c:3,d:4,e:5},
    // 'array[100]': array100,
    // 'object[100]': object100,
    'nested array[5]': [1,[2,[3,[4,[5]]]]],
    'nested object[5]': {a:{b:{c:{d:{e:5}}}}},
    // ObjectId
    'test object': { a: "ABC", b: 1, c: "DEFGHI\xff", d: 12345.67e-1, e: null },
    // 'test object with text 250 20%utf8': { a: "ABC", b: 1, c: "DEFGHI\xff", d: 12345.67e-1, e: null, f: str250utf8 },
//    'teeeest object': { aaaa: "ABC", bbbb: 1, cccc: "DEFGHI\xff", dddd: 12345.67e-1, eeee: null },
}
var x;

qtimeit.bench.timeGoal = .4;
qtimeit.bench.visualize = true;
qtimeit.bench.showRunDetails = false;
//qtimeit.bench.showTestInfo = false;

for (k in datasets) {
    var data = { a: datasets[k] };
    console.log("\n%s ----", k, data);

    var bytes = BSON.serialize(data);
    var xj = new Buffer(JSON.stringify(data));

if (0)
    qtimeit.bench({
        'bson': function() {
            x = BSON.serialize(data);
        },
        'qbson': function() {
            x = qbson.encode(data);
        },
        'json': function() {
            x = new Buffer(JSON.stringify(data));
        },
    })

if (1)
    qtimeit.bench({
        'bson': function() {
            y = BSON.deserialize(bytes);
        },
        'qbson': function() {
            y = qbson.decode(bytes);
        },
        'json': function() {
            y = JSON.parse(xj);
        },
    })
    qtimeit.bench.showPlatformInfo = false;
}
console.log(y);
