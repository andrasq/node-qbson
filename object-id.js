/**
 * fast binary mongodb ObjectId()
 *
 * Copyright (C) 2016 Andras Radics
 * Licensed under the Apache License, Version 2.0
 */


// copied from decode.js
// TODO: clean up

'use strict';

module.exports = ObjectId;


function ObjectId( value, offset ) {
    this.bytes = null;
    if (value) {
        if (!offset) offset = 0;
        if (typeof value === 'string') this.setFromString(value, offset);
        else if (Buffer.isBuffer(value)) this.setFromBuffer(value, offset);
    }
}

ObjectId.prototype._get = function _get( ) {
    return this.bytes ? this.bytes : this.bytes = generateId(this.bytes);
}

ObjectId.prototype.copyToBuffer = function copyToBuffer( buffer, offset ) {
    var bytes = this._get();
    for (var i=0; i<12; i++) buffer[offset+i] = bytes[i];
    return offset+i;
}

ObjectId.prototype.toString = function toString( ) {            // value for string context (eg "" +)
    return bytesToHex(this._get(), 0, 12);
}
ObjectId.prototype.toJSON = ObjectId.prototype.toString;        // value for JSON.stringify
ObjectId.prototype.inspect = ObjectId.prototype.toString;       // value for console.log

ObjectId.prototype.setFromBuffer = function setFromBuffer( buf, base ) {
    this.bytes = Array(12);
    for (var i=0; i<12; i++) {
        this.bytes[i] = buf[base+i];
        this.bytes[i+1] = buf[base+i+1];
        this.bytes[i+2] = buf[base+i+2];
        this.bytes[i+3] = buf[base+i+3];
    }
    return this;
}

ObjectId.prototype.setFromString = function setFromString( s, from ) {
    if (!from) from = 0;
    this.bytes = Array(12);
    for (var i=0; i<12; i++) {
        this.bytes[i] = (hexValue(s.charCodeAt(from+2*i)) << 4) + hexValue(s.charCodeAt(from+2*i+1));
    }
}

/*
 * return a unique mongo-id
 */
// use a random machine id to keep things simple
var _sysId = Math.random() * 0x100000000 >>> 8;
var _pId = process.pid;
// start sequence at a random offset to minimize chance of collision with another machineId
var _seq = Math.random() * 0x100000000 >>> 8;

var _lastOverflow = (Date.now() / 1000) >>> 0;
function _incrementSequence( now ) {
    // increment the sequence, and test for sequence overflow
    if (++_seq === 0) {
        if (_lastOverflow === now) throw new Error("id sequence overflow");
        _lastOverflow = now;
    }
    return;
}

// TODO: time generating from numeric sequence number (not bytes)

function generateId( dst ) {

    _incrementSequence(tm);

    var tm = (Date.now() / 1000) >>> 0;
    dst[0] = (tm >> 24) & 0xFF;
    dst[1] = (tm >> 16) & 0xFF;
    dst[2] = (tm >>  8) & 0xFF;
    dst[3] = (tm      ) & 0xFF;

    dst[4] = (_sysId >> 16) & 0xFF;
    dst[5] = (_sysId >> 8) & 0xFF;
    dst[6] = (_sysId     ) & 0xFF;

    dst[7] = (_pId >> 8) & 0xFF;
    dst[8] = (_pId     ) & 0xFF;

    dst[9] = (_seq >> 16) & 0xFF;
    dst[10] = (_seq >> 8) & 0xFF;
    dst[11] = (_seq     ) & 0xFF;

    return dst;
}

ObjectId.prototype = ObjectId.prototype;        // accelerate access


// extract the byte range as a hex string
var hexdigits = [ '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f' ];
//var hexpairs = new Array(256); for (var i=0; i<256; i++) hexpairs[i] = ((i < 16 ? '0' : '') + i.toString(16));
function bytesToHex( bytes, base, bound ) {
    var str = "";
    for (var i=base; i<bound; i++) {
        str += hexdigits[bytes[i] >> 4] + hexdigits[bytes[i] & 0x0F];
        //str += hexpairs[bytes[i]];
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

var id1 = generateId(new Buffer(12));
var id2 = generateId(new Buffer(12));
console.log(id1, id2);

var id = new Buffer(12);
timeit(0x400000, function(){ generateId(id) });
// 4.8m/s (without Date.now() would be 60m/s, so adaptive timestamp is good)
console.log("AR: generated id buffer and _sequence", id, _seq);

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
