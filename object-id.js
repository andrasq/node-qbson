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


function ObjectId( ) {
    // TODO: also use to generate and return an id??
}
ObjectId.prototype.bytes = 0;
var _convBuf = new Buffer(12);
ObjectId.prototype.toString = function toString( ) {            // value for string context (eg "" +)
    return scanHex(this.bytes, 0, 12);
    // else:
    for (var i=0; i<12; i++) _convBuf[i] = this.bytes[i];
    return _convBuf.toString('hex');
}
ObjectId.prototype.toJSON = ObjectId.prototype.toString;        // value for JSON.stringify
ObjectId.prototype.inspect = ObjectId.prototype.toString;       // value for console.log
ObjectId.prototype = ObjectId.prototype;
ObjectId.prototype.setFromBuffer = function setFromBuffer( buf, base ) {
    this.bytes = new Array(12);
    for (var i=0; i<12; i++) this.bytes[i] = buf[base+i];
    return this;
}
ObjectId.prototype.setFromString = function setFromString( s ) {
    // TODO: this is slow, 
    return this.setFromBuffer(new Buffer(s, 'hex'));
}
ObjectId.prototype = ObjectId.prototype;        // accelerate access



// extract the byte range as a hex string
var hexdigits = [ '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f' ];
var hexpairs = new Array(); for (var i=0; i<256; i++) hexpairs[i] = ((i < 16 ? '0' : '') + i.toString(16));
function scanHex( buf, base, bound ) {
    var str = "";
    for (var i=base; i<bound; i++) {
        //str += hexdigits[buf[i] >> 4] + hexdigits[buf[i] & 0x0F];
        str += hexpairs[buf[i]];
    }
    return str;
}
