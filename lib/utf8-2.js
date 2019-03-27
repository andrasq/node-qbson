/**
 * streamlined utf8 read/write
 *
 * Copyright (C) 2016-2019 Andras Radics
 * Licensed under the Apache License, Version 2.0
 */

'use strict';

module.exports = {
    // do not call a function with mix-and-match the argument types to functions, it kills the optimization
    // The primary function names work on arrays.  Easiest is to delete require.cache[require.resolve('utf8-2')]

    write: utf8_write,
    read: utf8_read,
    readZ: utf8_readZ,
    byteLength: utf8_byteLength,

    // encodeUtf8: function(s, fm, to, into, pos) { return utf8_write(into, pos, str, fm, to) },
    // encodeUtf8Overlong: function(s, fm, to, into, pos) { return utf8_write(into, pos, str, fm, to, true) },
};

var BADCHAR = "\uFFFD";
var BADCHARCODE = 0xFFFD;

function utf8_write( buf, pos, str, base, bound, asOverlong ) {
    base = base || 0;
    bound = bound != null ? bound : str.length;
    // asOverlong = asOverlong || false;
    for (var ix=pos, i=base; i<bound; i++) {
        var ch = str.charCodeAt(i);
        if (ch < 0x80) {
            if (!ch && asOverlong) { buf[ix++] = 0xC0; buf[ix++] = 0x80; }
            else buf[ix++] = ch;
        }
        else if (ch < 0x800) {
            buf[ix++] = 0xC0 | ((ch >>  6)       );
            buf[ix++] = 0x80 | ((ch      ) & 0x3F);
        }
        else if (ch < 0xD800 || ch >= 0xE000) {
            buf[ix++] = 0xE0 | ((ch >> 12)       );
            buf[ix++] = 0x80 | ((ch >>  6) & 0x3F);
            buf[ix++] = 0x80 | ((ch      ) & 0x3F);
        }
        else {
            // D800..DFFF is only valid for surrogate pairs, which encode 20 bits in 4 bytes
            // A surroge pair must contain two chars, the first D800-DBFF, the second DC00-DFFF.
            // Those 10 + 10 bits encode the 2^20 codepoints from 0x10000 to 0x10FFFF.
            // Test valid ch2 by negating the positive assertion, to handle NaN ch2.

            var ch2;
            if (ch >= 0xDC00 || i+1 > bound) ix = utf8_write(buf, ix, BADCHAR, 0, 1);
            else if ((ch2 = str.charCodeAt(++i)) >= 0xDC00 && ch2 <= 0xDFFF) {
                ch = 0x10000 + (((ch & 0x03FF) << 10) | ((ch2 & 0x03FF)));
                buf[ix++] = 0xF0 | ((ch >> 18) & 0x3F);
                buf[ix++] = 0x80 | ((ch >> 12) & 0x3F);
                buf[ix++] = 0x80 | ((ch >>  6) & 0x3F);
                buf[ix++] = 0x80 | ((ch      ) & 0x3F);
            }
            else { --i; ix = utf8_write(buf, ix, BADCHAR, 0, 1) }
        }
    }
    return ix;
}

function utf8_byteLength( str, base, bound, asOverlong ) {
    base = base || 0;
    bound = bound != null ? bound : str.length;
    asOverlong = 0 + !!asOverlong;

    var len = 0, ch2;
    for (var i=base; i<bound; i++) {
        var ch = str.charCodeAt(i);
        if (ch < 0x80) { len += 1 + (!ch ? asOverlong : 0) }
        else if (ch < 0x800) { len += 2 }
        else if (ch < 0xD800 || ch > 0xDFFF) { len += 3 }
        else if (i + 1 >= bound) { len += 3 }
        else {
            if (ch >= 0xDC00 || i+1 > bound) { len += 3; }
            else if ((ch2 = str.charCodeAt(++i)) >= 0xDC00 && ch2 <= 0xDFFF) { len += 4; }
            else { --i; len += 3; }
         }
    }
    return len;
}

