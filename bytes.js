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
 * Copyright (C) 2016 Andras Radics
 * Licensed under the Apache License, Version 2.0
 *
 * 2016-05-27 - AR.
 */

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
    putInt32(n / 0x100000000, target, offset+4);
    return offset + 8;
}


/*
 * extract the 64-bit little-endian ieee 754 floating-point value 
 *   see http://en.wikipedia.org/wiki/Double-precision_floating-point_format
 *   1 bit sign + 11 bits exponent + (1 implicit mantissa 1 bit) + 52 mantissa bits
 *
 * Originally from `json-simple`, then `qbson.decode` - AR.
 */
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
        value = mantissa ? (mantissa * _rshift52) * pow2(-1023 + 1) : 0.0;
        return (highWord >> 31) ? -value : value;
    }
    else if (exponent < 0x7ff) {
        // normalized value with an implied leading 1 bit and 1023 biased exponent
        exponent -= 1023;
        value = (1 + mantissa * _rshift52) * pow2(exponent);
        return (highWord >> 31) ? -value : value;
    }
    else {
        // Infinity if zero mantissa (+/- per sign), NaN if nonzero mantissa
        return value = mantissa ? NaN : (highWord >> 31) ? -Infinity : Infinity;
    }
}
// given an exponent n, return 2**n
// n is always an integer, faster to shift when possible
function pow2( exp ) {
    return (exp >= 0) ? (exp <  31 ? (1 << exp) :        Math.pow(2, exp))
                      : (exp > -31 ? (1 / (1 << -exp)) : Math.pow(2, exp));
}

var _floatBuf = new Buffer(8);
function putFloat( n, target, offset ) {
    if (target.writeDoubleLE) {
        target.writeDoubleLE(n, offset, true);
        return offset + 8;
    }
    else {
        _floatBuf.writeDoubleLE(n, 0, true);
        for (var i=0; i<8; i++) target[offset++] = _floatBuf[i];
        return offset;
    }
}


// extract a decimal numeric "cstring" as a number
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
    if (i < base + 12) return scanStringUtf8(buf, base, entity);
    entity.val = buf.toString('utf8', base, i);
    return (entity.end = i) + 1;
}

// get the NUL-terminated utf8 string.  Note that utf8 allows embedded NUL chars.
// concatenating chars generates more gc activity, and is only faster for short strings
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
