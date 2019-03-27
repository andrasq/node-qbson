/**
 * streamlined utf8 read/write
 *
 * Copyright (C) 2019 Andras Radics
 * Licensed under the Apache License, Version 2.0
 */

'use strict';

var utf8 = require('../lib/utf8-2');
var newBuffer = require('../lib/new-buffer');

module.exports = {
    before: function(done) {
        this.testStrings = [
            "",
            "abc",
            "\u0081",
            "abc\u0091",
            "\u00a1abc",
            "\uEEEE\uFFFF",
            "\uD801abc",
            "abc\uD801",
            "\uD801\uDC01",
            "\uD801\uEEEE",
            "\uD801a",
            "\uDC01\uD801",
            "abc\uD801\uDC01def",
        ];
        done();
    },

    'utf8_write': {
        'should write': function(t) {
            var tests = this.testStrings;
            var sysbuf = newBuffer.new(200);
            var buf = newBuffer.new(200);

            for (var i = 0; i < tests.length; i++) {
                var sysLength = sysbuf.write(tests[i]);
                var length = utf8.write(buf, 0, tests[i]);
                t.equal(sysLength, length, " test " + i);
                t.equal(buf.toString('utf8', 0, length), sysbuf.toString('utf8', 0, sysLength), " test " + i);
            }

            for (var i = 0; i < 0x100000; i+=29) {
                var ch = String.fromCharCode(i);
                var n = sysbuf.write(ch);
                t.equal(utf8.write(buf, 0, ch), n);
                t.equal(buf.toString('utf8', 0, n), sysbuf.toString('utf8', 0, n));

                var n = sysbuf.write(ch + 'b');
                t.equal(utf8.write(buf, 0, ch + 'b'), n);
                t.equal(buf.toString('utf8', 0, n), sysbuf.toString('utf8', 0, n));

                var n = sysbuf.write('a' + ch);
                t.equal(utf8.write(buf, 0, 'a' + ch), n);
                t.equal(buf.toString('utf8', 0, n), sysbuf.toString('utf8', 0, n));

                var n = sysbuf.write('a' + ch + 'b');
                t.equal(utf8.write(buf, 0, 'a' + ch + 'b'), n);
                t.equal(buf.toString('utf8', 0, n), sysbuf.toString('utf8', 0, n));

                var s = String.fromCharCode(0xD800 + i%1024) + String.fromCharCode(0xDC00 + i%1024);
                var n = sysbuf.write(s);
                t.equal(utf8.write(buf, 0, s), n);
                t.equal(buf.toString('utf8', 0, n), sysbuf.toString('utf8', 0, n));
            }

            t.done();
        },

        'should write FFFD for invalid charcode': function(t) {
            var buf = [0xDC, 0x01, 0xDC, 0x00];
            var buf = [0, 0, 0, 0, 0, 0, 0, 0];
            utf8.write(buf, 0, "\uDC01\uDC00");
            t.deepEqual(buf, [0xEF, 0xBF, 0xBD, 0xEF, 0xBF, 0xBD, 0, 0]);
            t.done();
        },

        'should write a substring': function(t) {
            var buf = [0, 0, 0, 0, 0, 0, 0, 0];
            utf8.write(buf, 0, "Hello, world.", 3, 8);
            t.deepEqual(buf, [108, 111, 44, 32, 119, 0, 0, 0]);
            t.done();
        },

        'should write overlong': function(t) {
            var buf = [0, 0, 0, 0, 0, 0];
            utf8.write(buf, 0, "A\x00B", 0, 3, true);
            t.deepEqual(buf, [0x41, 0xC0, 0x80, 0x42, 0, 0]);
            t.done();
        },

        'should convert clipped multi-byte chars into \ufffd BADCHAR': function(t) {
            t.equal(utf8.read([0xC0]), '\ufffd');
            t.equal(utf8.read([0xE0]), '\ufffd');
            t.equal(utf8.read([0xF0]), '\ufffd');
            t.equal(utf8.read([0xE0, 0x80]), '\ufffd\ufffd');
            t.equal(utf8.read([0xE0, 0x41]), '\ufffd\u0041');
            t.equal(utf8.read([0xF0, 0x80]), '\ufffd\ufffd');
            t.equal(utf8.read([0xF0, 0x41]), '\ufffd\u0041');
            t.equal(utf8.read([0xF0, 0x80, 0x80]), '\ufffd\ufffd\ufffd');
            t.equal(utf8.read([0xF0, 0x80, 0x41]), '\ufffd\ufffd\u0041');
            t.equal(utf8.read([0xF0, 0x41, 0x80]), '\ufffd\u0041\ufffd');
            t.equal(utf8.read([0xF0, 0x41, 0x42]), '\ufffd\u0041\u0042');
            t.done();
        },

        'speed': function(t) {
            var x, buf = newBuffer.new(100);

            var str = "xxxxxxxx";
            console.time('write 8');
            for (var i=0; i<100000; i++) x = utf8.write(buf, 0, str);
            console.timeEnd('write 8');

            var str = "xxxxxxxxxxxxxxxx";
            console.time('write 16');
            for (var i=0; i<100000; i++) x = utf8.write(buf, 0, str);
            console.timeEnd('write 16');

            var str = "xxxxxxxxxxxxxxxxxxxxxxxx";
            console.time('write 24');
            for (var i=0; i<100000; i++) x = utf8.write(buf, 0, str);
            console.timeEnd('write 24');

            console.time('buf.write 24');
            if (buf instanceof Buffer) for (var i=0; i<100000; i++) x = buf.write(str);
            console.timeEnd('buf.write 24');
            // breakeven around 28

            t.done();
        },
    },

    'utf8_readZ': {
        'should read': function(t) {
            var tests = this.testStrings;
            var buf = newBuffer.new(100);

            for (var i = 0; i < tests.length; i++) {
                var nb = buf.write(tests[i]);
                buf[nb] = 0;
                t.equal(utf8.readZ(buf, 0, nb), buf.toString('utf8', 0, nb), " test " + i);
            }

            t.done();
        },

        'should read until the first zero': function(t) {
            t.equal(utf8.readZ([64, 65, 66, 0, 67, 68], 1), "AB");
            t.done();
        },

        'should set endp.end': function(t) {
            var endp = { end: -1 };
            t.equal(utf8.readZ([64, 65, 66, 0, 67, 68], 1, 0, endp), "AB");
            t.equal(endp.end, 3);
            t.done();
        },

        'should convert bad char leading bytes into BADCHAR \ufffd': function(t) {
            t.equal(utf8.readZ([0x91, 0]), '\uFFFD');
            t.done();
        },

        'should convert clipped multi-byte chars into BADCHAR \ufffd': function(t) {
            t.equal(utf8.readZ([0xC0, 0, 0]), '\ufffd');
            t.equal(utf8.readZ([0xE0, 0, 0]), '\ufffd');
            t.equal(utf8.readZ([0xF0, 0, 0]), '\ufffd');
            t.equal(utf8.readZ([0xE0, 0x80, 0]), '\ufffd\ufffd');
            t.equal(utf8.readZ([0xE0, 0x41, 0, 0]), '\ufffd\u0041');
            t.equal(utf8.readZ([0xF0, 0x80, 0]), '\ufffd\ufffd');
            t.equal(utf8.readZ([0xF0, 0x41, 0]), '\ufffd\u0041');
            t.equal(utf8.readZ([0xF0, 0x80, 0x80, 0]), '\ufffd\ufffd\ufffd');
            t.equal(utf8.readZ([0xF0, 0x80, 0x41, 0]), '\ufffd\ufffd\u0041');
            t.equal(utf8.readZ([0xF0, 0x41, 0x80, 0]), '\ufffd\u0041\ufffd');
            t.equal(utf8.readZ([0xF0, 0x41, 0x42, 0]), '\ufffd\u0041\u0042');
            t.done();
        },
    },

    'utf8.read': {
        'should read': function(t) {
            var tests = this.testStrings;
            var buf = newBuffer.new(100);

            for (var i = 0; i < tests.length; i++) {
                var nb = buf.write(tests[i]);
                t.equal(utf8.read(buf, 0, nb), buf.toString('utf8', 0, nb), " test " + i);
            }

            t.done();
        },

        'should read the entire buffer by default': function(t) {
            var buf = newBuffer.new("Hello, world.");
            t.equal(utf8.read(buf), "Hello, world.");
            t.done();
        },

        'should read overlong encoded codepoints': function(t) {
            t.equal(utf8.read([0xC0, 0x80]), "\x00");
            t.equal(utf8.read([0xC0, 0x87]), "\x07");
            t.equal(utf8.read([0xE0, 0x80, 0x87]), "\x07");
            t.equal(utf8.read([0xF0, 0x80, 0x80, 0x87]), "\x07");
            t.done();
        },

        'should reject invalid 1-byte charcode': function(t) {
            t.equal(utf8.read([0x41, 0x91, 0x42]), "A\uFFFDB");
            t.done();
        },

        'should reject a surrogate codepoint': function(t) {
            t.equal(utf8.read([0xF0, 0x80, 0x80, 0x80]), "\u0000");
            // overlong-encode the invalid codepoint D800 (leading surrogate) as 4 bytes F0.8D.A0.80
            t.equal(utf8.read([0x41, 0xF0, 0x8D, 0xa0, 0x80, 0x42]), "A\uFFFDB");
            t.done();
        },

        'should set endp.end if provided': function(t) {
            var item = { val: 0, end: -1 };
            t.equal(utf8.read([0x40, 0x41, 0xC0, 0x80, 0x42, 0x43], 1, 5, item), "A\x00B");
            t.equal(item.end, 5);
            t.done();
        },

        'speed': function(t) {
            var x;

            var buf = newBuffer.new("xxxxxxxx");
            console.time('read 8');
            for (var i=0; i<1000000; i++) x = utf8.read(buf, 0, buf.length);
            console.timeEnd('read 8');

            var buf = newBuffer.new("xxxxxxxxxxxxxxxx");
            console.time('read 16');
            for (var i=0; i<1000000; i++) x = utf8.read(buf, 0, buf.length);
            console.timeEnd('read 16');

            var buf = newBuffer.new("xxxxxxxxxxxxxxxxxxxxxxxx");
            // note: 2.3x faster to utf8.read from Uint8Array vs Buffer
            //buf = new Uint8Array(8);
            console.time('read 24');
            for (var i=0; i<1000000; i++) x = utf8.read(buf, 0, buf.length);
            console.timeEnd('read 24');

            console.time('buf.toString 24');
            if (buf instanceof Buffer) for (var i=0; i<1000000; i++) x = buf.toString('utf8', 0, buf.length);
            console.timeEnd('buf.toString 24');

            t.done();
        },
    },

    'utf8.byteLength': {
        'should return length of each char': function(t) {
            for (var i=0; i<65536; i++) {
                var ch = String.fromCharCode(i);
                t.equal(utf8.byteLength(ch), Buffer.byteLength(ch));
            }
            t.done();
        },

        'should return length as overlong': function(t) {
            t.equal(utf8.byteLength("abc"), 3);
            t.equal(utf8.byteLength("a\x00c", null, null, true), 4);
            t.done();
        },

        'should return length of valid and invalid surrogate pairs': function(t) {
            var pairs = [
                "\uD800\uDC00",         // valid
                "\uD800\uDC00a",        // valid, a
                "a\uD800\uDC00",        // a, valid
                "a\uD800\uDC00b",       // a, valid, b
                "\uD800a",              // invalid, a
                "a\uD800",              // a, invalid
                "a\uD800b",             // a, invalid, b
                "\uDC00\uD800",         // invalid, invalid
            ];
            for (var i=0; i<pairs.length; i++) {
                t.equal(utf8.byteLength(pairs[i]), Buffer.byteLength(pairs[i]));
            }
            t.done();
        },

        'should return length between base and bound': function(t) {
            t.equal(utf8.byteLength("ab\uD800\uDC00\x00c"), 8);
            t.equal(utf8.byteLength("ab\uD800\uDC00\x00c", null, null, true), 9);
            t.equal(utf8.byteLength("ab\uD800\uDC00\x00c", 1, 3), 4);
            t.equal(utf8.byteLength("ab\uD800\uDC00\x00c", 1, 4), 5);
            t.equal(utf8.byteLength("ab\uD800\uDC00\x00c", 1, 5), 6);
            t.equal(utf8.byteLength("ab\uD800\uDC00\x00c", 1, 5, true), 7);
            t.done();
        },
    },
}

function toHex(str) { return newBuffer.new(str).toString('hex') }
