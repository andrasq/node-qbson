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

var getInt32 = bytes.getInt32;
var getUInt32 = bytes.getUInt32;
var getInt64 = bytes.getInt64;
var getFloat64 = bytes.getFloat64;
var scanIntZ = bytes.scanIntZ;
var scanStringZ = bytes.scanStringZ;

module.exports = bson_decode;
module.exports.getBsonEntities = getBsonEntities;
module.exports.getUInt32 = getUInt32;


function bson_decode( buf ) {
    return getBsonEntities(buf, 4, buf.length - 1, new Object(), false);
}

// create a symbol builder that does not break 100% code coverage
// TODO: if Symbol not available, maybe decode to an annotated new String() object with .type = 'symbol'
var makeSymbol = eval("(typeof Symbol === 'function') && Symbol || function(s) { return String(s) }");

// note; having to scan for end-of-string impacts name decode, but using buf.indexOf is even slower
// function findFirstZero(buf, base) { if (buf.indexOf) { var ix = buf.indexOf(0); return (ix < 0) ? buf.length : ix } while (buf[base]) base++; return base }
//function findFirstZero(buf, base) { while (buf[base]) base++; return base }
//function scanStringZ(buf, base, entity) { return scanString(buf, base, findFirstZero(buf, base), entity) }
// using toString is slightly faster for long names? maybe?
//function scanStringZ(buf, base, entity) { var len = findFirstZero(buf, base); entity.val = buf.toString('utf8', base, len); return len + 1 }


var _entity = bytes.byteEntity();       // { val, end } tuple
function getBsonEntities( buf, base, bound, target, asArray ) {
    var type, subtype, name, start;
    // 2.3x faster to read a Uint8Array, but slow to convert

    while (base < bound) {
        start = base;
        type = buf[base++];
        base = (asArray) ? scanIntZ(buf, base, _entity) : scanStringZ(buf, base, _entity);
        name = _entity.val;

        var value;
        switch (type) {
        case 16:
            value = getInt32(buf, base);
            base += 4;
            break;
        case 14:
            base = scanString(buf, base, bound, _entity);
            value = makeSymbol(_entity.val);
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
            value = getFloat64(buf, base);
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
            value = new bsonTypes.ObjectId(buf, base);
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
            value = new bsonTypes.Long(getUInt32(buf, base+4), getUInt32(buf, base));
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
            value = bsonTypes.makeFunction(source, scope);
            value.scope = scope;
            base += len;
            break;
        case 17:
            value = new bsonTypes.Timestamp(getUInt32(buf, base), getUInt32(buf, base+4));
            base += 8;
            break;
        case 255:
            value = new bsonTypes.MinKey();
            break;
        case 127:
            value = new bsonTypes.MaxKey();
            break;
        case 12:
            base = scanString(buf, base, bound, _entity);
            value = new bsonTypes.DbRef(_entity.val, new bsonTypes.ObjectId(buf, base));
            base += 12;
            break;
        case 19:
            value = new bsonTypes.Float128(getUInt32(buf, base+12), getUInt32(buf, base+8), getUInt32(buf, base+4), getUInt32(buf, base));
            base += 16;
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
function scanRegExp( buf, base, bound, entity ) {
    var s1 = { val: 0, end: 0 };
    var s2 = { val: 0, end: 0 };
    // TODO: pass option to scanStringZ to decode overlong-encoded strings
    var end = scanStringZ(buf, base, s1);
    end = scanStringZ(buf, end, s2);

    // if the regex ends on an entity bound, all is good
    // if not, must be confused by embedded zero so try to find the actual end
    while (!(end >= bound ||            // bson end
             buf[end] === 0 ||          // double NUL bytes, eg when regex entity is last in enclosing object.  Two adjacent regex NUL probably error out.
             isEntityStart(buf[end])))  // an entity start (type) byte following a zero byte is the expected next-entity start
    {
        s1.val += '\x00' + s2.val;
        end = scanStringZ(buf, end, s2);
    }

    entity.val = createRegExp(s1.val, s2.val);
    return end;

    // test whether ch starts a bson entity
    function isEntityStart(ch) { return (ch >= 1 && ch <= 19 || ch === 127 || ch === 255) }
}

// construct a RegExp object
    // NOTE: BSON-1.0.4 omits the flags /uy when encoding, and ignores them when decoding
    // mongodb documents regex flags /imxs, php documents /imxslu
    // i - case-insesitive, m - multiline, x - ignore spaces and #-comments, s - "dotall", l - locale, u - unicode
    //   "multi-line" causes anchors ^ and $ to match newlines too,
    //   "dotall" treats the input as a single string, newlines are matched by '.';
    //   however, the javascript `/.../mgi.test("a\nb")` does not match the newline "\n".
    // Note that the mongo shell supports its own js subset of flags, not those of mongo.
    // The mongo flags apply to searches done by mongodb itself.
    // Q: does mongo type-check regex flags when storing them?  Or just when using regexes?
function createRegExp( pattern, flags ) {
    // BSON-1.0.4 only decodes the mongo flags /ims, not the other js flags /guy
    // mongo knows /g as /s ("dotall"), though the semantics are different.
    // Note that there is also a js flag /s with dotall semantics.
    // if (flags && flags.indexOf('s') >= 0) flags = flags.replace('s', 'g');

    try {
        return new RegExp(pattern, flags);
    } catch (err) {
        return new RegExp(pattern);
    }
}

// recover the string entity from the bson
function scanString( buf, base, bound, entity ) {
    var len = getUInt32(buf, base);
    base += 4;
    var end = base + len - 1;
    if (buf[end] !== 0) throw new Error("invalid bson, string at " + base + " not zero terminated");
    // our pure js getString() is faster only for short strings
    entity.val = (len <= 10) ? bytes.getString(buf, base, end) : buf.toString('utf8', base, end);
    // return entity.end = end + 1;
    return end + 1;
}

function scanBinary( buf, base, bound, entity ) {
    var len = getUInt32(buf, base);
    var subtype = buf[base+4];
    base += 5;
    entity.val = buf.slice(base, base+len);
    entity.val.subtype = buf[base-1];
    // return entity.end = base += len;
    return base + len;

    // TODO: why does bson return the Buffer wrappered in an object?
    // { _bsontype: 'Binary', sub_type: 0, position: N, buffer: data }
    // We return a Buffer annotated with .subtype like `buffalo` does.
}

/**
// find the first 0 byte
function scanZ( buf, base ) {
    while (buf[base]) base++;
    return base;
}

// gather up the chars between base and bound
function getChars( buf, base, bound ) {
    switch (bound - base) {
    case 1: return String.fromCharCode(buf[base]);
    case 2: return String.fromCharCode(buf[base], buf[base+1]);
    case 3: return String.fromCharCode(buf[base], buf[base+1], buf[base+2]);
    case 4: return String.fromCharCode(buf[base], buf[base+1], buf[base+2], buf[base+3]);
    default:
        var ret = '';
        for (var i=base; i<bound; i++) ret += String.fromCharCode(buf[i]);
        return ret;
    }
}
**/
