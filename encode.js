/**
 * bson encoder
 *
 * bson encoder for nodejs
 * Very fast, but partial only (work in progress).
 *
 * Copyright (C) 2016,2019 Andras Radics
 * Licensed under the Apache License, Version 2.0
 */

'use strict';

var bytes = require('./bytes.js');
var bsonTypes = require('./bson-types.js');

var ObjectId = bsonTypes.ObjectId;
var Timestamp = bsonTypes.Timestamp;
var MinKey = bsonTypes.MinKey;
var MaxKey = bsonTypes.MaxKey;
var Long = bsonTypes.Long;
var DbRef = bsonTypes.DbRef;
var ScopedFunction = bsonTypes.ScopedFunction;

var putInt32 = bytes.putInt32;
var putInt64 = bytes.putInt64;
var putFloat = bytes.putFloat64;
var putStringZ = bytes.putStringZ;
var putStringZOverlong = bytes.putStringZOverlong;

// polyfills for nodejs that need it
eval('var alloc = Buffer.allocUnsafe; Object.defineProperty(Buffer, "allocUnsafe", { value: alloc || function(n) { return new Buffer(n) } })');
eval('var from = Buffer.from; Object.defineProperty(Buffer, "from", { value: (parseInt(process.versions.node) >= 7) && from || function(a, b, c) { return new Buffer(a, b, c) } });')

module.exports = bson_encode;
//module.exports.guessSize = guessSize;
module.exports.encodeEntities = encodeEntities;
module.exports.putInt32 = bytes.putInt32;

// TODO: make undefined encoding configurable, bson skips it
// TODO: backport BSON /s dotAll proxy on /g if /s is not available

function bson_encode( obj ) {
    // 28% faster to guess at buffer size instead of calcing exact size
    // it is 23% slower to compose into an array and then make that into a buffer
    // var buf = Buffer.allocUnsafe(guessSize(obj));

    // node-v6 and up are much faster writing an array than a Buffer, so convert at the end
    // It is much faster to populate an empty array than to guess at the final size.
    var buf = new Array();

    var offset = encodeEntities(obj, buf, 0);
    return Buffer.from(buf);

/**
    // if buffer size was close enough, use it
    if (buf.length <= 2 * offset) return buf.slice(0, offset);
    var ret = Buffer.allocUnsafe(offset);
    buf.copy(ret);
    return ret;
**/
}

var T_FLOAT = 1;        // 64-bit IEEE 754 float
var T_STRING = 2;       // 4B length (including NUL byte but not the length bytes) + string + NUL
var T_OBJECT = 3;       // length (including length bytes and terminating NUL byte) + items as asciiZ name & value + NUL
var T_ARRAY = 4;        // length (including length and NUL) + items as asciiZ offset number & value + NUL
var T_BINARY = 5;       // user-defined binary type: length (not incl 4 len bytes or subtype) + subtype + data bytes
var T_UNDEFINED = 6;    // deprecated
var T_OBJECTID = 7;
var T_BOOLEAN = 8;      // 1B true 01 / false 00
var T_DATE = 9;         // Date.now() timestamp stored as 64-bit LE integer
var T_NULL = 10;        // 0B
var T_REGEXP = 11;      // pattern + NUL + flags + NUL.  NOTE: must scan past embedded NUL bytes!
var T_DBREF = 12;       // deprecated
var T_FUNCTION = 13;    // function source
var T_SYMBOL = 14;      // stored same as string
var T_SCOPED_CODE = 15; // function that decodes into `with (scope) { func() }`
var T_INT = 16;         // 32-bit LE signed twos complement
var T_TIMESTAMP = 17;   // 64-bit mongodb internal timestamp (32-bit seconds, 32-bit sequence)
var T_LONG = 18;        // 64-bit LE signed twos complement
var T_FLOAT128 = 19;    // 128-bit LE IEEE 754 float (added in mongod 3.4)
var T_MINKEY = 255;     // ignore
var T_MAXKEY = 127;     // ignore

var T_BINARY_GENERIC = 5;       // subtype 0
var T_BINARY_FUNCTION = 5;      // subtype 1
var T_BINARY_OLD = 5;           // subtype 2
var T_BINARY_UUID = 5;          // subtype 3
var T_BINARY_MD5 = 5;           // subtype 5
var T_BINARY_USER_DEFINED = 5;  // subtype 128

