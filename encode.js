'use strict';

var utf8 = require('./utf8.js');

module.exports = bson_encode;

var ObjectId = require('./object-id.js');

function bson_encode( obj ) {
    // 28% faster to guess at buffer size instead of calcing exact size
    var buf = new Buffer(guessSize(obj));

    var offset = encodeEntities(obj, buf, 0);

    // if buffer size was close enough, use it
    if (buf.length <= 2 * offset) return buf.slice(0, offset);

    // 10% slower to allocate an exact size buffer, but still very fast
    var ret = new Buffer(offset);
    buf.copy(ret);
    return ret;
}

var T_FLOAT = 1;
var T_STRING = 2;
var T_OBJECT = 3;
var T_ARRAY = 4;
var T_BINARY_0 = 5;
var T_UNDEFINED = 6;    // deprecated
var T_OBJECTID = 7;
var T_BOOLEAN = 8;
var T_DATE = 9;
var T_NULL = 10;
var T_REGEXP = 11;
var T_DBREF = 12;       // deprecated
var T_CODE = 13;                // TBD
var T_SYMBOL = 14;              // TBD
var T_CODE_WITH_SCOPE = 15;     // TBD
var T_INT = 16;
var T_TIMESTAMP = 17;   // ignore
var T_LONG = 18;                // TBD
var T_MINKEY = 19;      // ignore
var T_MAXKEY = 20;      // ignore

// see also buffalo and json-simple for typing
function determineTypeId( value ) {
    switch (typeof value) {
    case 'number': return ((value|0) === value) ? T_INT : T_FLOAT; // also NaN
    case 'string': return T_STRING;
    case 'boolean': return T_BOOLEAN;
    case 'undefined': return T_NULL;
    case 'object': return (value === null) ? T_NULL
        : (Array.isArray(value)) ? T_ARRAY
        : value.constructor ? determineClassTypeId(value)
        : T_OBJECT;
    }
}

// determine the type id of instances of special classes
// note that eg Number(3) is type 'number', but new Number(3) is 'object'
// (same holds for string, bool)
function determineClassTypeId( value ) {
    return (value instanceof Date) ? T_DATE
        : (value instanceof RegExp) ? T_REGEXP
        : (value instanceof ObjectId) ? T_OBJECTID
        : (Buffer.isBuffer(value)) ? T_BINARY_0
        : (value instanceof Number) ? T_NUMBER
        : (value instanceof String) ? T_STRING
        : T_OBJECT;
}

// estimate how many bytes will be required to store the item
// must never underestimate the size, but ok to guess too high
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

function guessSize( value ) {
    switch (determineTypeId(value)) {
    case T_INT: return 4;
    case T_FLOAT: return 8;
    case T_STRING: return 4 + 3 * value.length + 1;
    case T_BOOLEAN: return 1;
    case T_UNDEFINED: return 0;
    case T_NULL: return 0;
    case T_OBJECT: return guessCompoundSize(value);
    case T_ARRAY: return guessCompoundSize(value);
    case T_DATE: return 8;
    case T_REGEXP: return 3 * value.source.length + 1 +
        (value.global ? 1 : 0) + (value.ignoreCase ? 1 : 0) + (value.multiline ? 1 : 0) + 1;
    case T_BINARY_0: return 5 + value.length;
    default: throw new Error("untyped value", value);
    }
}

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

    target[offset++] = typeId = determineTypeId(value);
    offset = putStringZ(name, target, offset);

    switch (typeId) {
    case T_INT:
        offset = putInt32(value, target, offset);
        break;
    case T_FLOAT:
        offset = putFloat(value, target, offset);
        break;
    case T_STRING:
        start = offset;
        offset = putStringZ(value, target, offset+4);
        // length includes terminating 0 but not the length bytes
        putInt32(offset-start-4, target, start);
        break;
    case T_BOOLEAN:
        target[offset++] = value ? 1 : 0;
        break;
    case T_UNDEFINED:
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
        offset = putStringZ(value.source, target, offset);
        var flags = (value.global ? 'g' : '') + (value.ignoreCase ? 'i' : '') + (value.multiline ? 'm' : '');
        offset = putStringZ(flags, target, offset);
        break;
    }
    return offset;
}

function putStringZ( s, target, offset ) {
    if (typeof s !== 'string') s = '' + s;
    offset = putString(s, target, offset);
    target[offset++] = 0;
    return offset;
}

function putString( s, target, offset ) {
    if (s.length < 100) return utf8.encodeUtf8(s, 0, s.length, target, offset);
    else return offset + target.write(s, offset, 'utf8');
}

function putInt32( n, target, offset ) {
    target[offset+0] = n & 0xFF;
    target[offset+1] = (n >> 8) & 0xFF;
    target[offset+2] = (n >> 16) & 0xFF;
    target[offset+3] = (n >> 24) & 0xFF;
    return offset + 4;
}

function putInt64( n, target, offset ) {
    putInt32(n, target, offset);
    putInt32(n / 0x100000000, target, offset+4);
    return offset + 8;
}

function putFloat( n, target, offset ) {
    target.writeDoubleLE(n, offset, true);
    return offset + 8;
}


// quicktest:
if (process.env['NODE_TEST'] === 'encode') {

var timeit = require('qtimeit');
var BSON = require('bson').BSONPure.BSON;
var buffalo = require('buffalo');
var bson_decode = require('./decode.js');

var data = {abc: 100};
var data = {a: 100, b: 101, c: 102, d: 103};
//var data = {a: "ABC", b: 1, c: "DEFGHI\x88"};
var data = {a: [1,2,3]};
var data = {a: {b: 2, c: 3}};
var data = {a: new Date()};
var data = {a: 1.5, b: 2.5, c: 3.5};
var data = {fooflebar: new Date()};
var data = {a: new RegExp("fo\x00[o]", "i")};   // bug for bug compatible... sigh.
// obj from K hackathon:
var data = {
    ijk: 12,
    t: true,
    f: false,
    d: 1234.5,
    "st uv": "string\xff",
    "utf\xff": "utf8",
    n: null,
    a: [],
    aa: [1,,"three",undefined,5.5],
};
//console.log(bson_encode(data));
console.log(BSON.deserialize(bson_encode(data)))


var nloops = 40000;
var x;
timeit(nloops, function(){ x = BSON.serialize(data) });
timeit(nloops, function(){ x = BSON.serialize(data) });
timeit(nloops, function(){ x = BSON.serialize(data) });
console.log(x);
timeit(nloops, function(){ x = bson_encode(data) });
timeit(nloops, function(){ x = bson_encode(data) });
timeit(nloops, function(){ x = bson_encode(data) });
console.log(x);
timeit(nloops, function(){ x = buffalo.serialize(data) });
timeit(nloops, function(){ x = buffalo.serialize(data) });
timeit(nloops, function(){ x = buffalo.serialize(data) });
console.log(x);
}
