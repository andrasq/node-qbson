/**
 * Byte handling, read and write data to/from byte arrays.
 *
 * The `get` functions take a byte array and return the value at offset
 * or between the offset and bound.
 *
 * The `put` functions take a value, byte array and offset, and store the
 * value at offset.
 *
 * The `scan` functions take a byte array and populate the given byteEntity
 * with the value at offset and the end of the value, and return the offset
 * of the next value in the array.  (The end and next value offset may be
 * different if the value is terminated explicitly, eg NUL terminated strings.)
 *
 * The default storage order for the bytes is little-endian (least significant
 * byte at the lowest address).
 *
 * Copyright (C) 2016-2018 Andras Radics
 * Licensed under the Apache License, Version 2.0
 *
 * 2016-05-27 - AR.
 */

var float = require('ieee-float');
var utf8 = require('./utf8-2');

module.exports = {
    byteEntity: function(){ return {val: 0, end: 0} },

    // ---- get
    getInt32: getInt32,
    getInt32LE: getInt32,
    getUInt32: getUInt32,
    getUInt32LE: getUInt32,

    getInt64: getInt64,
    getInt64LE: getInt64,

    getFloat: getFloat,
    getFloat64: getFloat,
    getFloat64LE: getFloat,

    // ---- put
    putInt32: putInt32,
    putInt32LE: putInt32,
    putUInt32: putInt32,
    putUInt32LE: putInt32,

    putInt64: putInt64,
    putInt64LE: putInt64,

    putFloat: putFloat,
    putFloat64: putFloat,
    putFloat64LE: putFloat,

    putString: putString,
    putStringZ: putStringZ,
    putStringZOverlong: putStringZOverlong,

    // ---- scan
    scanIntZ: scanIntZ,
    scanStringZ: scanStringZ,
    scanStringUtf8: scanStringUtf8,
};


function getUInt32( buf, pos ) {
    return getInt32(buf, pos) >>> 0;    // coerced to unsigned
}

function getInt32( buf, pos ) {
    return buf[pos] +
        (buf[pos+1] << 8) +
        (buf[pos+2] << 16) +
        (buf[pos+3] << 24);             // yes shift into the sign bit, coerce to signed
}

function putInt32( n, target, offset ) {
    target[offset++] = n & 0xFF;
    target[offset++] = (n >> 8) & 0xFF;
    target[offset++] = (n >> 16) & 0xFF;
    target[offset++] = (n >> 24) & 0xFF;
    return offset;
}


function getInt64( buf, pos ) {
    // extract a Number from 64-bit signed integer
    // Not all 64-bit ints are representable, Number has only 53 bits of precision.
    var v1 = getInt32(buf, pos+4);
    // this trick should work for 2-s complement +/- numbers within range
    // note that overflow of a negative could flip the sign!
    return (v1 * 0x100000000) + getUInt32(buf, pos);
}

function putInt64( n, target, offset ) {
    putInt32(n, target, offset);
    if (n >= 0) {
        n /= 0x100000000;
        putInt32(n, target, offset+4);
    } else {
        n = (n / 0x100000000);
        // if remaining fraction is smaller than |1|, rest is all sign bit
        if (!(n <= -1)) putInt32(-1, target, offset+4);
        // else cancel the +1 inherent in the separate 2s-complement conversion of the hiword
        else putInt32(n - 1, target, offset+4);
    }
    return offset + 8;
}


/*
 * functions to read and write 32-bit and 64-bit IEEE-754 floating-point
 * moved into the `ieee-float` package - AR.
 */

function getFloat( buf, pos ) {
    return float.readDoubleLE(buf, pos);
}

function putFloat( v, target, offset ) {
    float.writeDoubleLE(target, v, offset);
    return offset + 8;
}


// extract a decimal numeric "cstring" as a number
// Used for bson array indexes, which are stored as numeric strings.
function scanIntZ( buf, base, entity ) {
    var n = 0;
    for (var i=base; buf[i]; i++) {
        n = n * 10 + buf[i] - 0x30;
    }
    entity.val = n;
    return (entity.end = i) + 1;
}

// get the NUL-terminated utf8 "cstring" string
function scanStringZ( buf, base, entity ) {
    for (var i=base; buf[i]; i++) ;
    // breakeven is around 13 chars (node 5; more with node 6)
    if (i < base + 12 || buf instanceof Array) return scanStringUtf8(buf, base, entity);
    entity.val = buf.toString('utf8', base, i);
    return (entity.end = i) + 1;
}

// get the NUL-terminated utf8 string.  Note that utf8 allows embedded NUL chars.
// concatenating chars generates more gc activity, and is only faster for short strings
// 1-byte utf8 0xxx xxxx
// 2-byte utf8 110x xxxx 10xx xxxx
// 3-byte utf8 1110 xxxx 10xx xxxx 10xx xxxx
// 4-byte utf8 1111 0xxx 10xx xxxx 10xx xxxx 10xx xxxx -- not valid as javascript chars
// Note: String.fromCharCode() uses low 16 bits and breaks 4-byte utf8 chars.

// FIXME: Leading, also called high, surrogates are from D80016 to DBFF16, and trailing, or
// low, surrogates are from DC0016 to DFFF16. They are called surrogates, since they do not
// represent characters directly, but only as a pair.
//
// Unpaired surrogates are invalid in UTFs. These include any value in the range D80016 to
// DBFF16 not followed by a value in the range DC0016 to DFFF16, or any value in the range
// DC0016 to DFFF16 not preceded by a value in the range D80016 to DBFF16.

function scanStringUtf8( buf, base, entity ) {
    var ch, str = "", code;
    for (var i=base; buf[i]; i++) {
        ch = buf[i];
        if (ch < 0x80) str += String.fromCharCode(ch);  // 0xxx xxxx
        else if (ch < 0xE0) str += String.fromCharCode(((ch & 0x1F) <<  6) + (buf[++i] & 0x3F));  // 110x xxxx  10xx xxxx
        else if (ch < 0xF0) str += String.fromCharCode(((ch & 0x0F) << 12) + ((buf[++i] & 0x3F) << 6) + (buf[++i] & 0x3F));  // 1110 xxxx  10xx xxxx  10xx xxxx
        // TODO: should validity test succeeding chars
    }
    entity.val = str;
    return (entity.end = i) + 1;
}


function putStringZ( s, target, offset ) {
    if (typeof s !== 'string') s = '' + s;
    offset = putString(s, target, offset);
    target[offset++] = 0;
    return offset;
}

function putString( s, target, offset ) {
    if (s.length < 50 || target instanceof Array) return utf8.write(target, offset, s, 0, s.length);
    else return offset + target.write(s, offset, 'utf8');
}

// write a NUL-terminated utf8 string, but overlong-encode embedded NUL bytes
function putStringZOverlong( s, target, offset ) {
    offset = utf8.write(target, offset, s, 0, s.length, true);
    target[offset++] = 0;
    return offset;
}
