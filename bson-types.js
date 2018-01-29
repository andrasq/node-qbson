/**
 * bson type info.  Not really useful, a switch is faster.
 *
 * See also http://bsonspec.org/spec.html
 *
 * Also includes bson compatibility functions for passing bson types
 * eg Timestamp or MinKey, which is useful.
 *
 * Copyright (C) 2016 Andras Radics
 * Licensed under the Apache License, Version 2.0
 *
 * 2016-05-18 - AR.
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
    Timestamp: Timestamp,
    Long: Long,
    MinKey: MinKey,
    MaxKey: MaxKey,
    DbRef: DbRef,
    Binary: Binary,
    ScopedFunction: ScopedFunction,

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
    T_SYMBOL: 14,               // just like string
    T_SCOPED_FUNCTION: 15,      // 4B length, "function(){}" string entity, scope object entity
    T_INT: 16,                  // 32-bit LE signed twos complement
    T_TIMESTAMP: 17,            // special bson type: 32-bit time(), 32-bit increment as 64-bit LE
    T_LONG: 18,                 // 64-bit LE signed twos complement
    T_MINKEY: 255,              // special value which sorts before all other possible bson entities
    T_MAXKEY: 127,              // special value which sorts after all other possible bson entites

    T_BINARY_GENERIC: 0,        // subtypes 0-127 are mongo reserved
    T_BINARY_FUNCTION: 1,       
    T_BINARY_OLD: 2,            // used to be the generic default subtype
    T_BINARY_UUID_OLD: 3,       // used to be the uuid subtype
    T_BINARY_UUID: 4,   
    T_BINARY_MD5: 5,    
    T_BINARY_USER_DEFINED: 128, // subtypes 128-255 are user defined
}}

function typeInfo() { return [
    { id: 0 },
    { id: typeIds.T_FLOAT,              key: 'T_FLOAT',         name: 'Float',          size:  8,  fixup: 0 },
    { id: typeIds.T_STRING,             key: 'T_STRING',        name: 'String',         size: -1,  fixup: 4 },
    { id: typeIds.T_OBJECT,             key: 'T_OBJECT',        name: 'Object',         size: -1,  fixup: 0 },
    { id: typeIds.T_ARRAY,              key: 'T_ARRAY',         name: 'Array',          size: -1,  fixup: 0 },
    { id: typeIds.T_BINARY,             key: 'T_BINARY',        name: 'Binary_0',       size: -1,  fixup: 5 },
    { id: typeIds.T_UNDEFINED,          key: 'T_UNDEFINED',     name: 'Undefined',      size:  0,  fixup: 0 },
    { id: typeIds.T_OBJECTID,           key: 'T_OBJECTID',      name: 'ObjectId',       size: 12,  fixup: 0 },
    { id: typeIds.T_BOOLEAN,            key: 'T_BOOLEAN',       name: 'Boolean',        size:  1,  fixup: 0 },
    { id: typeIds.T_DATE,               key: 'T_DATE',          name: 'Date',           size:  8,  fixup: 0 },
    { id: typeIds.T_NULL,               key: 'T_NULL',          name: 'Null',           size:  0,  fixup: 0 },
    { id: typeIds.T_REGEXP,             key: 'T_REGEXP',        name: 'RegExp',         size: -1,  fixup: 0 },
    { id: typeIds.T_DBREF,              key: 'T_DBREF',         name: 'DbRef',          size: -1,  fixup: 0 },
    { id: typeIds.T_FUNCTION,           key: 'T_FUNCTION',      name: 'Function',       size: -1,  fixup: 4 },
    { id: typeIds.T_SYMBOL,             key: 'T_SYMBOL',        name: 'Symbol',         size: -1,  fixup: 4 },
    { id: typeIds.T_SCOPED_FUNCTION,  key: 'T_SCOPED_FUNCTION', name: 'ScopedFunction', size: -1,  fixup: 4 },   // TODO: how is this encoded?
    { id: typeIds.T_INT,                key: 'T_INT',           name: 'Int',            size:  4,  fixup: 0 },
    { id: typeIds.T_TIMESTAMP,          key: 'T_TIMESTAMP',     name: 'Timestamp',      size:  8,  fixup: 0 },
    { id: typeIds.T_LONG,               key: 'T_LONG',          name: 'Long',           size:  8,  fixup: 0 },
    { id: typeIds.T_MINKEY,             key: 'T_MINKEY',        name: 'MinKey',         size:  0,  fixup: 0 },
    { id: typeIds.T_MAXKEY,             key: 'T_MAXKEY',        name: 'MaxKey',         size:  0,  fixup: 0 },
]}

function typeSizes() {
    var info = typeInfo();
    var sizes = new Array();
    for (var i=0; i<info.length; i++) {
        if (info[i].id) sizes[info[i].id] = sizes[info[i]].size < 0 ? undefined : sizes[info[i]].size;
    }
    return sizes;
}


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
    this.time = t;
    this.seq = i;
}
Timestamp.prototype.getHighBits = function getLowBits( ) {
    return this.time;
}
Timestamp.prototype.getLowBits = function getLowBits( ) {
    return this.seq;
}

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
 */
function Long( lowWord, highWord ) {
    this._bsontype = 'Long';
    this.low32 = lowWord;
    this.high32 = highWord;
}
Long.prototype.get = function get( buf, base ) {
    this.low32 = bytes.getUInt32(buf, base);
    this.high32 = bytes.getUInt32(buf, base+4);
}
Long.prototype.put = function put( buf, offset ) {
    bytes.putInt32(this.low32, buf, offset);
    bytes.putInt32(this.high32, buf, offset+4);
    return offset + 8;
}
Long.fromNumber = function createLongFromNumber( n ) {  // mongo compat
    return new Long(n & 0xFFFFFFFF, n / 0x100000000 >>> 0);
}
Long.prototype.valueOf = function valueOf( ) {          // mongo example compat
    if ((this.high32 & 0x1FFFFF) === 0) return this.high32 * 0x100000000 + this.low32;
    else return { Int64: true, _lo: this.low32, _hi: this.high32 };
}
Long.prototype = Long.prototype;


/*
 * DbRef is a weird internal mongodb creature, deprecated.  It is a db name and an ObjectId
 * We can create objects of this type, thats it.
 * FIXME: how is this actually stored by mongo?  bson stores { $ref: namespace, $id: oid, $db: db }
 */
function DbRef( name, oid ) {
    this._bsontype = 'DbRef';
    this.name = name;
    this.oid =  (oid instanceof ObjectId) ? oid : new ObjectId(oid);
}
var entity = bytes.byteEntity();
DbRef.prototype.get = function get( buf, base ) {
    base = bytes.scanStringZ(buf, base, entity)
    this.name = entity.val;
    this.oid = new ObjectId(buf, base);
    return base + 12;
}
DbRef.prototype.put = function put( buf, offset ) {
    offset = bytes.putStringZOverlong(this.name, buf, offset);
    offset = this.oid.copyToBuffer(buf, offset);
    return offset;
}


/*
 * Binary is an abstract class to represent user-defined binary types
 */
function Binary( ) {
    this._bsontype = 'Binary';
    this.subtype = 0;   // expose "subtype" on all derived classes
    this.length = 0;    // expose "length" (num bytes) on all derived classes
    // override
}
// abstracat method to copy out the binary data into the target buffer
// starting at position offset
Binary.prototype.copy = function copy( buf, offset ) {
    // override
}
Binary.prototype = Binary.prototype;


/*
 * class to represent scoped functions to make them encodable
 */
function ScopedFunction( func, scope ) {
    this.func = func;
    this.scope = scope;
}

