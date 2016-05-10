/**
 * calls to read/write utf8 text into buffers
 *
 * Copyright (C) 2016 Andras Radics
 * Licensed under the Apache License, Version 2.0
 *
 * 2016-05-06 - AR.
 */

'use strict';

module.exports = {
    encodeUtf8: encodeUtf8,
    decodeUtf8: decodeUtf8,
    byteLength: null,
    stringLength: null,
};


var byteHexMap = new Array();
for (var i=0; i<16; i++) byteHexMap[i] = '0' + i.toString(16);
for (var i=16; i<256; i++) byteHexMap[i] = i.toString(16);

// note: proto does not match buf.write(string, base, bound, encoding)
// a js loop is faster for short strings, but quickly loses out to buf.toString().length
function stringLength( buf, base, bound, encoding ) {
    if (base === undefined) base = 0;
    if (bound === undefined) bound = buf.length;

    var length = 0;
    switch (encoding) {
    case undefined:
    case 'utf8':
        for (var i=base; i<bound;) {
            length += 1;
            if (buf[i] < 0x80) { i++; }
            // multi-byte utf8 chars are of the form [11...][10...][10...]
            else { while ((buf[++i] & 0xC0) === 0x80) ; }
        }
        break;
    case 'hex': return (bound - base) * 2;
    default: return buf.toString(encoding, base, bound).length;
    }
    return length;
}

// handle the mechanics of utf8-encoding a 16-bit javascript code point
// The caller must filter out invalid utf8 code points.
// Node inlines this and optimizes away the redundant 7-bit check at the top
function encodeUtf8Char( code, target, offset ) {
    if (code <= 0x7F) {
        // 7 bits:  0xxx xxxx
        target[offset++] = code;
    }
    else if (code <= 0x07FF) {
        // 8..11 bits, 2-byte:  110x xxxx  10xx xxxx
        target[offset++] = 0xC0 | (code >> 6) & 0x3F;
        target[offset++] = 0x80 | code & 0x3F;
    }
    else {
        // 11..16 bits, 3-byte:  1110 xxxx  10xx xxxx  10xx xxxx
        target[offset++] = 0xE0 | (code >> 12) & 0x0F;
        target[offset++] = 0x80 | (code >> 6) & 0x3F;
        target[offset++] = 0x80 | (code) & 0x3F;
    }
    return offset;
}

/*
 * write the utf8 string into the target buffer to offset
 * The buffer must be large enough to receive the entire converted string (not checked)
 * Notes:
 *   Utf8 stores control chars as-is, but json needs them \u escaped.
 *   code points D800..DFFF are not valid utf8 (Rfc-3629),
 *   node encodes them all as FFFF - 2, FFFD (chars EF BF BD)
 */
function encodeUtf8( string, from, to, target, offset ) {
    var code;
    for (var i=from; i<to; i++) {
        code = string.charCodeAt(i);
        if (code <= 0x7F) target[offset++] = code;
        // overlong encode 0x00 to fix RegExp in BSON... except BSON reads it as two chars ?!
        // also, writing is as <00> matches buf.write()
        //if (code <= 0x7F) { if (code) target[offset++] = code; else { target[offset++] = 0xC0; target[offset++] = 0x80; } }
        else if (code >= 0xD800 && code <= 0xDFFF) {
            target[offset++] = 0xEF; target[offset++] = 0xBF; target[offset++] = 0xBD;
        }
        else offset = encodeUtf8Char(code, target, offset);
    }
    return offset;
}

/*
 * recover the utf8 string between base and bound
 * The bytes are expected to be valid utf8, no checking is done.
 * Handles utf16 only (16-bit code points), same as javascript.
 * Note: faster for short strings, slower for long strings
 * Note: generates more gc activity than buf.toString
 */
function decodeUtf8( buf, base, bound ) {
    var str = "", code;
    for (var i=base; i<bound; i++) {
        var ch = buf[i];
        if (ch < 0x80) str += String.fromCharCode(ch);  // 0xxx xxxx
        else if (ch < 0xE0) str += String.fromCharCode(((ch & 0x1F) <<  6) + (buf[++i] & 0x3F));  // 110x xxxx  10xx xxxx
        else if (ch < 0xF0) str += String.fromCharCode(((ch & 0x0F) << 12) + ((buf[++i] & 0x3F) << 6) + (buf[++i] & 0x3F));  // 1110 xxxx  10xx xxxx  10xx xxxx
    }
    return str;
}

/*
 * encode the string into valid json.  Json is like utf8, but
 * it \u escapes control characters.
 */
var hexCharCodes = [ '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f' ];
for (var i=0; i<hexCharCodes.length; i++) hexCharCodes[i] = hexCharCodes[i].charCodeAt(0);
function encodeJsonControl( code, target, offset ) {
    target[offset++] = 0x5c;  // \
    target[offset++] = 0x75;  // u
    target[offset++] = 0x30;  // 0
    target[offset++] = 0x30;  // 0
    target[offset++] = hexCharCodes[code >> 4];
    target[offset++] = hexCharCodes[code & 0x0F];
    return offset;
}
function encodeJson( string, from, to, target, offset ) {
    var code;
    for (var i=from; i<to; i++) {
        code = string.charCodeAt(i);
        if (code < 0x20) offset = encodeJsonControl(code);
        else if (code < 0x80) target[offset++] = code;
        else if (code >= 0xD800 && code <= 0xDFFF) {
            target[offset++] = 0xEF; target[offset++] = 0xBF; target[offset++] = 0xBD;
        }
        else offset = encodeUtf8Char(code, target, offset);
    }
    return offset;
}


