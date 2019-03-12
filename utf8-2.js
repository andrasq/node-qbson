/**
 * streamlined utf8 read/write
 *
 * Copyright (C) 2016-2019 Andras Radics
 * Licensed under the Apache License, Version 2.0
 */

'use strict';

module.exports = {
    write: utf8_write,
    read: utf8_read,

    // encodeUtf8: function(s, fm, to, into, pos) { return utf8_write(into, pos, str, fm, to) },
    // encodeUtf8Overlong: function(s, fm, to, into, pos) { return utf8_write(into, pos, str, fm, to, true) },
};

var BADCHAR = "\uFFFD";
var BADCHARCODE = 0xFFFD;

function utf8_write( buf, pos, str, base, bound, asOverlong ) {
    base = base || 0;
    bound = bound != null ? bound : str.length;
    asOverlong = asOverlong || false;
    for (var ix=pos, i=base; i<bound; i++) {
        var ch = str.charCodeAt(i);
        if (ch < 0x80) {
            if (!ch && asOverlong) { buf[ix++] = 0xC0; buf[ix++] = 0x80; }
            else buf[ix++] = ch;
        }
        else if (ch < 0x800) { write2(ch, buf, ix); ix += 2 }
        else if (ch < 0xD800 || ch >= 0xE000) { write3(ch, buf, ix); ix += 3 }
        else {
            // D800..DFFF is only valid for surrogate pairs, which encode 20 bits in 4 bytes
            // the first code must be D800-DBFF, the sedond DC00-DFFF, and these 20 bits are offset -0x10000.
            var ch2 = str.charCodeAt(i+1);
            if (ch >= 0xDC00 || !(ch2 > 0xDC00 && ch2 < 0xE000)) { write3(BADCHARCODE, buf, ix); ix += 3; continue }
            write4(0x10000 + ((ch & 0x03FF) << 10) | ((ch2 & 0x03FF)), buf, ix);
            ix += 4;
            i++;
        }
    }
    return ix;
}
function write2(ch, buf, ix) {
    buf[ix++] = 0xC0 | ((ch >>  6)       );
    buf[ix  ] = 0x80 | ((ch      ) & 0x3F);
}
function write3(ch, buf, ix) {
    buf[ix++] = 0xE0 | ((ch >> 12)       );
    buf[ix++] = 0x80 | ((ch >>  6) & 0x3F);
    buf[ix  ] = 0x80 | ((ch      ) & 0x3F);
}
function write4(ch, buf, ix) {
    buf[ix++] = 0xF0 | ((ch >> 18)       );
    buf[ix++] = 0x80 | ((ch >> 12) & 0x3F);
    buf[ix++] = 0x80 | ((ch >>  6) & 0x3F);
    buf[ix  ] = 0x80 | ((ch      ) & 0x3F);
}

// presumed-valid read, does not validate input.  Use to scan known good utf8.
// Does not error out on overlong-encoded surrogate pairs or codepoints.
function utf8_read( buf, base, bound ) {
    base = base || 0;
    bound = bound != null ? bound : buf.length;
    var code, str = '';
    for (var i=base; i<bound; i++) {
        var ch = buf[i];
        if (ch < 0x80) str += String.fromCharCode(ch);
        else if (ch < 0xC0) str += BADCHAR;
        else if (ch < 0xE0) str += String.fromCharCode(((ch & 0x1F) << 6) | (buf[++i] & 0x3F));
        else if (ch < 0xF0) str += String.fromCharCode(((ch & 0x0F) << 12) | ((buf[++i] & 0x3F) << 6) | (buf[++i] & 0x3F));
        else { str += utf8_read4(buf, i); i += 4 - 1 }
    }
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
