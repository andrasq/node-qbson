/**
 * bson type info.  Not really useful, a switch is faster.
 *
 * Copyright (C) 2016,2018-2019 Andras Radics
 * Licensed under the Apache License, Version 2.0
 *
 * See also http://bsonspec.org/spec.html
 *
 * Also includes bson compatibility functions for passing bson types
 * eg Timestamp or MinKey, which is useful.
 *
 * 2016-05-18 - AR.
 */

/*
 * Spec at http://bsonspec.org/
 */

'use strict';

var ObjectId = require('./object-id.js');
var bytes = require('./bytes.js');

/*
 * makeFunction evals the function definition string in non-strict mode, thus has to
 * live in a different source file.
 */
var makeFunction = require('./make-function.js');

module.exports = {
    // bson type info
    typeIds: typeIds(),
    typeInfo: typeInfo(),
    typeSizes: typeSizes(),

    // classes of special bson types
    ObjectId: ObjectId,
    ObjectID: ObjectId,
    DbRef: DbRef,
    ScopedFunction: ScopedFunction,
    Timestamp: Timestamp,
    Long: Long,
    Float128: Float128,
    MinKey: MinKey,
    MaxKey: MaxKey,

    // function with or without scope builder
    makeFunction: makeFunction,
};

// http://bsonspec.org/spec.html
function typeIds() { return {
    T_FLOAT: 1,                 // 64-bit IEEE 754 float
    T_STRING: 2,                // 4B length (including NUL byte but not the length bytes) + string + NUL
    T_OBJECT: 3,                // length (including length bytes and terminating NUL byte) + items as asciiZ name & value + NUL
    T_ARRAY: 4,                 // length (including length and NUL) + items as asciiZ offset number & value + NUL
    T_BINARY: 5,                // length (not including length bytes or subtype) + subtype + length bytes
    T_UNDEFINED: 6,             // deprecated
    T_OBJECTID: 7,              // mongo ObjectId (unlike the other bson values, this is big-endian)
    T_BOOLEAN: 8,               // 1B true 01 / false 00
    T_DATE: 9,                  // Date.now() timestamp stored as 64-bit LE integer
    T_NULL: 10,                 // 0B
    T_REGEXP: 11,               // pattern + NUL + flags + NUL.  NOTE: must scan past embedded NUL bytes!
    T_DBREF: 12,                // deprecated, now { $ref, $id, $db } object: stringZ ns, 12B ObjectID
    T_FUNCTION: 13,             // function source
    T_SYMBOL: 14,               // deprecated, just like string
    T_SCOPED_CODE: 15,          // 4B tot length, "function(){}" string(2), scope key-value mappings object(3)
    T_INT: 16,                  // 32-bit LE signed twos complement
    T_TIMESTAMP: 17,            // special bson type: 32-bit time(), 32-bit increment as 64-bit LE
    T_LONG: 18,                 // 64-bit LE signed twos complement
    T_FLOAT128: 19,             // 128-bit LE IEEE 754 float (new in mongodb 3.4)
    T_MINKEY: 255,              // special value which sorts before all other possible bson entities
    T_MAXKEY: 127,              // special value which sorts after all other possible bson entites

    T_BINARY_GENERIC: 0,        // subtypes 0-127 are mongo reserved, 128-255 are user-defined
    T_BINARY_FUNCTION: 1,       
    T_BINARY_OLD: 2,            // used to be the generic default subtype
    T_BINARY_UUID_OLD: 3,       // used to be the uuid subtype
    T_BINARY_UUID: 4,   
    T_BINARY_MD5: 5,    
    T_BINARY_USER_DEFINED: 128, // subtypes 128-255 are user defined
}}

function typeInfo() { var ids = typeIds(); return [
    { id: 0 },
    { id: ids.T_FLOAT,          key: 'T_FLOAT',         name: 'Float',          size:  8,  fixup: 0 },
    { id: ids.T_STRING,         key: 'T_STRING',        name: 'String',         size: -1,  fixup: 4 },
    { id: ids.T_OBJECT,         key: 'T_OBJECT',        name: 'Object',         size: -1,  fixup: 0 },
    { id: ids.T_ARRAY,          key: 'T_ARRAY',         name: 'Array',          size: -1,  fixup: 0 },
    { id: ids.T_BINARY,         key: 'T_BINARY',        name: 'Binary_0',       size: -1,  fixup: 5 },
    { id: ids.T_UNDEFINED,      key: 'T_UNDEFINED',     name: 'Undefined',      size:  0,  fixup: 0 },
    { id: ids.T_OBJECTID,       key: 'T_OBJECTID',      name: 'ObjectId',       size: 12,  fixup: 0 },
    { id: ids.T_BOOLEAN,        key: 'T_BOOLEAN',       name: 'Boolean',        size:  1,  fixup: 0 },
    { id: ids.T_DATE,           key: 'T_DATE',          name: 'Date',           size:  8,  fixup: 0 },
    { id: ids.T_NULL,           key: 'T_NULL',          name: 'Null',           size:  0,  fixup: 0 },
    { id: ids.T_REGEXP,         key: 'T_REGEXP',        name: 'RegExp',         size: -1,  fixup: 0 },
    { id: ids.T_DBREF,          key: 'T_DBREF',         name: 'DbRef',          size: -1,  fixup: 0 },
    { id: ids.T_FUNCTION,       key: 'T_FUNCTION',      name: 'Function',       size: -1,  fixup: 4 },
    { id: ids.T_SYMBOL,         key: 'T_SYMBOL',        name: 'Symbol',         size: -1,  fixup: 4 },
    { id: ids.T_SCOPED_CODE,    key: 'T_SCOPED_CODE',   name: 'ScopedFunction', size: -1,  fixup: 4 },
    { id: ids.T_INT,            key: 'T_INT',           name: 'Int',            size:  4,  fixup: 0 },
    { id: ids.T_TIMESTAMP,      key: 'T_TIMESTAMP',     name: 'Timestamp',      size:  8,  fixup: 0 },
    { id: ids.T_LONG,           key: 'T_LONG',          name: 'Long',           size:  8,  fixup: 0 },
    { id: ids.T_FLOAT128,       key: 'T_FLOAT128',      name: 'Float128',       size:  8,  fixup: 0 },
    { id: ids.T_MINKEY,         key: 'T_MINKEY',        name: 'MinKey',         size:  0,  fixup: 0 },
    { id: ids.T_MAXKEY,         key: 'T_MAXKEY',        name: 'MaxKey',         size:  0,  fixup: 0 },
]}

