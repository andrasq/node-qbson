/**

idea: combine type-id with size guess
idea: save type-ids to use when encoding, to not have to re-test
idea: use strings for type-id, 
idea: sizing functions requires converting to string, use the string
  => build up an annotated parse tree of the object, serialize from the tree?
  => { t: type, z: size, n: name, v: value to store }

**/

'use strict';

var bsonTypes = require('../bson-types');

var ObjectId = bsonTypes.ObjectId;
var Timestamp = bsonTypes.Timestamp;
var MinKey = bsonTypes.MinKey;
var MaxKey = bsonTypes.MaxKey;
var Long = bsonTypes.Long;
var DbRef = bsonTypes.DbRef;
var ScopedFunction = bsonTypes.ScopedFunction;

module.exports = {
    guessSize: guessSize,
    determinteTypeId: determineTypeId
};

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
function guessCompoundSize( item ) {
    var contentsSize = 0, i, key;
    if (Array.isArray(item)) {
        for (i=0; i<item.length; i++) {
            // typeId + name + value 
            if (item[i] !== undefined) contentsSize += (1) + (('' + i).length + 1) + guessSize(item[i]);
            //contentsSize += (1) + (Math.ceil(Math.log(i) / Math.log(10)) + 1 + 1) + guessSize(item[i]);
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

// estimate the _most_ bytes the value will occupy.  Never guess too low.
// The first switch maps the common sizes, a second switch the more obscure ones.
function guessSize( value ) {
    var id = determineTypeId(value);
    // TODO: if (bsonTypes.typeInfo[id].size > 0) return bsonTypes.typeInfo[id].size + bsonTypes.typeInfo[id].fixup;
    switch (id) {
    case T_INT: return 4;
    case T_FLOAT: return 8;
    // case T_STRING: return 4 + 3 * value.length + 1;
    case T_STRING: return 4 + Buffer.byteLength(String(value)) + 1;
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
// Its 40% faster to use a second switch than to exceed 600 chars (not inline),
// with only 3% penalty if having to use the second switch as well.
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