// see also buffalo and json-simple for typing
// TODO: distinguish symbol from string
function determineTypeId( value ) {
    switch (typeof value) {
    case 'number': return ((value >> 0) === value && value !== -0) ? T_INT : T_FLOAT; // also NaN and +/- Infinity
    case 'string': return T_STRING;
    case 'boolean': return T_BOOLEAN;
    case 'undefined': return T_UNDEFINED;
    case 'function': return T_FUNCTION;
    case 'symbol': return T_SYMBOL;
    case 'object': return (value === null) ? T_NULL
        //: (Array.isArray(value)) ? T_ARRAY
        : (value.constructor === Array) ? T_ARRAY
        : determineClassTypeId(value)
    }
}

// determine the type id of instances of special classes
// note that eg `Number(3)` is type 'number', but `new Number(3)` is 'object'
// (same holds for string, bool)
function determineClassTypeId( value ) {
    switch (value.constructor) {
    //case Array: return T_ARRAY; // handled above
    case ObjectId: return T_OBJECTID;
    case Date: return T_DATE;
    case RegExp: return T_REGEXP;
    case Buffer: return T_BINARY;
    case Number: return ((value >> 0) === +value) ? T_INT : T_FLOAT;
    case String: return T_STRING;
    case Boolean: return T_BOOLEAN;
    case ScopedFunction: return T_SCOPED_CODE;
    case Timestamp: return T_TIMESTAMP;
    case Long: return T_LONG;
    case DbRef: return T_DBREF;
    case MinKey: return T_MINKEY;
    case MaxKey: return T_MAXKEY;
    default: return T_OBJECT;
    }
}

// estimate how many bytes will be required to store the item
// must never underestimate the size, but ok to guess too high
/**
function guessCompoundSize( item ) {
    var contentsSize = 0, i, key;
    if (Array.isArray(item)) {
        for (i=0; i<item.length; i++) {
            // typeId + name + value 
            if (item[i] !== undefined) contentsSize += (1) + (3 * ('' + i).length + 1) + guessSize(item[i]);
        }
    }
    else {
        for (key in item) {
            // typeId + name + value 
            contentsSize += (1) + (3 * key.length + 1) + guessSize(item[key]);
        }
    }
    // length + contents + NUL byte
    return 4 + contentsSize + 1;
}
**/

// estimate the _most_ bytes the value will occupy.  Never guess too low.
// The first switch maps the common sizes, a second switch the more obscure ones.
/**
function guessSize( value ) {
    var id = determineTypeId(value);
    // TODO: if (bsonTypes.typeInfo[id].size > 0) return bsonTypes.typeInfo[id].size + bsonTypes.typeInfo[id].fixup;
    switch (id) {
    case T_INT: return 4;
    case T_FLOAT: return 8;
    case T_STRING: return 4 + 3 * value.length + 1;
    case T_OBJECTID: return 12;
    case T_BOOLEAN: return 1;
    case T_UNDEFINED: return 0;
    case T_NULL: return 0;
    case T_DATE: return 8;
    case T_OBJECT: return guessCompoundSize(value);
    case T_ARRAY: return guessCompoundSize(value);
    case T_REGEXP: return 3 * value.source.length + 1 + 6 + 1;
    default: return guessVariableSize(id, value);
    }
}
**/
// Its 40% faster to use a second switch than to exceed 600 chars (not inline),
// with only 3% penalty if having to use the second switch as well.
/**
function guessVariableSize( id, value ) {
    switch (id) {
    case T_SYMBOL: return 4 + 3 * value.toString().length - 8 + 1;
    case T_FUNCTION: return 4 + 3 * value.toString().length + 1;
    case T_BINARY: return 5 + value.length;
    case T_TIMESTAMP: return 8;
    case T_LONG: return 8;
    case T_DBREF: return guessSize({ $ref: value.$ref, $id: value.$id, $db: value.$db });
    case T_MINKEY: return 0;
    case T_MAXKEY: return 0;
    case T_SCOPED_CODE: return 4 + guessSize(String(value.func)) + guessSize(value.scope);

    default: throw new Error("unknown size of " + (typeof value));
    }
}
**/

function encodeEntities( obj, target, offset ) {
    var key, start = offset;
    offset += 4;
    if (Array.isArray(obj)) {
        for (key=0; key<obj.length; key++) {
            if (obj[key] !== undefined) {
                offset = encodeEntity('' + key, obj[key], target, offset);
            }
        }
    }
    else {
        for (key in obj) {
            offset = encodeEntity(key, obj[key], target, offset);
        }
    }
    target[offset++] = 0;
    putInt32(offset - start, target, start);
    return offset;
}

