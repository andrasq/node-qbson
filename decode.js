/**
 * bson decoder
 *
 * This file is derived from andrasq/node-json-simple/lib/parse-bson.js
 *
 * See also http://bsonspec.org/spec.html
 *
 * Copyright (C) 2015-2016 Andras Radics
 * Licensed under the Apache License, Version 2.0
 */

'use strict';

module.exports = bson_decode;


var bsonTypes = require('./bson-types');

var ObjectId = bsonTypes.ObjectId;
var Timestamp = bsonTypes.Timestamp;
var MinKey = bsonTypes.MinKey;
var MaxKey = bsonTypes.MaxKey;
var Long = bsonTypes.Long;

function bson_decode( buf ) {
    return getBsonEntities(buf, 4, buf.length - 1, new Object(), false);
}

function getBsonEntities( buf, base, bound, target, asArray ) {
    var s0 = { val: 0, end: 0 };
    var type, subtype, name, start;

    while (base < bound) {
        start = base;
        type = buf[base++];
        (asArray) ? scanIntZ(buf, base, s0) : scanStringZ(buf, base, s0);
        name = s0.val;
        base = s0.end + 1;  // skip string + NUL

        var value;
        switch (type) {
        case 16:
            value = getInt32(buf, base);
            base += 4;
            break;
        case 14:
        case 2:
            base = scanString(buf, base, bound, s0);
            value = s0.val;
            break;
        case 3:
            var len = getUInt32(buf, base);
            value = getBsonEntities(buf, base+4, base+len-1, new Object());
            base += len;
            break;
        case 4:
            var len = getUInt32(buf, base);
            value = getBsonEntities(buf, base+4, base+len-1, new Array(), true);
            base += len;
            break;
        case 1:
            value = getFloat(buf, base);
            base += 8;
            break;
        case 5:
            base = scanBinary(buf, base, bound, s0);
            value = s0.val;
            break;
        case 6:
            value = undefined
            break;
        case 7:
            value = new ObjectId().setFromBuffer(buf, base);
            base += 12;
            break;
        case 8:
            value = buf[base] ? true : false;
            base += 1;
            break;
        case 9:
            value = new Date(getInt64(buf, base));
            base += 8;
            break;
        case 10:
            value = null;
            break;
        case 11:
            base = scanRegExp(buf, base, bound, s0);
            value = s0.val;
            break;
        case 18:
            value = new Long(getUInt32(buf, base), getUInt32(buf, base+4));
            base += 8;
        case 13:
            base = scanString(buf, base, bound, s0);
            value = bsonTypes.makeFunction(s0.val);
            break;
        case 15:
            // length is redundant, skip +4
            base = scanString(buf, base+4, bound, s0);
            var len = getUInt32(buf, base);
            var scope = getBsonEntities(buf, base+4, base+len-1, new Object())
            value = bsonTypes.makeFunction(s0.val, scope);
            base += len;
            break;
        case 17:
            value = new Timestamp(getUInt32(buf, base), getUInt32(buf, base+4));
            base += 8;
            break;
        case 255:
            value = new MinKey();
            break;
        case 127:
            value = new MaxKey();
            break;
        case 12:        // stringZ name, 12B ref
        default:
            throw new Error("unsupported bson entity type 0x" + type.toString(16) + " at offset " + start);
            break;
        }

        target[name] = value;
        if (base > bound) throw new Error("truncated bson, overran end from " + start);
    }
    return target;
}

// recover the utf8 string between base and bound
// The bytes are expected to be valid utf8, no checking is done.
// Handles utf16 only (16-bit code points), same as javascript.
// Note: faster for short strings, slower for long strings
// Note: generates more gc activity than buf.toString
function getString( buf, base, bound ) {
    var ch, str = "", code;
    for (var i=base; i<bound; i++) {
        ch = buf[i];
        if (ch < 0x80) str += String.fromCharCode(ch);  // 0xxx xxxx
        else if (ch < 0xE0) str += String.fromCharCode(((ch & 0x1F) <<  6) + (buf[++i] & 0x3F));  // 110x xxxx  10xx xxxx
        else if (ch < 0xF0) str += String.fromCharCode(((ch & 0x0F) << 12) + ((buf[++i] & 0x3F) << 6) + (buf[++i] & 0x3F));  // 1110 xxxx  10xx xxxx  10xx xxxx
    }
    return str;
}

