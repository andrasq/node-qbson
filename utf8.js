/**
 * utf8 functions
 *
 * Copyright (C) 2016 Andras Radics
 * Licensed under the Apache License, Version 2.0
 *
 * 2016-05-06 - AR.
 */

'use strict';

module.exports = {
    encodeUtf8: encodeUtf8,
    decodeUtf8: null,
    toJSON: null,
    stringLength: null,
};


var byteHexMap = new Array();
for (var i=0; i<16; i++) byteHexMap[i] = '0' + i.toString(16);
for (var i=16; i<256; i++) byteHexMap[i] = i.toString(16);

// note: proto does not match buf.write(string, base, bound, encoding)
// a js loop is faster for short strings, but quickly loses out to buf.toString().length
function stringLength( buf, encoding, base, bound ) {
    if (base === undefined) base = 0;
    if (bound === undefined) bound = buf.length;

    var length = 0;
    switch (encoding) {
    case 'utf8':
        for (var i=base; i<bound;) {
            length += 1;
            if (buf[i] < 0x80) i += 1;
            // multi-byte utf8 chars are of the form [11...][10...][10...]
            i++;
            while ((buf[i] & 0xC0) === 0x80) i++;
        }
        break;
    case 'hex': return (bound - base) * 2;
    default: return buf.toString(encoding, base, bound).length;
    }
    return length;
}

// handle the mechanics of utf8-encoding a 16-bit javascript code point
// does not filter for invalid utf8 code points
function encodeUtf8Char( code, target, offset ) {
    if (code & 0xF800) {
        // >11 bits, 3-byte:  1110 xxxx  10xx xxxx  10xx xxxx
        target[offset++] = 0xE0 | (code >> 12) & 0x0F;
        target[offset++] = 0x80 | (code >> 6) & 0x3F;
        target[offset++] = 0x80 | (code) & 0x3F;
    }
    else if (code & 0xFF80) {
        // >7 bits, 2-byte:  110x xxxx  10xx xxxx
        target[offset++] = 0xC0 | (code >> 6) & 0x3F;
        target[offset++] = 0x80 | (code) & 0x3F;
    }
    else {
        // 1-byte:  0xxx xxxx
        target[offset++] = code;
    }
    return offset;
}

// write the utf8 string into the target buffer to offset
// The buffer must be large enough to receive the entire converted string (not checked)
// Notes:
//   Utf8 stores control chars as-is, but json needs them \u escaped.
//   code points D800..DFFF are not valid utf8 (Rfc-3629),
//   node encodes them all as FFFF - 2, FFFD (chars EF BF BD)
function encodeUtf8( string, from, to, target, offset ) {
    var code;
    for (var i=from; i<to; i++) {
        code = string.charCodeAt(i);
        if (code < 0x80) target[offset++] = code;
        // overlong encode 0x00 to fix RegExp in BSON... except BSON reads it as two chars ?!
        // also, writing is as <00> matches buf.write()
        //if (code < 0x80) { if (code) target[offset++] = code; else { target[offset++] = 0xC0; target[offset++] = 0x80; } }
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

var s1 = "0123456789abcdef\x00\x01\x02\x03\u1001\u1002\u1003\u1004abcd";
var s2 = "ssssssssssssssssssss";
var s3 = "ssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssss";
var s3 = "ssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssss";
// v5: about 2m/s for 100 chars; breakeven around 95? (ie, faster if < 95)
//var s4 = s4 + s4 + s4 + s4 + s4 + s4 + s4 + s4 + s4 + s4;
var s4 = "sssssssss\u1004sssssssss\u1004sssssssss\u1004sssssssss\u1004sssssssss\u1004sssssssss\u1004sssssssss\u1004sssssssss\u1004sssssssss\u1004sssssssss\u1004";
// v5: js consistently faster when has 10% 3-byte utf8
var s5 = "ssssssssssssssssssss\x01ssssssssssssssssssss\x01";
var s6 = "ssssssssssssssssssss\x01";
var s7 = "ssssssssssssssssssssssssssssssssssssssssssssssssssssssssssss";
var s8 = "\u0081\u0082\u0083\u0084\u0081\u0082\u0083\u0084\u0081\u0082\u0083\u0084\u0081\u0082\u0083\u0084\u0081\u0082\u0083\u0084";
var s = s8;
var buf = new Buffer(20000);
var x;

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