function encodeEntity( name, value, target, offset ) {
    var start, typeId;

    typeId = determineTypeId(value);

    // some types are automatically converted by BSON
    // TODO: add options to configure this behavior later.
    // if (typeId === T_UNDEFINED) typeId = T_NULL;
    // if (typeId === T_DBREF) {
    //     typeId = T_OBJECT;
    //     value = { $ref: value.$ref, $id: value.$id };
    // }

    target[offset++] = typeId;
    offset = putStringZ(name, target, offset);

    // some types are encoded just like strings
    if (typeId === T_FUNCTION) typeId = T_STRING;

    switch (typeId) {
    case T_INT:
        offset = putInt32(value, target, offset);
        break;
    case T_FLOAT:
        offset = putFloat(value, target, offset);
        break;
    case T_SYMBOL:
        // deprecated
        value = value.toString().slice(7, -1);  // "Symbol(name)" => "name"
        // and fall through to handle as string
    case T_FUNCTION:
        // function types were changed to string already, fall through
    case T_STRING:
        offset = putString(String(value), target, offset);
        break;
    case T_OBJECTID:
        offset = value.copyToBuffer(target, offset);
        break;
    case T_BOOLEAN:
        // new Boolean() is an object, truthy even when false; coerce to value
        target[offset++] = +value ? 1 : 0;
        break;
    case T_UNDEFINED:
        // deprecated
        break;
    case T_NULL:
        break;
    case T_OBJECT:
    case T_ARRAY:
        offset = encodeEntities(value, target, offset);
        break;
    case T_DATE:
        offset = putInt64(value.getTime(), target, offset);
        break;
    case T_REGEXP:
        offset = putStringZOverlong(value.source, target, offset);
        // flags must be in alphabetical order
        // The valid BSON flags are ilmsux (i-gnoreCase, l-ocale, m-ultiline, s-dotAll-mode, u-nicode, x-verbose).
        // node-v8.11.1 has /imsuyg (y-sticky, g-lobal), no /lx.  Node-v7 did not have /s.
        // TODO: if node < v8, convert js /g into mongo /s like BSON does.  Maybe.
        // TODO: maybe should serialiaze all native flags, for js-to-js native data passing
        var flags = (value.ignoreCase ? 'i' : '') + (value.multiline ? 'm' : '') + (value.dotAll ? 's' : '') + (value.unicode ? 'u' : '');
        // if dotAll is not supported, proxy it with /g like BSON-1.0.4 does.
        // node-v8 supports additional flags 'u' 'y' of which only 'y' is supported by mongo 3.4 shell, neither by 2.6
        // Q: will mongo type-check regex flags?  Or just store them as-is?
        // BSON-1.0.4 omits the /uy flags when encoding and when decoding
        // BSON supports additional flags 'l', 'x' that are not valid in node v8 or on the mongo command line
        offset = putStringZ(flags, target, offset);
        break;
    case T_BINARY:
        offset = putInt32(value.length, target, offset);
        target[offset++] = value.subtype || 0;
        // copy the bytes without needing them to be in a Buffer
        for (var i = 0; i < value.length; i++) target[offset + i] = value[i];
        offset += value.length;
        break;
    case T_LONG:
        offset = value.put(target, offset);
        break;
    case T_DBREF:
        // deprecated, even mongod shell encodes it as a type 3 object { $ref, $id }
        offset = putString(value.$ref, target, offset);
        offset = value.$id.copyToBuffer(target, offset);
        break;
    case T_MINKEY:
    case T_MAXKEY:
        break;
    case T_TIMESTAMP:
        offset = putInt32(value.lo, target, offset);    // sequence ordinal
        offset = putInt32(value.hi, target, offset);    // seconds since epoch
        break;
    case T_SCOPED_CODE:
        var mark = offset;
        offset = putString(value.func, target, offset + 4);
        offset = encodeEntities(value.scope, target, offset);
        putInt32(offset - mark, target, mark);
        break;

    // no default, these are all the types possible from determineTypeId
    }
    return offset;
}

// <4B length> <string of length - 1 bytes> <NUL>
function putString( str, target, offset ) {
    var start = offset;
    offset = bytes.putString(str, target, offset + 4);
    target[offset++] = 0;
    // length includes terminating 0 but not the length bytes
    putInt32(offset - start - 4, target, start);
    return offset;
}