function typeSizes() {
    var info = typeInfo();
    var sizes = new Array();
    for (var i=0; i<info.length; i++) {
        if (info[i].id) sizes[info[i].id] = info[i].size < 0 ? undefined : info[i].size;
    }
    return sizes;
}

/**
// idea: have Timestamp, Date, Long all inherit their implementation
// TODO: using Type64 prototype breaks test-encode
function Type64( hi, lo ) {
    this.hi = hi;
    this.lo = lo;
}
Type64.prototype.getHi = function getHi() { return this.hi }
Type64.prototype.getLo = function getLo() { return this.lo }
Type64.prototype.getHighBits = function() { return this.hi }
Type64.prototype.getLowBits = function() { return this.lo }
**/

/*
 * From https://docs.mongodb.com/v3.0/reference/bson-types/#timestamps
 *
 * BSON has a special timestamp type for internal MongoDB use...
 * If you insert a document containing an empty BSON timestamp in a
 * top-level field, the MongoDB server will replace that empty timestamp
 * with the current timestamp value.
 *
 * Timestamp values are a 64 bit value where:  the first 32 bits are a
 * time_t value (seconds since the Unix epoch) the second 32 bits are an
 * incrementing ordinal for operations within a given second.
 * (note: stored in little endian format, the second word first)
 *
 * NOTE: bson.Timestamp takes (seq, time); we take (time, seq) like mongo.
 */
function Timestamp( t, i ) {
    this._bsontype = 'Timestamp';
    this.hi = t;
    this.lo = i;
}
//Timestamp.prototype = Type64.prototype;

/*
 * Special type which compares lower than all other possible BSON element values.
 * This is a constant, identified by its type.
 */
function MinKey( ) {
    this._bsontype = 'MinKey';
}

/*
 * Special type which compares higher than all other possible BSON element values.
 * This is a constant, identified by its type.
 */
function MaxKey( ) {
    this._bsontype = 'MaxKey';
}

/*
 * 64-bit integer.  We can read it and write it, but no arithmetic.
 * NOTE: bson.Long takes (lo, hi); we take (hi, lo).
 */
function Long( highWord, lowWord ) {
    this._bsontype = 'Long';
    this.high32 = +highWord;
    this.low32 = +lowWord;
}
Long.prototype.get = function get( buf, base ) {
    this.low32 = bytes.getInt32(buf, base);
    this.high32 = bytes.getInt32(buf, base+4);
}
Long.prototype.put = function put( buf, offset ) {
    bytes.putInt32(this.low32, buf, offset);
    bytes.putInt32(this.high32, buf, offset+4);
    return offset + 8;
}
var tmpbuf8 = [,,,,,,,,];
Long.fromNumber = function createLongFromNumber( n ) {  // mongo compat
    var ret = new Long(0, 0);
    bytes.putInt64(n, tmpbuf8, 0);
    ret.get(tmpbuf8, 0);
    return ret;
}
// Note: having a valueOf() method makes util.inspect report that this is a Number
Long.prototype.valueOf = function valueOf( ) {          // mongo example compat
    this.put(tmpbuf8, 0);
    return bytes.getInt64(tmpbuf8, 0);
}
Long.prototype = toStruct(Long.prototype);

/*
 * DbRef is a weird internal mongodb creature, deprecated.  It is a db name and an ObjectId
 * We can create objects of this type, thats it.
 * It is stored as a type2 string (len + refname + \0) then 12 bytes of objectid
 * The mongo shell DBRef() takes expects exactly two arguments, ref and id; no db.
 */
function DbRef( ref, id ) {
    this._bsontype = 'DbRef';
    this.$ref = ref;
    this.$id = id;
}

/*
 * class to represent scoped functions to make them encodable
 */
function ScopedFunction( func, scope ) {
    this._bsontype = 'ScopedCode';
    this.func = String(func);
    this.scope = scope;
}
ScopedFunction.prototype.valueOf = function valueOf( ) {
    var fn = makeFunction(this.func, this.scope);
    fn._scope = this.scope;
    return fn;
}

/** bson extracts binary as an object Binary,
// we extract Binary as a Buffer with property .subtype
function Binary( buf, base, bound ) {
    this.parent = buf;
    this.base = base;
    this.bound = bound;
}
**/

function Float128( w1, w2, w3, w4 ) {
    this.word1 = w1;
    this.word2 = w2;
    this.word3 = w3;
    this.word4 = w4;
}


function toStruct(hash) { return toStruct.prototype = hash }
