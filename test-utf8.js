/**
 * Copyright (C) 2016 Andras Radics
 * Licensed under the Apache License, Version 2.0
 */

'use strict';

var assert = require('assert');

var sysbuf = new Buffer([0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]);
var testbuf = new Buffer([0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]);

var utf8 = require('./utf8.js');

for (var i=0; i<0x10000; i++) {
    var chr1 = String.fromCharCode(i);
    var chr2 = String.fromCharCode(i ^ 1);
    var chr3 = String.fromCharCode(i ^ 0x100);
    var chr4 = String.fromCharCode(i ^ 0x1000);
    var strings = [
        chr1,                    // only char
        "ab" + chr1,             // last
        chr1 + "bc",             // first
        "a" + chr1 + "bc",       // middle
        "a" + chr1 + chr2 + "bc",  // adjacent
        "a" + chr1 + chr3 + "bc",  // adjacent to 2-byte
        "a" + chr1 + chr4 + "bc",  // adjacent to 3-byte
    ];

    // encodeUtf8 should convert all chars the same as Buffer.write
    for (var j=0; j<strings.length; j++) {
        sysbuf.write(strings[j], 0);
        utf8.encodeUtf8(strings[j], 0, strings[j].length, testbuf, 0);
        assert.deepEqual(testbuf, sysbuf);
    }

    // stringLength should correctly count multi-byte utf8 characters
    for (var j=0; j<strings.length; j++) {
        var len = sysbuf.write(strings[j], 0);
        assert.equal(utf8.stringLength(sysbuf, 0, len, 'utf8'), strings[j].length);
    }

    // decodeUtf8 should recover the same string as Buffer.toString
    for (var j=0; j<strings.length; j++) {
        var len = sysbuf.write(strings[j], 0);
        var str = sysbuf.toString('utf8', 0, len);
        var utf = utf8.decodeUtf8(sysbuf, 0, len);
        assert.equal(utf, str);
    }

    // byteLength should count the number of bytes required for the substring
    for (var j=0; j<strings.length; j++) {
        assert.equal(utf8.byteLength(strings[j], 0, strings[j].length), Buffer.byteLength(strings[j]));
        assert.equal(utf8.byteLength(strings[j], 1, strings[j].length), Buffer.byteLength(strings[j].slice(1)));
        assert.equal(utf8.byteLength(strings[j], 0, strings[j].length-1), Buffer.byteLength(strings[j].slice(0, -1)));
    }

    // encodeJson should write same strings as JSON
    for (var j=0; j<strings.length; j++) {
        var nb = utf8.encodeJson(strings[j], 0, strings[j].length, testbuf, 0);
        testbuf.copy(sysbuf);
console.log(nb, testbuf);
        assert.equal(testbuf.toString('utf8', 0, nb), JSON.stringify(strings[j]).slice(1, -1))
    }
}
