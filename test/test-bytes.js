'use strict';

var assert = require('assert');
var bytes = require('../bytes');

var buf = new Buffer(16);
var arr = new Array(16);
function fill(a, v) { for (var i=0; i<a.length; i++) a[i] = v || 0 }

assert.deepEqual(bytes.getInt32([1, 2, 3, 4], 0), 0x04030201);
assert.deepEqual(bytes.getInt32([1, 2, 3, 4, 5], 1), 0x05040302);
assert.deepEqual(bytes.getInt32([254, 255, 255, 255], 0), -2);

assert.deepEqual(bytes.getUInt32([1, 2, 3, 4], 0), 0x04030201);
assert.deepEqual(bytes.getUInt32([1, 2, 3, 4, 5], 1), 0x05040302);
assert.deepEqual(bytes.getUInt32([254, 255, 255, 255], 0), 0xfffffffe);

assert.equal(bytes.putInt32(1, buf, 1), 5);
bytes.putInt32(0x01020304, buf, 0);
assert.deepEqual(bytes.getInt32(buf, 0), 0x01020304);
bytes.putInt32(0x01020304, buf, 1);
assert.deepEqual(bytes.getInt32(buf, 1), 0x01020304);
bytes.putInt32(-2, buf, 0);
assert.deepEqual(bytes.getInt32(buf, 0), -2);

assert.equal(bytes.putUInt32(1, buf, 1), 5);
bytes.putUInt32(0x01020304, buf, 0);
assert.deepEqual(bytes.getUInt32(buf, 0), 0x01020304);
bytes.putUInt32(0x01020304, buf, 1);
assert.deepEqual(bytes.getUInt32(buf, 1), 0x01020304);
bytes.putUInt32(-2, buf, 0);
assert.deepEqual(bytes.getUInt32(buf, 0), 0xfffffffe);

fill(buf, 0xff);
assert.equal(bytes.putInt64(1, buf, 1), 9);
bytes.putInt64(0x010203040506, buf, 1);
assert.equal(bytes.getInt32(buf, 1), 0x03040506);
assert.equal(bytes.getInt32(buf, 5), 0x00000102);
assert.equal(bytes.getInt64(buf, 1), 0x010203040506);

fill(buf, 0);
bytes.putInt64(-1, buf, 0);
assert.equal(bytes.getInt64(buf, 0), -1);
assert.equal(bytes.getInt32(buf, 0), -1);
assert.equal(bytes.getInt32(buf, 4), -1);
fill(buf, 0);
bytes.putInt64(0xffffffffffff, buf, 0);
assert.equal(bytes.getInt64(buf, 0), 0xffffffffffff);
bytes.putInt64(0x010203040506, buf, 0);
assert.equal(bytes.getInt64(buf, 0), 0x010203040506);

fill(buf, 0);
bytes.putInt64(-2, buf, 0);
assert.equal(bytes.getInt64(buf, 0), -2);
assert.equal(bytes.getInt32(buf, 0), -2);
assert.equal(bytes.getInt32(buf, 4), -1);
fill(buf, 0);
bytes.putInt64(-0x010101010101, buf, 1);
assert.equal(bytes.getInt64(buf, 1), -0x010101010101);
bytes.putInt64(-0xffffffffffff, buf, 0);
assert.equal(bytes.getInt64(buf, 0), -0xffffffffffff);
bytes.putInt64(-0x010203040506, buf, 1);
assert.equal(bytes.getInt64(buf, 1), -0x010203040506);
bytes.putInt64(-0x100000000, buf, 0);
assert.equal(bytes.getInt64(buf, 0), -0x100000000);
bytes.putInt64(-0x200000001, buf, 0);
assert.equal(bytes.getInt64(buf, 0), -0x200000001);

var fp = Math.random();
bytes.putFloat(fp, buf, 1);
assert.equal(buf.readDoubleLE(1), fp);
assert.equal(bytes.getFloat(buf, 1), fp);

var entity = bytes.byteEntity();
buf.write("0234\x00", 1);
assert.equal(bytes.scanIntZ(buf, 0 + 1, entity), 5 + 1);
assert.equal(entity.val, 234);
// TODO: deprecate setting entity.end, is always obvious
// assert.equal(entity.end, 4 + 1);

var entity = bytes.byteEntity();
fill(buf, 0x41);
buf[0] = 0x42;
buf[14] = 0;
assert.equal(bytes.scanStringZ(buf, 0, entity), 15);
assert.equal(entity.val, 'BAAAAAAAAAAAAA');
//assert.equal(entity.end, 14);

