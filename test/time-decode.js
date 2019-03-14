var timeit = require('qtimeit');
var bson_decode = require('../decode');

var BSON = require('./bson');

var buffalo = require('buffalo');
buffalo.deserialize = BSON.parse;

var o = { a: 1, b: 2.5, c: "three", };
var o = { "_id" : "545cffef20f9c47358001ad5", "kid" : "k1", "kcoll" : "kc1", "db" : "db1", "coll" : "dc1", "active" : true };
// obj from K hackathon:
var o = {                               // 300%
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

var data = new Date();                  // 10%
var data = {a:1, b:2, c:3, d:4, e:5};   // 99% v5, 211% v6 (1.03 sec v5, but 2.3 sec v0.10 !?)
// cannot reproduce ?? (retimed at 11%)
var data = 12345;                       // 10%
var data = 1234.5;                      // 16%
var data = /fo[o]/i;                    // 30%
// (note: bson recovers binary as type Binary { _bsontype: 'Binary', sub_type: 0, position: N, buffer: data })
var data = new Buffer("ABCDE");         // 12%
var data = new Buffer(66000);           // 15% (or... 20x that can not reproduce??)
var data = BSON.ObjectID();             // 30% own scanString, 17% toString() for property names
var data = [1,2,3,4,5];                 // 680% (was 750% in early versions)
var data = {a: {b: {c: {d: {e: 5}}}}};  // extreme; 2-char var names half the speed!!
var data = {a2: {b2: {c2: {d2: {e2: 5}}}}};  // extreme; 2-char var names 1/4 the speed?!
var data = [1];
var data = [1,[2,[3,[4,[5]]]]];
var data = "ssssssssss";                // 5% @10
var data = "ssssssssssssssssssss";      // 4% @10 (using buf.toString)
var data = "ssss\u1234ssss";            // 2% @10 (buf.toString) (dev: -26% own; 4% w toString() for names)
var data = "ssss";                      // 17% @10 own (dev: 5% w toString (25% slower on v0.10.42, and 2x slower if own scan))
var data = new RegExp("fo\x00o\x00x\x03\x00", "i");     // -98% (ie, bson is 50x faster -- because the compat fixup is triggered)
var data = new RegExp("foo", "i");      // 37%
var data = ""; while (data.length < 250) data += "foo_\x81";    // 250 ch text with 20% 2-byte utf8
var data = o;                           // 235% (compound w/ array; 12% w/o)
var data = BSON.ObjectID("123456781234567812345678");

//var data = require("/home/andras/work/src/kds.git/package.json");
//var data = require("/home/andras/work/src/kds.git/config.json");
//var data = o;                           // 350% +/- (compound w/ array; 15% w/o)
//var data = require('./dataBatch.js');
//var data = require('./prod-data.js');
var data = new Array(20); for (var i=0; i<100; i++) data[i] = i;
var data = Object(); for (var i=0; i<100; i++) data[i] = i;
var data = 1234.5;
var data = {a: "ABC", b: 1, c: "DEFGHI\xff", d: 12345.67e-1, e: null, f: new Date(), g: {zz:12.5}, h: [1,2]};
var data = {a: "ABC", b: 1, c: "DEFGHI\xff", d: 12345.67e-1, e: null};  // 175%

//var data = o;

var o = new Object();
for (var i=0; i<10; i++) o['variablePropertyNameOfALongerLength_' + i] = data;          // 37 ch var names
//for (var i=0; i<10; i++) o['someLongishVariableName_' + i] = data;                      // 25 ch
//for (var i=0; i<10; i++) o['variablePropertyName_' + i] = data;                         // 26 ch var names
//for (var i=0; i<10; i++) o['varNameMiddle_' + i] = data;                                // 15 ch var names
//for (var i=0; i<10; i++) o['varNameS_' + i] = data;                                     // 10 ch var names
//for (var i=0; i<10; i++) o['var_' + i] = data;                                          // 5 ch var names

var fptime = function fptime() { var t = process.hrtime(); return t[0] + t[1] * 1e-9; }
// var x = BSON.serialize(o, false, true);
//console.log("AR: bson =", x);
//var x = BSON.serialize({a: 1, b: 2, c: [1,2,3], d: 4, e: 5});
//var x = BSON.serialize({a: [1]});
//var x = new Buffer([14, 0, 0, 0, 16, 65, 65, 65, 0, 1, 0, 0, 0, 0]);
//var x = BSON.serialize({a: -10.5});

//console.log("AR: encoded", x = BSON.serialize({a: 5.25}));
//console.log("AR: decoded", BSON.deserialize(x));
//console.log("AR: parsed", bson_decode(BSON.serialize(o), 0));

//console.log(x);
//console.log("AR: test", bson_decode(x, 0));

//var a = BSON.deserialize(x);
//var a = buffalo.parse(x);
var a;
var t1 = fptime();
for (i=0; i<100000; i++) {
  //x = BSON.serialize(o, false, true);
  // 46k/s 3-item, 30k/s 6-item
  //x = BSON.serialize(o);
  // 50/s

//  a = BSON.deserialize(x);
//  a = buffalo.parse(x);
//  a = bson_decode(x);
  // 360k/s 3-item, 125k/s 6-item (95-135k/s, variable) (kvm, 159-170k/s hw)
  // v5: 164k/s 3.5GHz AMD
  // v5: 70k/s for Kobj (81k/s v6)
//  a = buffalo.parse(x);
  // 390k/s 3-item (kvm)
//  a = bson_decode(x);
  // 575k/s 3-item (kvm, 720k/s hw)
  // 192-195k/s 6-item hw
  // 7% faster for 6-item kds row
  // v5: 182k/s 3.5GHz AMD (11% faster)
  // v5: 81k/s for Kobj (97k/s v6)
}
var t2 = fptime();
//console.log("AR: time for 100k: %d ms", t2 - t1, process.memoryUsage(), a && a[Object.keys(a)[0]]);
// init version: 22% faster, 20% less gc (?), less mem used

// warm up the heap (?)... throws off the 2nd timing run if not
var nloops = 40000;
//timeit(nloops, function(){ a = bson_decode(x) });
//timeit(nloops, function(){ a = bson_decode(x) });
//timeit(nloops, function(){ a = bson_decode(x) });
//console.log(a && a[Object.keys(a)[0]]);

var x = BSON.serialize(o);
x = BSON.serialize(data);
var json = JSON.stringify(data);
//timeit(nloops, function(){ a = JSON.parse(json) });
//console.log(json);

console.log("decoding " + json);

timeit.bench.timeGoal = 2;
timeit.bench.visualize = true;
timeit.bench({
    'BSON.deserialize': function(){ a = BSON.deserialize(x) },
    'buffalo.parse': function(){ a = buffalo.parse(x) },
    'qbson.decode': function(){ a = bson_decode(x) },
    'JSON.parse': function(){ a = JSON.parse(json) },

    'bson 2': function(){ a = BSON.deserialize(x) },
    'buffalo 2': function(){ a = buffalo.parse(x) },
    'qbson 2': function(){ a = bson_decode(x) },
    'json 2': function(){ a = JSON.parse(json) },

    'bson 3': function(){ a = BSON.deserialize(x) },
    'buffalo 3': function(){ a = buffalo.parse(x) },
    'qbson 3': function(){ a = bson_decode(x) },
    'json 3': function(){ a = JSON.parse(json) },
});

//timeit(nloops, function(){ a = BSON.deserialize(x) });
////console.log(a && a[Object.keys(a)[0]]);
//timeit(nloops, function(){ a = bson_decode(x) });
//timeit(nloops, function(){ a = BSON.deserialize(x) });
//timeit(nloops, function(){ a = bson_decode(x) });
//timeit(nloops, function(){ a = buffalo.parse(x) });
//timeit(nloops, function(){ a = buffalo.parse(x) });
////console.log(a && a[Object.keys(a)[0]]);

// object layout: 4B length (including terminating 0x00), then repeat: (1B type, name-string, 0x00, value), 0x00 terminator

// bson items:  type, name, value
//   name: NUL-terminated bytes (cannot contain NUL byte!)
//   value: type-specific value

// zero and sub-normals have 0 expoent, non-numbers all have exponent 7ff
// NaN: as 64-bit float 01 00 00 00 00 00 f0 7f
// Infinity: as float   00 00 00 00 00 00 f0 7f
// -Infinity: as float  00 00 00 00 00 00 f0 ff
// undefined as type null (0a)

// NOTE: sparse arrays are not handled
//     [1, , 3] is encoded to (and decodes as) [1, null, 3]

