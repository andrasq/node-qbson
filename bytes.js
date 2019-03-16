/**
 * Byte handling, read and write data to/from byte arrays.
 *
 * Copyright (C) 2016-2019 Andras Radics
 * Licensed under the Apache License, Version 2.0
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

    getString: getString,
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
    // convert sign-magnitude float n to twos-complement int64
    if (n >= 0) {
        var lo = n % 0x100000000, hi = n / 0x100000000;
    } else {
        var lo = (-n) % 0x100000000, hi = (-n) / 0x100000000;
        hi = (~hi);                 // complement of high word
        lo = (~lo) + 1;             // twos-complement of low word
        if (lo === 0) hi += 1;      // carry-out from low word
    }
    putInt32(lo, target, offset);
    putInt32(hi, target, offset + 4);
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
    // return (entity.end = i) + 1;
    // TODO: deprecate setting entity.end, is obvious in context
    return i + 1;
}

// get the NUL-terminated utf8 "cstring" string
//
// - breakeven vs buf.toString() is around 13 chars (node 5; more with node 6)
// - note that cannot rely on native js toString if using overlong encoding.
// - node-v10 and up are much slower than before for both, breakeven around 11.
// - the separate findFirstZero test test adds 8% decode overhead
// - decoding names with toString is much faster for long strings (50% for uuid),
//   but slows decode rates to that of bson/buffalo.
// TODO: option to always use readZ for overlong-encoded names (eg regexes)
//
//function findFirstZero(buf, base) { while (buf[base]) base++; return base }
function scanStringZ( buf, base, entity ) {
    var bound = findIndexOf(0, buf, base, buf.length);
    if (bound - base <= 10 || buf instanceof Array) {
        entity.val = utf8.readZ(buf, base, entity);
        return entity.end < buf.length ? entity.end + 1 : entity.end;
    } else {
        entity.val = buf.toString('utf8', base, bound);
        return bound < buf.length ? bound + 1 : bound;
    }
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

function findIndexOf( ch, buf, base, bound ) {
    for (var i = base; i < bound; i++) if (buf[i] === ch) return i;
    return bound;
}
// TODO: rename to findFirstZero: function findFirstZero(buf, base) { while (buf[base]) base++; return base }

function putStringZ( s, target, offset ) {
    if (typeof s !== 'string') s = '' + s;
    offset = utf8.write(target, offset, s, 0, s.length, true);
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

function getString( buf, base, bound ) {
    return utf8.read(buf, base, bound);
}