function getUInt32( buf, pos ) {
    return getInt32(buf, pos) >>> 0;    // coerced to unsigned
}

function getInt32( buf, pos ) {
    return buf[pos] +
        (buf[pos+1] << 8) +
        (buf[pos+2] << 16) +
        (buf[pos+3] << 24);             // yes shift into the sign bit, coerce to signed
}

function getInt64( buf, pos ) {
    // extract a Number from 64-bit signed integer
    // Not all 64-bit ints are representable, Number has only 53 bits of precision.
    var v1 = getInt32(buf, pos+4);
    // this trick should work for 2-s complement +/- numbers within range
    // note that overflow of a negative could flip the sign!
    return (v1 * 0x100000000) + getUInt32(buf, pos);
}

/*
 * extract the 64-bit little-endian ieee 754 floating-point value 
 *   see http://en.wikipedia.org/wiki/Double-precision_floating-point_format
 *   1 bit sign + 11 bits exponent + (1 hidden mantissa 1 bit) + 52 bits mantissa (stored)
 */
// recover the mantissa into a 20.32 bit fixed-point float,
// then convert by shifting into the normalized 1.53 format
// The mantissa low 32 bits become the 20.32 fixed-point fraction,
// then the whole thing is scaled to the normalized 1.53 position.
var _rshift32 = (1 / 0x100000000);      // >> 32 for floats
var _rshift20 = (1 / 0x100000);         // >> 20 for floats
var _lshift32 = (1 * 0x100000000);      // << 32
var _rshift52 = (1 * _rshift32 * _rshift20);    // >> 52
function getFloat( buf, pos ) {
    var lowWord = getUInt32(buf, pos);
    var highWord = getUInt32(buf, pos+4);
    var mantissa = (highWord & 0x000FFFFF) * _lshift32 + lowWord;
    var exponent = (highWord & 0x7FF00000) >> 20;
    //var sign = (highWord >> 31);

    var value;
    if (exponent === 0x000) {
        // zero if !mantissa, else subnormal (non-normalized reduced precision small value)
        // recover negative zero -0.0 as distinct from 0.0
        // subnormals do not have an implied leading 1 bit and are positioned 1 bit to the left
        value = mantissa ? (mantissa * _rshift52) * pow2(-1023 + 1) : (highWord >> 31) ? -0.0 : 0.0;
    }
    else if (exponent < 0x7ff) {
        // normalized value with an implied leading 1 bit and 1023 biased exponent
        exponent -= 1023;
        value = (1 + mantissa * _rshift52) * pow2(exponent);
    }
    else {
        // Infinity if zero mantissa (+/- per sign), NaN if nonzero mantissa
        value = mantissa ? NaN : Infinity;
    }

    return (highWord >> 31) ? -value : value;  // sign bit
}
// given an exponent n, return 2**n
// n is always an integer, faster to shift when possible
function pow2( exp ) {
    return (exp >= 0) ? (exp <  31 ? (1 << exp) :        Math.pow(2, exp))
                      : (exp > -31 ? (1 / (1 << -exp)) : Math.pow(2, exp));
}

// extract a decimal number string
function scanIntZ( buf, base, item ) {
    var n = 0;
    for (var i=base; buf[i]; i++) {
        n = n * 10 + buf[i] - 0x30;
    }
    item.val = n;
    return (item.end = i) + 1;
}

// get the NUL-terminated string
function scanStringZ( buf, base, item ) {
    for (var i=base; buf[i]; i++) ;
    // breakeven is around 13 chars (node 5; more with node 6)
    if (i < base + 12) return scanStringUtf8(buf, base, item);
    item.val = buf.toString('utf8', base, i);
    return (item.end = i) + 1;
}

