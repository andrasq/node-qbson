/**
 * streamlined utf8 read/write
 *
 * Copyright (C) 2019 Andras Radics
 * Licensed under the Apache License, Version 2.0
 */

'use strict';

var utf8 = require('../utf8-2');

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
            var sysbuf = new Buffer(200);
            var buf = new Buffer(200);

            for (var i = 0; i < tests.length; i++) {
                var sysLength = sysbuf.write(tests[i]);
                var length = utf8.write(buf, 0, tests[i]);
//console.log(length, buf.slice(0, length));
//console.log(sysLength, sysbuf.slice(0, sysLength));
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

        'speed': function(t) {
            var x, buf = new Buffer(100);

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

    'utf8.read': {
        'should read': function(t) {
            var tests = this.testStrings;
            var buf = new Buffer(100);

            for (var i = 0; i < tests.length; i++) {
                var nb = buf.write(tests[i]);
                t.equal(utf8.read(buf, 0, nb), buf.toString('utf8', 0, nb), " test " + i);
            }

            t.done();
        },

        'should read the entire buffer by default': function(t) {
            var buf = new Buffer("Hello, world.");
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

        'speed': function(t) {
            var x;

            var buf = new Buffer("xxxxxxxx");
            console.time('read 8');
            for (var i=0; i<1000000; i++) x = utf8.read(buf, 0, buf.length);
            console.timeEnd('read 8');

            var buf = new Buffer("xxxxxxxxxxxxxxxx");
            console.time('read 16');
            for (var i=0; i<1000000; i++) x = utf8.read(buf, 0, buf.length);
            console.timeEnd('read 16');

            var buf = new Buffer("xxxxxxxxxxxxxxxxxxxxxxxx");
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
}
