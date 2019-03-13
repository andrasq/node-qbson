var bson_encode = require('../encode');

var assert = require('assert');
var util = require('util');
var timeit = require('qtimeit');
var BSON = require('../bson');
var buffalo = require('buffalo');
var bson_decode = require('../decode.js');
var qbson = require('../qbson');

// testObject with data repeated 10 times:
// obj from K hackathon:
var data = {                            // 1010%, 1125% short names (156% buffalo)
    ijk: 12,
    t: true,
    f: false,
    d: 1234.5,
    "st uv": "string\xff",
    "utf\xff": "utf8",
    n: null,
    a: [],
    aa: [1,,"three",undefined,5.5],
};
var data = 1234;                        // 225% (450% with short names!)
var data = 1234.5;                      // 225%
var data = "some \xfftf8 Text";
var data = ""; for (var i=0; i<40; i++) data += "xxxxxxxxxx";
var data = ""; for (var i=0; i<25; i++) data += "xxxxxxxxxx";
var data = ""; for (var i=0; i<50; i++) data += "xxxx\u00ff";
var data = {a:1, b:2, c:3, d:4, e:5};   // 780% (was 585%); 952% with 5-char field names!
var data = {a: "ABC", b: 1, c: "DEFGHI\x88", d: 12345.67e-1, e: null};  // 557%
var data = [1,2,3,4,5];                 // 705%
var data = {test: {test: {test: {}}}}   // 225% (244% for a:)
var data = {a: {b: {c: {d: {e: 5}}}}};  // 191% -> NOT! retimed 1275%
var data = new Date();                  // 220%
var data = new RegExp("fo[o]", "i");    // 450%, same as /fo[o]/i
var data = {a: new RegExp("fo\x00[o]", "i")};   // 230% (bug for bug compatible... sigh.)
var data = [1, [2, [3, [4, [5]]]]];     // 1250% (!!)
var data = {a: undefined};              // 390% long names, 760% short (gets converted to null by all 3 encoders)
var data = {};                          // 450% with long var names; 715% with short names
//var data = new Array(20); for (var i=0; i<100; i++) data[i] = i;        // 845%
//var data = BSON.ObjectId("123456781234567812345678");         // 100% base
//var data = new QBSON.ObjectId("123456781234567812345678");    // 215% vs bson.ObjectId()
//var data = buffalo.ObjectId("123456781234567812345678");      //  75% vs bson.ObjectId()
//var data = require('./prod-data.js');   // 500% ?! (with inlined guessSize, only 2x w/o)
var data = {a: "ABC", b: 1, c: "DEFGHI\xff", d: 12345.67e-1, e: null, f: new Date(), g: {zz:12.5}, h: [1,2]};   // 978%
var data = {a: "ABC", b: 1, c: "DEFGHI\xff", d: 12345.67e-1, e: null};  // 650%

var testObj = new Object();
var o = testObj;
for (var i=0; i<10; i++) o['variablePropertyNameOfALongerLength_' + i] = data;          // 37 ch var names
//for (var i=0; i<10; i++) o['someLongishVariableName_' + i] = data;                      // 25 ch
//for (var i=0; i<10; i++) o['var_' + i] = data;                                          // 5 ch

//console.log(bson_encode({a: data}));
//console.log(util.inspect(BSON.deserialize(bson_encode({a: data})), {depth: 6}));
assert.deepEqual(bson_encode(testObj), BSON.serialize(testObj));

var testObj = data;
var x;

console.log("encoding " + JSON.stringify(testObj));

timeit.bench.timeGoal = 2;
timeit.bench.visualize = true;
timeit.bench({
    'BSON.serialize': function(){ x = BSON.serialize(testObj) },
    'buffalo.serialize': function(){ x = buffalo.serialize(testObj) },
    'qbson.encode': function(){ x = bson_encode(testObj) },
    'JSON.stringify': function(){ x = JSON.stringify(testObj) },

    'bson 2': function(){ x = BSON.serialize(testObj) },
    'buffalo 2': function(){ x = buffalo.serialize(testObj) },
    'qbson 2': function(){ x = bson_encode(testObj) },
    'json 2': function(){ x = JSON.stringify(testObj) },

    'bson 3': function(){ x = BSON.serialize(testObj) },
    'buffalo 3': function(){ x = buffalo.serialize(testObj) },
    'qbson 3': function(){ x = bson_encode(testObj) },
    'json 3': function(){ x = JSON.stringify(testObj) },
});

if (0) {
var nloops = 40000;
timeit(nloops, function(){ x = bson_encode(testObj) });
timeit(nloops, function(){ x = bson_encode(testObj) });
timeit(nloops, function(){ x = bson_encode(testObj) });

timeit(nloops, function(){ x = JSON.stringify(testObj) });
timeit(nloops, function(){ x = JSON.stringify(testObj) });

timeit(nloops, function(){ x = BSON.serialize(testObj) });
timeit(nloops, function(){ x = BSON.serialize(testObj) });
timeit(nloops, function(){ x = BSON.serialize(testObj) });
console.log(BSON.serialize({a: data}));
timeit(nloops, function(){ x = bson_encode(testObj) });
timeit(nloops, function(){ x = bson_encode(testObj) });
timeit(nloops, function(){ x = bson_encode(testObj) });
console.log(bson_encode({a: data}));
timeit(nloops, function(){ x = buffalo.serialize(testObj) });
timeit(nloops, function(){ x = buffalo.serialize(testObj) });
timeit(nloops, function(){ x = buffalo.serialize(testObj) });
console.log(buffalo.serialize({a: data}));
}

//console.log("BSON.serialize:", BSON.serialize({a: data}));
//console.log("bson_encode:", bson_encode({a: data}));
//console.log("buffalo.serialize:", buffalo.serialize({a: data}));
//console.log("JSON.stringify:", JSON.stringify({a: data}));

