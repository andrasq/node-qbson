/**
 * fast binary mongodb ObjectId()
 *
 * Copyright (C) 2016 Andras Radics
 * Licensed under the Apache License, Version 2.0
 */

'use strict';

module.exports = ObjectId;


/*----------------------------------------------------------------
 * From https://docs.mongodb.com/v3.0/reference/bson-types/#objectid
 *
 * ObjectIds are small, likely unique, fast to generate, and ordered.  ObjectId
 * values consists of 12-bytes, where the first four bytes are a timestamp that
 * reflect the s creation, specifically:
 *
 * - a 4-byte value representing the seconds since the Unix epoch,
 * - a 3-byte machine identifier,
 * - a 2-byte process id, and
 * - a 3-byte counter, starting with a random value.ObjectId
 *
 * AR note: the timestamp and sequence are stored in big-endian order,
 * so I store the machine id and pid that way too.  Can't tell how
 * mongo does it, it seems to use random values for machine id and pid.
 */

function ObjectId( value, offset ) {
    if (!this || this === global) return new ObjectId(value, offset);
    this.str = null;
    this.bytes = null;
    if (value) {
        if (!offset) offset = 0;
        if (typeof value === 'string') this.setFromString(value, offset);
        else if (Buffer.isBuffer(value)) this.setFromBuffer(value, offset);
    }
}

ObjectId.prototype._get = function _get( ) {
    // generating into a static sparse array is faster than into Array(12) or new Array(12)
    // and into Array(12) is 35% faster than into an initialized array [0,0,...0]
    return this.bytes ? this.bytes : this.bytes = generateId([,,,,,,,,,,,,]);
}

ObjectId.prototype.copyToBuffer = function copyToBuffer( buffer, offset ) {
    var bytes = this._get();
    for (var i=0; i<12; i++) buffer[offset+i] = bytes[i];
    return offset+i;
}

// note that this version of toString is compatible with the nodejs bson driver,
// while mongodb specifies a bizarra 'ObjectId("...")' format.
ObjectId.prototype.toString = function toString( ) {            // value for string context (eg "" +)
    return bytesToHex(this._get(), 0, 12);
}
ObjectId.prototype.toJSON = ObjectId.prototype.toString;        // value for JSON.stringify
ObjectId.prototype.inspect = ObjectId.prototype.toString;       // value for console.log

ObjectId.createFromBuffer = function createFromBuffer( buf, base ) {
    return new ObjectId().setFromBuffer(buf, base);
}

ObjectId.prototype.setFromBuffer = function setFromBuffer( buf, base ) {
    this.bytes = Array(12);
    for (var i=0; i<12; i++) {
        this.bytes[i] = buf[base + i];
    }
    return this;
}
ObjectId.prototype.setFromString = function setFromString( s, from ) {
    if (!from) from = 0;
    this.bytes = Array(12);
    for (var i=0; i<12; i++) {
        this.bytes[i] = (hexValue(s.charCodeAt(from+2*i)) << 4) + hexValue(s.charCodeAt(from+2*i+1));
    }
    return this;
}

ObjectId.prototype.getTimestamp = function getTimestamp( ) {    // mongo compat
    var bytes = this._get();
    return new Date(((bytes[0] << 24 | bytes[1] << 16 | bytes[2] << 8 | bytes[4]) >>> 0) * 1000);
}
ObjectId.prototype.valueOf = function valueOf( ) {              // mongo compat
    return this.str = this.toJSON();
}


/*----------------------------------------------------------------
 * generate a unique ObjectId into the Buffer (or Array) dst
 * A mongo id is made of (timestamp + machine id + process id + sequence)
 */

// use a random machine id to keep things simple
var _machId = Math.random() * 0x100000000 >>> 8;
var _pid = process.pid;

// start sequence at a random offset to minimize chance of collision with another machine id
var _seq = Math.random() * 0x100000000 >>> 8;

// overflow occurs when the sequence id laps itself within the same second (same "now" period)
var _lastSeq = _seq;
var _lastNow = (Date.now() / 1000) >>> 0;