// presumed-valid read, does not validate input.  Use to scan known good utf8.
// Does not error out on overlong-encoded surrogate pairs or codepoints.
// TODO: try to combine with readZ by passing in a notStringEnd(buf, i) test;
// maybe build separate instances with "with ({ notStringEnd: ... }) read = eval('true && ' + String(baseFunc))"
function utf8_read( buf, base, bound, endp ) {
    base = base || 0;
    bound = bound != null ? bound : buf.length;
    var code, str = '';
    for (var i=base; i<bound; i++) {
        var ch = buf[i];
        if (ch < 0x80) str += String.fromCharCode(ch);
        else if (ch < 0xC0) str += BADCHAR;
        else if (ch < 0xE0 && i + 1 < bound) str += String.fromCharCode(((ch & 0x1F) << 6) | (buf[++i] & 0x3F));
        else if (ch < 0xF0 && i + 2 < bound) str += String.fromCharCode(((ch & 0x0F) << 12) | ((buf[++i] & 0x3F) << 6) | (buf[++i] & 0x3F));
        else if (buf[i+1] && i + 3 < bound) { str += utf8_read4(buf, i); i += 4 - 1 }
        else str += BADCHAR;
    }
    if (endp) endp.end = i;
    return str;
}
function utf8_read4(buf, i) {
    var codepoint = ((buf[i] & 0x03) << 18) | ((buf[++i] & 0x3F) << 12) |  ((buf[++i] & 0x3F) << 6) |  (buf[++i] & 0x3F);
    if (codepoint >= 0xD800 && codepoint <= 0xDFFF) return BADCHAR;  // reserved surrogate pair codepoint
    return (codepoint < 0x10000)
        ? String.fromCharCode(codepoint)                                        // overlong-encoded utf16
        : String.fromCharCode(0xD800 | ((codepoint - 0x10000) >> 10) & 0x3FF) + // surrogate pair
          String.fromCharCode(0xDC00 | ((codepoint - 0x10000)      ) & 0x3FF);
}

function utf8_readZ( buf, base, bound, endp ) {
    base = base || 0;
    var code, str = '';
    for (var i=base; buf[i]; i++) {
        var ch = buf[i];
        if (ch < 0x80) str += String.fromCharCode(ch);
        else if (ch < 0xC0) str += BADCHAR;
        else if (ch < 0xE0 && buf[i+1]) str += String.fromCharCode(((ch & 0x1F) << 6) | (buf[++i] & 0x3F));
        else if (ch < 0xF0 && buf[i+1] && buf[i+2]) str += String.fromCharCode(((ch & 0x0F) << 12) | ((buf[++i] & 0x3F) << 6) | (buf[++i] & 0x3F));
        else if (buf[i+1] && buf[i+2] && buf[i+3]) { str += utf8_read4(buf, i); i += 4 - 1 }
        else str += BADCHAR;
    }
    if (endp) endp.end = i;
    return str;
}

/**
// error-checking read
function utf8_read_check( buf, base, bound ) {
    base = base || 0;
    bound = bound != null ? bound : buf.length;
    var code, str = '';
    for (var i=base; i<bound; i++) {
        var ch = buf[i], ch2, ch3, ch4;
        if (ch < 0x80) str += String.fromCharCode(ch);
        else if (ch < 0xC0) str += BADCHAR;     // invalid continuation char
        else if (ch < 0xE0) { str += read2(buf, i, bound, ch); i += 2-1 }
        else if (ch < 0xF0) { str += read3(buf, i, bound); i += 3-1 }
        else { str += read4(buf, i, bound); i += 4-1 }
    }
    return str;
}
function read2(buf, i, bound, ch) {
    var ch2 = buf[++i];
    if ((ch2 & 0xC0) !== 0x80) return BADCHAR;
    var code = ((ch & 0x1F) << 6) | (ch2 & 0x3F);
    return String.fromCharCode(code);
}
function read3(buf, i, bound, ch) {
    var ch2 = buf[++i], ch3 = buf[++i];
// FIXME: should restart reading after the badchar
    if ((ch2 & 0xC0) !== 0x80) return BADCHAR;
    if ((ch3 & 0xC0) !== 0x80) return BADCHAR;
    var code = ((ch & 0x0F) << 12) | ((ch2 & 0x3F) << 6) | (ch3 & 0x3F);
    return String.fromCharCode(code);
}
function read4(buf, i, bound, ch) {
    if (ix + 4 < bound) return BADCHAR;
    var code = ((ch & 0x07) << 18) | ((buf[++i] & 0x3F) << 12) | ((buf[++i] & 0x3F) << 6) | (buf[++i] & 0x3F);
    code -= 0x10000;
    // return a surrogate pair for codepoints between 0x10000 and 0x10FFFF.
    return String.fromCharCode(0xD800 | (code >> 10)) + String.fromCharCode(0xDC00 + (code & 0x3FF));
}
**/
