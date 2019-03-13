/**
 * bson decoder
 *
 * This file is derived from andrasq/node-json-simple/lib/parse-bson.js
 *
 * See also http://bsonspec.org/spec.html
 *
 * Copyright (C) 2015-2016,2018-2019 Andras Radics
 * Licensed under the Apache License, Version 2.0
 */

'use strict';

var bsonTypes = require('./bson-types');
var bytes = require('./bytes');

var ObjectId = bsonTypes.ObjectId;
var Timestamp = bsonTypes.Timestamp;
var MinKey = bsonTypes.MinKey;
var MaxKey = bsonTypes.MaxKey;
var Long = bsonTypes.Long;
var DbRef = bsonTypes.DbRef;
var ScopedFunction = bsonTypes.ScopedFunction;

var getInt32 = bytes.getInt32;
var getUInt32 = bytes.getUInt32;
var getInt64 = bytes.getInt64;
var getFloat = bytes.getFloat64;
var scanIntZ = bytes.scanIntZ;
var scanStringZ = bytes.scanStringZ;
var scanStringUtf8 = bytes.scanStringUtf8;

module.exports = bson_decode;
module.exports.getBsonEntities = getBsonEntities;
module.exports.getUInt32 = getUInt32;


function bson_decode( buf ) {
    return getBsonEntities(buf, 4, buf.length - 1, new Object(), false);
}

var _entity = bytes.byteEntity();       // { val, end } tuple
function getBsonEntities( buf, base, bound, target, asArray ) {
    var type, subtype, name, start;
    // 2.3x faster to read a Uint8Array, but slow to convert

    while (base < bound) {
        start = base;
        type = buf[base++];
        (asArray) ? scanIntZ(buf, base, _entity) : scanStringZ(buf, base, _entity);
        name = _entity.val;
        base = _entity.end + 1;  // skip string + NUL

        var value;
        switch (type) {
        case 16:
            value = getInt32(buf, base);
            base += 4;
            break;
        case 14:
            base = scanString(buf, base, bound, _entity);
            value = Symbol(_entity.val);
            break;
        case 2:
            base = scanString(buf, base, bound, _entity);
            value = _entity.val;
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
            base = scanBinary(buf, base, bound, _entity);
            value = _entity.val;
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
            base = scanRegExp(buf, base, bound, _entity);
            value = _entity.val;
            break;
        case 18:
            value = new Long(getUInt32(buf, base+4), getUInt32(buf, base));
            base += 8;
            break;
        case 13:
            base = scanString(buf, base, bound, _entity);
            value = bsonTypes.makeFunction(_entity.val);
            break;
        case 15:
            // length is redundant, skip +4
            base = scanString(buf, base+4, bound, _entity);
            var source = _entity.val;
            var len = getUInt32(buf, base);
            var scope = getBsonEntities(buf, base+4, base+len-1, {});
            value = new ScopedFunction(source, scope);
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
        case 12:
            base = scanStringZ(buf, base, _entity);
            value = new DbRef(_entity.val, new ObjectId().setFromBuffer(buf, base));
            base += 12;
            break;
        default:
            throw new Error("unsupported bson entity type 0x" + type.toString(16) + " at offset " + start);
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
/**
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
**/


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
console.log("AR:", base, bound);
// FIXME: need to scan the bytes to find the probable end of the regex
// ie ['f' '\0' 'o' \0 'i' 'm' \0] is a regex
// Simplifying assumptions: no double-\0
/**
    // find the probably end of the regex
    for (var i = 1; i < bound; i++) {
//process.stdout.write('.');
        if (buf[i - 1] === 0 && buf[i] >= 1 && (buf[i] <= 0x13 || buf[i] === 127 || buf[i] === 255)) break;
    }
    var end2 = i === bound ? i : i - 1;
    // back up to the start of the flags
    while (buf[--i] !== 0 && i > base) {
        // valid BSON regex flags are /imlsux, must be in alpha order
        // if ('imlsux'.indexOf(String.fromCharCode(buf[i])) < 0) throw ??
    }
    var end1 = i;
    var patt = bytes.getString(buf, base, end1);
    var flags = bytes.getString(buf, end1 + 1, end2);
    item.val = createRegExp(patt, flags);
    item.end = end2;
    return end2 + 1;
**/

    var s1 = { val: 0, end: 0 }, s2 = { val: 0, end: 0 };
    // extract
    scanStringZ(buf, base, s1);
    scanStringZ(buf, s1.end + 1, s2);
// FIXME: this is not the correct value!
    item.val = createRegExp(s1.val, s2.val);
    base = s2.end + 1;

    // hack
    if (buf[base] === 0 || (buf[base] > 0x13 && buf[base] !== 127 && buf[base] !== 255)) {
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
    // NOTE: BSON-1.0.4 omits the flags /uy when encoding, and ignores them when decoding
    // mongodb documents regex flags /imxs, php documents /imxslu
    // i - case-insesitive, m - multiline, x - ignore spaces and #-comments, s - "dotall", l - locale, u - unicode
    //   "multi-line" causes anchors ^ and $ to match newlines too,
    //   "dotall" treats the input as a single string, newlines are matched by '.';
    //   however, the javascript `/.../mgi.test("a\nb")` does not match the newline "\n".
    // Note that the mongo shell supports its own js subset of flags, not those of mongo.
    // The mongo flags apply to searches done by mongodb itself.
    // Q: does mongo type-check regex flags when storing them?  Or just when using regexes?

    // mongo knows /g as /s ("dotall"), though the semantics are different.
    if (flags && flags.indexOf('s') >= 0) flags.replace('s', 'g');
    // BSON-1.0.4 only decodes the mongo flags /ims, not the other js flags /guy

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
    if (buf[end] !== 0) throw new Error("invalid bson, string at " + base + " not zero terminated");
    // our pure js getString() is faster for short strings
    item.val = (len < 20) ? bytes.getString(buf, base, end) : buf.toString('utf8', base, end);
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