function _incrementSequence( now ) {
    _seq = (_seq + 1) & 0xFFFFFF;
    if (now !== _lastNow) {
        _lastSeq = _seq;
        _lastNow = now;
    }
    else {
        // prevent accidental duplicate ids
        if (_seq === _lastSeq) throw new Error("ObjectId sequence overflow");
    }
}

function generateId( dst ) {
    var now = (Date.now() / 1000) >>> 0;
    dst[0] = (now >> 24) & 0xFF;
    dst[1] = (now >> 16) & 0xFF;
    dst[2] = (now >>  8) & 0xFF;
    dst[3] = (now      ) & 0xFF;

    dst[4] = (_machId >> 16) & 0xFF;
    dst[5] = (_machId >> 8 ) & 0xFF;
    dst[6] = _machId & 0xFF;

    dst[7] = (_pid >> 8) & 0xFF;
    dst[8] = _pid & 0xFF;

    _incrementSequence(now);

    dst[9] = (_seq >> 16) & 0xFF;
    dst[10] = (_seq >> 8) & 0xFF;
    dst[11] = (_seq     ) & 0xFF;

    return dst;
}

ObjectId.prototype = ObjectId.prototype;        // accelerate access


/*----------------------------------------------------------------
 * hexadecimal string handling
 * TODO: move hexadecimal handling out into its own file 'hex.js'
 */

// extract the byte range as a hex string
var hexdigits = [ '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f' ];
//var hexpairs = new Array(256); for (var i=0; i<256; i++) hexpairs[i] = ((i < 16 ? '0' : '') + i.toString(16));
function bytesToHex( bytes, base, bound ) {
    var str = "";
    for (var i=base; i<bound; i++) {
        str += hexdigits[bytes[i] >> 4] + hexdigits[bytes[i] & 0x0F];
        //str += hexpairs[bytes[i]];
        //str += byteToHex(bytes[i]);
    }
    return str;
}
function byteToHex( byte ) {
    return hexdigits[byte >> 4] + hexdigits[byte & 0x0F];
}

function hexValue( code ) {
    if (code >= 0x30 && code <= 0x39) return code - 0x30;               // 0..9
    else if (code >= 0x61 && code <= 0x66) return code - 0x61 + 10;     // a..f
    else if (code >= 0x41 && code <= 0x46) return code - 0x41 + 10;     // A..F
    else return 0;
}



// quicktest:
if (process.env['NODE_TEST'] === 'object-id') {

var timeit = require('qtimeit');
var bson = require('bson');
var util = require('util');
var buffalo = require('buffalo');

var id1 = generateId(new Buffer(12));
var id2 = generateId(new Buffer(12));
console.log(id1, id2);

var id = new Buffer(12);
var x;
timeit(1000000, function(){ generateId(id) });
timeit(1000000, function(){ generateId(id) });
timeit(1000000, function(){ generateId(id) });
// 4.8m/s (without Date.now() would be 60m/s, so adaptive timestamp is good)
console.log("AR: generated id buffer and _sequence", id, _seq);

timeit(1000000, function(){ x = ObjectId()._get() });
timeit(1000000, function(){ x = ObjectId()._get() });
timeit(1000000, function(){ x = ObjectId()._get() });

timeit(1000000, function(){ x = bson.ObjectId() });
timeit(1000000, function(){ x = bson.ObjectId() });
timeit(1000000, function(){ x = bson.ObjectId() });
console.log(x);
// 625k/s !?

timeit(1000000, function(){ x = buffalo.ObjectId() });
timeit(1000000, function(){ x = buffalo.ObjectId() });
timeit(1000000, function(){ x = buffalo.ObjectId() });
console.log(x);

var buf = generateId(new Buffer(12));
console.log("AR: new id buf", buf);
var id1 = new ObjectId(buf);
console.log("AR: id1", id1.bytes);
var id1b = new ObjectId(buf.toString('hex'));
console.log("AR: id1b", id1b.bytes);
console.log(id1);
console.log(id1b);

var id2 = bson.ObjectId(buf.toString('hex'));
console.log(id2);

}
