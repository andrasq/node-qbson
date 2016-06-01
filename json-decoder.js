/**
 * decode buffers into json string segments
 *
 * Should be fully equivalent to require('string_decoder'), but not verified.
 *
 * Copyright (C) 2016 Andras Radics
 * Licensed under the Apache License, Version 2.0
 */

'use strict';

module.exports = {
    JsonDecoder: JsonDecoder,
};

function JsonDecoder( encoding ) {
    encoding = encoding ? encoding.toLowerCase().replace(/[-_]/, '') : 'utf8';
    if (!Buffer.isEncoding(encoding)) throw new Error("unknown encoding " + encoding);

    this.encoding = encoding;
    this.fragBuf = new Buffer(8);
    this.fragLength = 0;
    this.nextSubstring = "";

    switch (encoding) {
    case 'utf8':
        this.fragSize = fragSizeUtf8;
        break;
    case 'ucs2':
    case 'utf16':
        this.fragSize = function(buf, base, bound) { return (bound - base) & 1 };
        break;
    case 'base64':
        this.fragSize = function(buf, base, bound) { return (bound - base) % 3 };
        break;
    case 'hex':
    default:
        this.fragSize = function(buf, base, bound) { return 0; };
        break;
    }
}

/*
 * convert the buffer and return the longest valid substring,
 * prepending any previous fragment bytes and retaining any trailing ones
 */
JsonDecoder.prototype.write = function write( buf ) {
    var offset = 0, extra, fragString = '', bufString, str1, str2;

    // first complete an existing fragment with bytes from the buffer
    // TODO: not having the num needed chars (retesting after each byte) slows this 50% over StringDecoder
    if (this.fragLength) while (offset < buf.length) {
        this.fragBuf[this.fragLength++] = buf[offset++];
        if (this.fragSize(this.fragBuf, 0, this.fragLength) === 0) break;
    }
    // if not enough bytes to complete the fragment, try next time
    if (offset >= buf.length) return '';

    // convert the fragment to string
    if (this.fragLength) str1 = this.fragBuf.toString(this.encoding, 0, this.fragLength);

    // convert the remainder of the buffer to string
    extra = this.fragSize(buf, offset, buf.length);
    str2 = buf.toString(this.encoding, offset, buf.length - extra);

    // save any new fragment at the end of the buffer for next time
    if (extra) this.fragLength = bufcpy(this.fragBuf, 0, buf, buf.length - extra, extra);

    // return the buffer appended to the fragment
    return str1 ? str1 + str2 : str2;
};

/*
 * convert the buffer like write, but flush any remaining fragment
 */
JsonDecoder.prototype.end = function end( buffer ) {
    var str = '';
    if (buffer && buffer.length) {
        str = this.write(buffer);
    }
    if (this.fragLength) {
        // not all encodings can make a char out of a fragment, but thats all we have
        var str2 = this.fragBuf.toString(this.encoding, 0, this.fragLength);
        str = str ? str + str2 : str2;
        this.fragLength = 0;
    }
    return str;
}

JsonDecoder.prototype = JsonDecoder.prototype;


// copy buffer contents like memcpy(), but returns the number of bytes copied
function bufcpy( dst, p2, src, p1, n ) {
    for (var i=0; i<n; i++) dst[p2 + i] = src[p1 + i];
    return n;
}

/*
 * fragSize return the number of bytes belonging to a split last symbol,
 * or 0 if the last symbol is not split.  In some encodings each symbol is
 * itself encoded with multiple characters (eg hex and base64).
 */

// utf8 encodes 1-4 bytes into one char
function fragSizeUtf8( buf, base, bound ) {
    // use switch as a jump table, fall through each case
    // each test checks whether that char starts a split multi-byte char
    switch (bound - base) {
    default:
    case 3: if ((buf[bound-3] & 0xF0) === 0xF0) return 3;       // 11110xxx 4+ byte char (not js)
    case 2: if ((buf[bound-2] & 0xE0) === 0xE0) return 2;       // 1110xxxx 3+ byte char
    case 1: if ((buf[bound-1] & 0xC0) === 0xC0) return 1;       // 110xxxxx 2+ byte char
    case 0: return 0;
    }
}

// hex encodes one byte as two chars
function fragSizeHex( buf, base, bound ) {
    return 0;
}

// base64 encodes groups of three bytes into four chars
function fragSizeBase64( buf, base, bound ) {
    return (bound - base) % 3;
}



// quicktest:
///**

var timeit = require('qtimeit');
var string_decoder = require('string_decoder');

var buf = new Buffer("Hello, world.\n");
var buf = new Buffer("\x81\x82\x81\x82\x81\x82\x81\x82\x81\x82\x81\x82\x81\x82");
for (var len = 1; len <= 12; len+=1) {
    var data = [];
    for (var i=0; i<buf.length; i+=len) data.push(buf.slice(i, i+len));

    console.log("parts of len", len);

    var x = '';
    var arj = new JsonDecoder();
    timeit(100000, function(){ x = ''; for (var i=0; i<data.length; i++) x += arj.write(data[i]); arj.end(); });
    //console.log(x);
    // 360k/s, ie 5 million buffers appended 1-ch, 600k/s 2-ch, 820k/s 3-ch, 1m/s 4-ch

    var sys = new string_decoder.StringDecoder();
    timeit(100000, function(){ x = ''; for (var i=0; i<data.length; i++) x += sys.write(data[i]); sys.end(); });
    //console.log(x);
}

/**/

/**

Notes:
- above is 7-8% faster than the built-in StringDecoder for plain ascii
- above is 30% slower for 2-byte uft8 of len 4,5 (but is 25% faster for len 3, 350% faster for 1, 1% slower for 2)

**/