if (process.env['NODE_TEST'] === 'utf8') {
///** quicktest:

var assert = require('assert');
var timeit = require('qtimeit');

var s1 = "0123456789abcdef\x00\x01\x02\x03\u1001\u1002\u1003\u1004abcd"; // 313%
var s2 = "ssssssssssssssssssss"; // 325%
var s3 = "ssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssss"; // 200ch: 50%
var s3 = "ssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssss";  // 100ch: 86%
var s3 = "ssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssss"; // 64ch: 115%
var s3 = "ssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssss"; // 80ch: 106%
// v5: about 2m/s for 100 chars; breakeven around 95? (ie, faster if < 95)
//var s4 = s4 + s4 + s4 + s4 + s4 + s4 + s4 + s4 + s4 + s4;
var s4 = "sssssssss\u1004sssssssss\u1004sssssssss\u1004sssssssss\u1004sssssssss\u1004sssssssss\u1004sssssssss\u1004sssssssss\u1004sssssssss\u1004sssssssss\u1004"; // 100ch, 10% 3-byte uft8: 175%
var s4 = "sssssssss\u01ffsssssssss\u01ffsssssssss\u01ffsssssssss\u01ffsssssssss\u01ffsssssssss\u01ffsssssssss\u01ffsssssssss\u01ffsssssssss\u01ffsssssssss\u01ff"; // 100ch, 10% 2-byte uft8: 175% 9-bit and up codes
var s4 = "sssssssss\u0081sssssssss\u0081sssssssss\u0081sssssssss\u0081sssssssss\u0081sssssssss\u0081sssssssss\u0081sssssssss\u0081sssssssss\u0081sssssssss\u0081"; // 100ch, 10% 2-byte uft8: 88% - 8-bit codes... mapped?
// v5: js consistently faster when has 10% 3-byte utf8
var s5 = "ssssssssssssssssssss\x01ssssssssssssssssssss\x01";
var s6 = "ssssssssssssssssssss\x01";
var s7 = "ssssssssssssssssssssssssssssssssssssssssssssssssssssssssssss";
var s8 = "\u0081\u0082\u0083\u0084\u0081\u0082\u0083\u0084\u0081\u0082\u0083\u0084\u0081\u0082\u0083\u0084\u0081\u0082\u0083\u0084";
var buf = new Buffer(20000);
var x;

var s = s4;

console.log("AR: test string:", s);
timeit(400000, function(){ buf.write(s, 0, Buffer.byteLength(s)) });
timeit(400000, function(){ buf.write(s, 0, Buffer.byteLength(s)) });
timeit(400000, function(){ buf.write(s, 0, Buffer.byteLength(s)) });

timeit(400000, function(){ encodeUtf8(s, 0, s.length, buf, 0) });
timeit(400000, function(){ encodeUtf8(s, 0, s.length, buf, 0) });
timeit(400000, function(){ encodeUtf8(s, 0, s.length, buf, 0) });
console.log(buf);
// 10k v5: 4m/s s1, 6m/s s2, 770k/s s3, 1.37m/s s4, 3.2m/s s5, 5.7m/s s6, 2.4m/s s7
// 400k: v5: 5.3m/s s1, 9.2m/s s2, 1.0m/s s3, 1.5m/s s4, 4.65m/s s5, 8.7m/s s6, 3.3m/s s7, 5.35m/s s8
// FASTER for all but very long ascii strings

// note: buf.write() returns the number of bytes written, and does not split chars.
// But what happens when end of buffer is reached?  (how to know when to grow buffer?)
timeit(400000, function(){ buf.write(s, 0, Buffer.byteLength(s)) });
timeit(400000, function(){ buf.write(s, 0, Buffer.byteLength(s)) });
timeit(400000, function(){ buf.write(s, 0, Buffer.byteLength(s)) });
console.log(buf);
// 10k v5: 1.3m/s s1, 1.9m/s s2, 1.65m/s s3, 685k/s s4, 1.95m/s s5, 1.9m/s s6, 1.9m/s s7, 2.4m/s s8
// 400k v5: 1.6m/s s1, 2.5m/s s2, 2.1m/s s3, 755k/s s4, 2.48m/s s5,s6,s7, 2.37m/s s8

var buf1 = new Buffer([0,0,0,0,1]);
var buf2 = new Buffer([0,0,0,0,1]);
for (var i=0; i<0x10000; i++) {
    encodeUtf8(String.fromCharCode(i), 0, 1, buf1, 0);
    buf2.write(String.fromCharCode(i), 0);
    assert.deepEqual(buf1, buf2);
}
// code points D800..DFFF are not valid utf8.  Node encodes them as 0xFFFF - 2
//var buf = new Buffer("\uFFFE");
//console.log(buf);
// test: compatibility of the first 10k code points (or all 65k?) (compare vs buf.write)
// test: compatibility of json coding with JSON.parse()

/**/
}