// get the NUL-terminated utf8 string.  Note that utf8 allows embedded NUL chars.
// concatenating chars generates more gc activity, and is only faster for short strings
function scanStringUtf8( buf, base, item ) {
    var ch, str = "", code;
    for (var i=base; buf[i]; i++) {
        ch = buf[i];
        if (ch < 0x80) str += String.fromCharCode(ch);  // 0xxx xxxx
        else if (ch < 0xE0) str += String.fromCharCode(((ch & 0x1F) <<  6) + (buf[++i] & 0x3F));  // 110x xxxx  10xx xxxx
        else if (ch < 0xF0) str += String.fromCharCode(((ch & 0x0F) << 12) + ((buf[++i] & 0x3F) << 6) + (buf[++i] & 0x3F));  // 1110 xxxx  10xx xxxx  10xx xxxx
        // TODO: should validity test succeeding chars
    }
    item.val = str;
    return (item.end = i) + 1;
}

// extract a regular expression from the bson buffer
    // YIKES!  bson 0.3.2 encodes \x00 in the regex as a zero byte, which breaks the bson string!!
    // it needs to be overlong-encoded as <C0 80> for it to work correctly
    // (bson seems to recover scanning the bytes, just breaks the regex pattern)
    // % node -p 'bson = require("bson"); bson.BSONPure.BSON.serialize({a: new RegExp("fo\x00[o]", "i")});'
    // <Buffer 11 00 00 00 0b 61 00 66 6f 00 5b 6f 5d 00 69 00 00>
    //                        a:    f  o  ^^ [  o  ]     /i
    // hack: try to find the actual end of the regex entity.  The next entity will
    // begin at a type code following a 00 following a valid regex flag 0x00 or [imx].
    // The type codes MIN_KEY and MAX_KEY not supported.  bson searches similarly.
    // TODO: given the actual end, can work backward to recover actual flags and pattern.
    // TODO: having to find the end runs 10x slower!
    // Approach:
    // look for an [00|i|m|x] to 00 to [1..12] transition, that should be the next entity
    // Having to run the hack loop is hugely slower.
function scanRegExp( buf, base, bound, item ) {
    var s1 = { val: 0, end: 0 }, s2 = { val: 0, end: 0 };
    // extract
    scanStringUtf8(buf, base, s1);
    scanStringUtf8(buf, s1.end + 1, s2);
    item.val = createRegExp(s1.val, s2.val);
    base = s2.end + 1;

    // hack
    if (buf[base] === 0 || buf[base] > 0x12) {
        while (base < bound) {
            if (buf[base]) base++;              // find 00
            else if (buf[++base] <= 0x12) {     // followed by type code
                var ch = buf[base-2];           // after a 00 or [imx]
                if (ch === 0x00 || ch === 0x69 || ch === 0x6d || ch == 0x78) break;
            }
        }
    }
    return item.end = base;
}

function createRegExp( pattern, flags ) {
    try {
        return new RegExp(pattern, flags);
    } catch (err) {
        return new RegExp(pattern);
    }
}

// recover the string entity from the bson
function scanString( buf, base, bound, item ) {
    var len = getUInt32(buf, base);
    base += 4;
    var end = base + len - 1;
    if (buf[end] !== 0) throw new Error("invalid bson, string at " + start + " not zero terminated");
    // our pure js getString() is faster for short strings
    item.val = (len < 20) ? getString(buf, base, end) : buf.toString('utf8', base, end);
    return item.end = end + 1;
}

function scanBinary( buf, base, bound, item ) {
    var len = getUInt32(buf, base);
    var subtype = buf[base+4];
    base += 5;
    item.val = buf.slice(base, base+len);
    item.val.subtype = buf[base-1];
    return item.end = base += len;

    // TODO: why does bson return the Buffer wrappered in an object?
    // { _bsontype: 'Binary', sub_type: 0, position: N, buffer: data }
    // We return a Buffer annotated with .subtype like `buffalo` does.
}