var entity = bytes.byteEntity();
fill(arr, 0x41);
arr[0] = 0x42;
arr[14] = 0;
assert.equal(bytes.scanStringZ(arr, 0, entity), 15);
assert.equal(entity.val, 'BAAAAAAAAAAAAA');
//assert.equal(entity.end, 14);

var entity = bytes.byteEntity();
fill(arr, 0xff);
bytes.putStringZ("foobar", arr, 3);
assert.deepEqual(arr.slice(3, 10), [102, 111, 111, 98, 97, 114, 0]);
assert.deepEqual(arr.slice(0, 3), [255, 255, 255]);
assert.deepEqual(arr.slice(10), [255, 255, 255, 255, 255, 255]);
assert.equal(bytes.scanStringZ(arr, 3, entity), 10);
assert.equal(entity.val, "foobar");
//assert.equal(entity.end, 9);
fill(arr, 0xff);
assert.equal(bytes.putStringZ("\u1234567", arr, 3), 3 + 6 + 1);
assert.deepEqual(arr.slice(3, 3 + 5), [0xe1, 0x88, 0xb4, 0x35, 0x36]);
assert.deepEqual(arr.slice(0, 3), [255, 255, 255]);
assert.deepEqual(arr.slice(10), [255, 255, 255, 255, 255, 255]);
assert.equal(bytes.scanStringZ(arr, 3, entity), 10);
assert.equal(entity.val, "\u1234" + "567");
//assert.equal(entity.end, 9);

assert.equal(bytes.scanStringZ([65, 66, 67], 0, entity), 3);
assert.equal(entity.val, 'ABC');
//assert.equal(entity.end, 3);

arr[0] = 0xef; arr[1] = 0xbe; arr[2] = 0xbd; arr[3] = 0;
assert.equal(bytes.scanStringZ(arr, 0, entity), 4);
assert.equal(entity.val, "\uffbd");
fill(arr, 0xff);
assert.equal(bytes.putStringZ("\uffbd", arr, 0), 4);
assert.deepEqual(arr.slice(0, 4), [0xef, 0xbe, 0xbd, 0]);

fill(arr, 0xff);
bytes.putString("foo \u1234 bar", arr, 2);
assert.equal(bytes.putString("foo \u1234 bar", arr, 2), 2 + 11);
assert.equal(new Buffer(arr.slice(2, 13)).toString(), "foo \u1234 bar");
fill(arr, 0x0);
assert.equal(bytes.putString("foo \u0123", arr, 2), 2 + 6);
bytes.scanStringZ(arr, 2, entity);
assert.equal(entity.val, "foo \u0123");
assert.deepEqual(arr.slice(0, 10), [0, 0, 102, 111, 111, 32, 0xc4, 0xa3, 0, 0]);

fill(buf, 0xff);
bytes.putString("foo \u1234 bar", buf, 2);
assert.equal(bytes.putString("foo \u1234 bar", buf, 2), 2 + 11);
assert.equal(new Buffer(buf.slice(2, 13)).toString(), "foo \u1234 bar");
// should also work using buf.write
var bigbuf = new Buffer(new Array(201).join("\x00"));
bytes.putString(new Array(101).join('x'), bigbuf, 0);
var entity = bytes.byteEntity();
assert.equal(bytes.scanStringZ(bigbuf, 0, entity), 101);
assert.equal(entity.val, new Array(101).join('x'));
//assert.equal(entity.end, 100);

// should cast argument to string
fill(arr, 0xff);
assert.equal(bytes.putStringZ(1234, arr, 3), 8);
assert.deepEqual(arr.slice(3, 8), [0x31, 0x32, 0x33, 0x34, 0]);

fill(arr, 0xff);
assert.equal(bytes.putStringZOverlong("\x00\x00", arr, 0), 5);
assert.deepEqual(arr.slice(0, 5), [0xc0, 0x80, 0xc0, 0x80, 0]);
bytes.scanStringZ(arr, 0, entity);
assert.equal(entity.val, "\x00\x00");
//assert.equal(entity.end, 4);
// TODO: nodejs does not correctly decode overlong-encoded C0 80 NUL characters
// (instead, it converts them into two "EF BF BD" utf8 "replacement characters")
// XXX assert.equal(new Buffer([0xc0, 0x80]).toString(), "\x00");
buf.write('\xF0\x90\x80\x81foo\x00', 'binary');
bytes.scanStringZ(buf, 0, entity);
// FIXME:
// assert.equal(entity.val, "\ufffdfoo");
// assert.equal(entity.end, 4);
