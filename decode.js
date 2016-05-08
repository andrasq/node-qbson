/**
 * fledgeling bson decoder
 *
 * for timings, to see how much room there is for bson speedup
 * (not that much... maybe 20-30%, but {...} and esp [...] are much faster)
 *
 * Copyright (C) 2015-2016 Andras Radics
 * Licensed under the Apache License, Version 2.0
 */

'use strict';

module.exports = bson_decode;

var ObjectId = require('./object-id.js');

function bson_decode( buf ) {
    return getBsonEntities(buf, 4, buf.length - 1, new Object(), false);
}

function getBsonEntities( buf, base, bound, target, asArray ) {
    var s0 = { val: 0, end: 0 };
    var type, subtype, name, len, start;

    while (base < bound) {
        start = base;
        type = buf[base++];
        (asArray) ? scanInt(buf, base, s0) : scanString(buf, base, s0);
        name = s0.val;
        base = s0.end + 1;  // skip string + NUL

        switch (type) {
        case 0x10:      // signed 32-bit little-endian int (10%)
            target[name] = getInt32(buf, base);
            base += 4;
            break;
        case 0x02:      // counted utf8 string, length *not* part of count
            var len = getUInt32(buf, base);
            base += 4;
            var end = base + len - 1;
            target[name] = (len < 10) ? getString(buf, base, end) : buf.toString('utf8', base, end);
            base = end + 1;
            if (buf[base-1] !== 0) throw new Error("invalid bson, string at " + start + " not zero terminated");
            break;
        case 0x03:      // object, length part of count
            var len = getUInt32(buf, base);
            target[name] = getBsonEntities(buf, base+4, base+len-1, new Object());
            base += len;
            break;
        case 0x04:      // array, length part of count
            var len = getUInt32(buf, base);
            target[name] = getBsonEntities(buf, base+4, base+len-1, new Array(), true);
            base += len;
            break;
        case 0x01:      // 64-bit ieee 754 little-endian float
            target[name] = getFloat(buf, base);
            base += 8;
            break;
        case 0x08:      // 1B, boolean
            target[name] = buf[base] ? true : false;
            base += 1;
            break;
        case 0x0a:      // null
            target[name] = null;
            break;
        case 0x05:      // binary
            var len = getUInt32(buf, base);
            var subtype = buf[base+4];
            base += 5;
            target[name] = buf.slice(base, base+len);
            if (subtype !== 0) target[name].subtype = subtype;
            base += len;
            // TODO: why does bson return the Buffer wrappered in an object?
            // { _bsontype: 'Binary', sub_type: 0, position: N, buffer: data }
            // we annotate with .subtype like `buffalo` does
            break;
        case 0x06:      // deprecated (undefined)
            target[name] = undefined
            break;
        case 0x07:      // ObjectId
            target[name] = new ObjectId().setFromBuffer(buf, base);
            base += 12;
            break;
        case 0x09:      // Date()
            target[name] = new Date(getInt64(buf, base));
            base += 8;
            break;
        case 0x0b:      // RegExp()
            scanRegExp(buf, base, s0);
            target[name] = s0.val;
            base = item.end + 1;
            break;
        case 0x12:      // int64
            target[name] = getInt64(buf, base);
            base += 8;
        case 0x0c:      // deprecated (db ref)
        case 0x0d:      // Function()
        case 0x0e:      // symbol
        case 0x0f:      // code with scope
        case 0x11:      // timestamp
        default:
            throw new Error("unsupported bson entity type 0x" + type.toString(16) + " at offset " + start);
            break;
        }
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
    return buf[pos] +
        (buf[pos+1] << 8) +
        (buf[pos+2] << 16) +
        ((buf[pos+3] << 24) >>> 0);     // coerce to unsigned
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
    // this trick should work for 2-s complement + and - numbers within range
    // note that overflow of a negative could flip the sign!
    return (v1 * 0x100000000) + getUInt32(buf, pos);
}

// extract the 64-bit little-endian ieee 754 floating-point value 
function getFloat( buf, pos ) {
    // see http://en.wikipedia.org/wiki/Double-precision_floating-point_format
    // 1 bit sign + 11 bits exponent + (1 hidden 1 bit) + 52 bits mantissa (stored)

    var lowWord = getUInt32(buf, pos);
    var highWord = getUInt32(buf, pos+4);
    var scaledMantissa = (highWord & 0xFFFFF) + lowWord * (1/0x100000000);
    var exponent = (highWord & 0x7FF00000) >> 20;
    var sign = (highWord & 0x80000000) ? -1 : 1;

    var value;
    if (exponent === 0x7ff) {
        // zero mantissa is signed Infinity, nonzero mantissa is NaN
        if (scaledMantissa) value = NaN;
        else value = Infinity;
    }
    else if (exponent === 0x000) {
        // zero and subnormals (small values)
        if (!scaledMantissa) value = 0;
        else value = scaledMantissa * (1/0x100000)
    }
    else {
        // normalized values with an implied 53rd 1 bit and 1023-biased exponent
        exponent -= 1023;
        value = 1 + scaledMantissa * (1/0x100000);
        value = value * pow2(exponent);
    }
    return (sign >= 0) ? value : -value;
}

// given an exponent n, return 2**n
function pow2( exp ) {
    // n is always an integer, a shift is faster (when possible)
    return (exp >= 0 && exp < 31) ? 1 << exp : (exp < 0 && exp > -31) ? 1 / (1 << -exp) : Math.pow(2, exp);

    return Math.pow(2, exp);
}

// extract a decimal number string
function scanInt( buf, base, item ) {
    var n = 0;
    for (var i=base; buf[i]; i++) {
        n = n * 10 + buf[i] - 0x30;
    }
    item.val = n;
    item.end = i;
}

// get the NUL-terminated string
function scanString( buf, base, item ) {
    for (var i=base; buf[i]; i++) ;
    item.end = i;
    return item.val = buf.toString('utf8', base, i);
}

// get the NUL-terminated utf8 string.  Note that utf8 allows embedded NUL chars.
// concatenating chars generates more gc activity, and is only faster for short strings
function scanStringUtf8( buf, base, item ) {
    var ch, str = "", code;
    for (var i=base; buf[i]; i++) {
        ch = buf[i];
        if (ch < 0x80) str += String.fromCharCode(ch);
        else if (ch < 0xE0) str += String.fromCharCode(((ch & 0x1F) <<  6) + (buf[++i] & 0x3F));
        else if (ch < 0xF0) str += String.fromCharCode(((ch & 0x0F) << 12) + ((buf[++i] & 0x3F) << 6) + (buf[++i] & 0x3F));
        // TODO: should validity test succeeding chars
    }
    item.val = str;
    item.end = i;
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
function scanRegExp( buf, base, item ) {
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
    item.end = base;
}

function createRegExp( pattern, flags ) {
    try {
        return new RegExp(pattern, flags);
    } catch (err) {
        return new RegExp(pattern);
    }
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

var data = new Date();                  // 16% (10% on 8, 16% on 10, 8% on 20)
var data = {a:1, b:2, c:3, d:4, e:5};   // 99% v5, 211% v6 (1.03 sec v5, but 2.3 sec v0.10 !?)
// cannot reproduce ?? (retimed at 15%)
var data = 12345;                       // 6%
var data = 1234.5;                      // 13%
var data = /fo[o]/i;                    // 33%
// (note: bson recovers binary as type Binary { _bsontype: 'Binary', sub_type: 0, position: N, buffer: data })
var data = new Buffer("ABCDE");         // 12%
var data = new Buffer(66000);           // 15% (or 20x ?? ...can not reproduce??)
var data = bson.ObjectID();             // 25% own scanString, 17% toString() for property names
var data = [1,2,3,4,5];                 // 750% (!! wow)
var data = "ssssssssss";                // -1% @10
var data = "ssssssssssssssssssss";      // -1% @10 (using buf.toString)
var data = "ssss\u1234ssss";            // -1% @10 (buf.toString), -26% own; 4% w toString() for names
var data = "ssss";                      // 15% @10 own ; 5% w toString (25% slower on v0.10.42, and 2x slower if own scan)
var data = new RegExp("fo\x00o\x00x\x03\x00", "i");     // FIXME: used to work, now breaks?!
var data = new RegExp("foo", "i");
var data = o;

var data = 1234.5;                      // 13%
var data = o;
var data = {a:1, b:2, c:3, d:4, e:5};   // 99% v5, 211% v6 (1.03 sec v5, but 2.3 sec v0.10 !?)
var data = [1,2,3,4,5];


var o = new Object();
for (var i=0; i<10; i++) o['variablePropertyNameOfALongerLength_' + i] = data;

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
  a = bson_decode(x);
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
timeit(10000, function(){ a = bson_decode(x) });

timeit(10000, function(){ a = BSON.deserialize(x) });
timeit(10000, function(){ a = bson_decode(x) });
timeit(10000, function(){ a = buffalo.parse(x) });

// object layout: 4B length (including terminating 0x00), then repeat: (1B type, name-string, 0x00, value), 0x00 terminator

// bson items:  type, name, value
// name: NUL-terminated bytes (cannot contain NUL byte!)
// value: type-specific value
/** from buffalo/lib/bson.js, with notes by AR:
var FLOAT_TYPE             = 1                                  // 64-bit IEEE 754 float
var STRING_TYPE            = 2                                  // 4B count (including NUL byte) + NUL-terminated string
var EMBEDDED_DOCUMENT_TYPE = 3                                  // length (including terminating zero byte) + items contents
var ARRAY_TYPE             = 4                                  // length, then ascii numeric key then value; then terminating 0 byte
var BINARY_TYPE            = 5
var UNDEFINED_TYPE         = 6 // deprecated
var OBJECT_ID_TYPE         = 7
var BOOLEAN_TYPE           = 8                                  // 1B, 00 or 01
var DATE_TIME_TYPE         = 9
var NULL_TYPE              = 0x0A                               // null and undefined, no value
var REG_EXP_TYPE           = 0x0B
var DB_REF_TYPE            = 0x0C // deprecated
var CODE_TYPE              = 0x0D
var SYMBOL_TYPE            = 0x0E
var CODE_WITH_SCOPE_TYPE   = 0x0F
var INT32_TYPE             = 0x10                               // 4B 32-bit signed little-endian
var TIMESTAMP_TYPE         = 0x11
var INT64_TYPE             = 0x12
var MIN_KEY                = 0xFF
var MAX_KEY                = 0x7F

var BINARY_GENERIC_SUBTYPE      = 0x00
var BINARY_FUNCTION_SUBTYPE     = 0x01
var BINARY_OLD_SUBTYPE          = 0x02
var BINARY_UUID_SUBTYPE         = 0x03
var BINARY_MD5_SUBTYPE          = 0x05
var BINARY_USER_DEFINED_SUBTYPE = 0x80
**/

// NaN: as 64-bit float 01 00 00 00 00 00 f0 7f
// Infinity: as float   00 00 00 00 00 00 f0 75
// -Infinity: as float  00 00 00 00 00 00 f0 ff
// undefined as type null (0a)

// NOTE: sparse arrays are not handled
//     [1, , 3] is encoded to (and decodes as) [1, null, 3]


/**/
}