// quicktest:
if (process.env['NODE_TEST'] === 'decode') {
///**
var timeit = require('qtimeit');

var bson = require('bson');
var BSON = require('bson').BSONPure.BSON;

var buffalo = require('buffalo');
buffalo.deserialize = BSON.parse;

var o = { a: 1, b: 2.5, c: "three", };
var o = { "_id" : "545cffef20f9c47358001ad5", "kid" : "k1", "kcoll" : "kc1", "db" : "db1", "coll" : "dc1", "active" : true };
// obj from K hackathon:
var o = {
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
var data = bson.ObjectID();             // 30% own scanString, 17% toString() for property names
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
var data = bson.ObjectId("123456781234567812345678");

//var data = require("/home/andras/work/src/kds.git/package.json");
//var data = require("/home/andras/work/src/kds.git/config.json");
//var data = o;                           // 350% +/- (compound w/ array; 15% w/o)
//var data = require('./dataBatch.js');
//var data = require('./prod-data.js');
var data = new Array(20); for (var i=0; i<100; i++) data[i] = i;
var data = Object(); for (var i=0; i<100; i++) data[i] = i;
var data = 1234.5;
var data = {a: "ABC", b: 1, c: "DEFGHI\xff", d: 12345.67e-1, e: null};

var o = new Object();
//for (var i=0; i<10; i++) o['variablePropertyNameOfALongerLength_' + i] = data;          // 37 ch var names
for (var i=0; i<10; i++) o['someLongishVariableName_' + i] = data;                // 25 ch
//for (var i=0; i<10; i++) o['variablePropertyName_' + i] = data;                         // 26 ch var names
//for (var i=0; i<10; i++) o['varNameMiddle_' + i] = data;                                // 15 ch var names
//for (var i=0; i<10; i++) o['varNameS_' + i] = data;                                     // 10 ch var names
//for (var i=0; i<10; i++) o['var_' + i] = data;                                          // 5 ch var names

var fptime = function fptime() { var t = process.hrtime(); return t[0] + t[1] * 1e-9; }
var x = BSON.serialize(o, false, true);
//console.log("AR: bson =", x);
//var x = BSON.serialize({a: 1, b: 2, c: [1,2,3], d: 4, e: 5});
//var x = BSON.serialize({a: [1]});
//var x = new Buffer([14, 0, 0, 0, 16, 65, 65, 65, 0, 1, 0, 0, 0, 0]);
//var x = BSON.serialize({a: -10.5});

//console.log("AR: encoded", x = BSON.serialize({a: 5.25}));
//console.log("AR: decoded", BSON.deserialize(x));
//console.log("AR: parsed", bson_decode(BSON.serialize(o), 0));

console.log(x);
//console.log("AR: test", bson_decode(x, 0));

console.log(x.length, ":", x, getFloat(x, 7));
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
console.log("AR: time for 100k: %d ms", t2 - t1, process.memoryUsage(), a && a[Object.keys(a)[0]]);
// init version: 22% faster, 20% less gc (?), less mem used

// warm up the heap (?)... throws off the 2nd timing run if not
var nloops = 40000;
timeit(nloops, function(){ a = bson_decode(x) });
timeit(nloops, function(){ a = bson_decode(x) });
timeit(nloops, function(){ a = bson_decode(x) });
//console.log(a && a[Object.keys(a)[0]]);

var json = JSON.stringify(data);
timeit(nloops, function(){ a = JSON.parse(json) });
//console.log(json);

timeit(nloops, function(){ a = BSON.deserialize(x) });
//console.log(a && a[Object.keys(a)[0]]);
timeit(nloops, function(){ a = bson_decode(x) });
timeit(nloops, function(){ a = BSON.deserialize(x) });
timeit(nloops, function(){ a = bson_decode(x) });
timeit(nloops, function(){ a = buffalo.parse(x) });
timeit(nloops, function(){ a = buffalo.parse(x) });
//console.log(a && a[Object.keys(a)[0]]);

// object layout: 4B length (including terminating 0x00), then repeat: (1B type, name-string, 0x00, value), 0x00 terminator

// bson items:  type, name, value
//   name: NUL-terminated bytes (cannot contain NUL byte!)
//   value: type-specific value

// NaN: as 64-bit float 01 00 00 00 00 00 f0 7f
// Infinity: as float   00 00 00 00 00 00 f0 75
// -Infinity: as float  00 00 00 00 00 00 f0 ff
// undefined as type null (0a)

// NOTE: sparse arrays are not handled
//     [1, , 3] is encoded to (and decodes as) [1, null, 3]


/**/
}
