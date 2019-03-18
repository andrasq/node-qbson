qbson
=====
[![Build Status](https://api.travis-ci.org/andrasq/node-qbson.svg?branch=master)](https://travis-ci.org/andrasq/node-qbson?branch=master)
[![Coverage Status](https://coveralls.io/repos/github/andrasq/node-qbson/badge.svg?branch=master)](https://coveralls.io/github/andrasq/node-qbson?branch=master)

This package provides a quick, lean BSON encode / decode serializer.

The original version was written as an experiment in Feb 2015, to time a hand-rolled
serializer vs the available C++ plugin.  The code first appeared in
[`json-simple`](https://github.com/andrasq/node-json-simple).  The experiment was promising,
it was 6.5x faster to encode and 2x faster to decode than C++, but much slower than the
built-in JSON serializer.

Fast forward a few years of nodejs changes and V8 optimization improvements, and the
comparison is even more favorable, qbson being quite competitive with or even beating JSON.

Possibly this package should be called `wisent`, to follow the pattern set by `bson` and
`buffalo` (it's a Euro-phone pun; think _bee'sown_.)


API
---

    const qbson = require('qbson');

### qbson.encode( object )

Serialize the object and return a buffer containing the BSON data.

### qbson.decode( bson )

Deserialiaze the BSON data from the buffer (or array) and return the corresponding
JavaScript object.


Supported Types
---------------

All BSON data types are supported, even the deprecated ones.  The
JavaScript native data types are automatically converted to the equivalent BSON type,
non-native types are specified using helper classes (see below).

- 1 **float** - javascript number, ieee 754 64-bit little-endian floating point value
- 2 **string** - javascript string, utf8 text
- 3 **object** - javascript Object, name-value mapping of bson entities
- 4 **array** - javascript Array, list of bson entities
- 5 **binary** - binary data in a Buffer.  The BSON binary subtype is specified as a
    property .subtype on the Buffer object.
- 6 **undefined** - javascript undefined (deprecated)
- 7 **ObjectId** - binary MongodDB object id, see below
- 8 **boolean** - javascript true, false
- 9 **Date** - javascript Date
- 10 **null** - javascript null
- 11 **RegExp** - javascript RegExp object
- 12 **DbRef** - resource name string and ObjectId (deprecated)
- 13 **function** - javascript code
- 14 **symbol** - javascript Symbol
- 15 **function** with scope - javascript code with scope.  The scope is specified
     as a property .scope on the function itself.
- 16 **int** - 32-bit little-endian signed integer.  Javascript numbers are
     automatically stored as integers if their value would not be changed by
     coercion.  NaN, +/- Infinity and -0 (negative 0) are preserved.
- 17 **timestamp** - 64-bit little-endian MongoDB timestamp, the high 32 bits being
     the seconds since the epoch, the low 32 a sequence number
- 18 **long** - 64-bit little-endian signed integer
- 19 **float128** - ieee 754 128-bit little-endian floating point
- 255 **MinKey** - MongoDB value that compares less than any other value
- 127 **MaxKey** - MongoDB value that compares greater than any other value


Helper Classes
--------------

Some BSON entities are decoded into qbson-specific objects.  These objects have no intrinsic
methods other than their constructor,

### qbson.ObjectId( )

BSON binary object id.  Can be constructed from a 24-char hex string, a 12-char binary
string, or a buffer.  If constructed without an argument, eg `new qbson.ObjectId()`, it
will create a new id unique to this process.

### qbson.Long( hi, lo )

64-bit integer value.  Its `toValue` method returns its contents as a native 53-bit
javascript number.

### qbson.Timestamp( hi, lo )

BSON timestamp.  The high word is a 32-bit epoch timestamp (seconds elapsed since 1970-01-01 UTC),
the low word a sequence number.

### qbson.DbRef( refname, oid )

Deprecated database reference, consisting of a resource name `$ref` and an ObjectId `$id`.

### qbson.MinKey( )

A MongoDB entity that is guaranteed to sort before any other entity.

### qbson.MaxKey( )

A MongoDB entity that is guaranteed to sort after every other entity.


Benchmarks
----------

Relative speed serializing and deserializing the data to and from BSON (or msgpack, or JSON.
Includes JSON.stringify and q-msgpack timings for comparison.)  These are _rates_, higher is
better.

Used to be that the native JSON serialization was head and shoulders above the any
user-space converter, but no longer.  In fact, most conversions outperform JSON.  Maybe it's
time to revisit `json-simple`.

To run the benchmarks (or tests), check out the repo from github.

- bson 4.0.2 - latest official bson library (requires node-v6 or newer)
- buffalo 0.1.3 - old abandoned experiment
- q-msgpack 0.1.0 (qmp) - experimental msgpack encoder (no decode)
- qbson 0.1.0 - this package (works with older node, eg v0.8)
- json 11.8.0 - nodejs builtin
- json-simple 0.10.0 (jss) - simplified js-only json coder

All timings used:
qtimeit=0.21.0 node=11.8.0 v8=7.0.276.38-node.16 platform=linux kernel=4.9.0-0.bpo.4-amd64 up_threshold=false
arch=ia32 mhz=4184 cpuCount=8 cpu="Intel(R) Core(TM) i7-6700K CPU @ 4.00GHz"

Encoding.

| data                    | bson | buffalo | qmp | qbson | json | jss |
|-------------------------|------|--------:|---:|------:|-----:|-----:|
| {"a":1234}                                                     | 100 | 121 | 142 | 368 | 125 | 215 |
| {"a":1234.5}                                                   | 100 | 116 | 164 | 454 | 112 | 242 |
| {"a":[1,2,3,4,5]}                                              | 100 |  87 | 248 | 366 | 226 | 253 |
| {"a":{"a":1,"b":2,"c":3,"d":4,"e":5}}                          | 100 | 103 | 188 | 541 | 172 | 211 |
| {"a":[1,[2,[3,[4,[5]]]]]}                                      | 100 |  84 | 256 | 412 | 229 | 333 |
| {"a":{"a":{"b":{"c":{"d":{"e":5}}}}}}                          | 100 | 131 | 208 | 438 | 194 | 292 |
| {"a":{"a":"ABC","b":1,"c":"DEFGHI\xff","d":1234.567,"e":null}} | 100 |  94 | 225 | 370 | 173 | 207 |


Decoding.

| data                    | bson | buffalo | qmp | qbson | json | jss |
|-------------------------|------|--------:|----:|------:|-----:|----:|
| {"a":1234}                                                     | 100 | 136 | - | 421 |  61 | 132 |
| {"a":1234.5}                                                   | 100 | 130 | - | 504 |  40 |  85 |
| {"a":[1,2,3,4,5]}                                              | 100 |  65 | - | 196 | 123 | 258 |
| {"a":{"a":1,"b":2,"c":3,"d":4,"e":5}}                          | 100 | 124 | - | 489 | 131 | 184 |
| {"a":[1,[2,[3,[4,[5]]]]]}                                      | 100 |  89 | - | 505 | 151 | 453 |
| {"a":{"a":{"b":{"c":{"d":{"e":5}}}}}}                          | 100 | 130 | - | 415 |  86 | 240 |
| {"a":{"a":"ABC","b":1,"c":"DEFGHI\xff","d":1234.567,"e":null}} | 100 | 123 | - | 358 | 132 | 180 |


The above results are not directly comparable to the old results (those were run singly, these
as a group).


Change Log
----------

- 0.1.1 - new README
- 0.1.0 - cleanups, bug fixes, 100% test coverage
- 0.0.12 - use q-utf8 and ieee-float for conversions
- 0.0.8 - fix decode Long
- 0.0.7 - encode complete
- qmongo-0.3.0 - qmongo with batching and cursor
- 0.0.6 - decode complete, qmongo working
- 0.0.5 - more timings, encode functions and symbols, json-decoder, encodeJson, ObjectId
- 0.0.4 - utf8 functions complete and fully under test
- 0.0.3 - cleanups, refactored, timings
- 0.0.2 - encoder
- 0.0.1 - decoder


Related Work
------------

- [`bson`](https://github.com/mongodb/js-bson) - the "official" mongodb BSON driver
- [`buffalo`](https://github.com/marcello3d/node-buffalo) - alternate js-only implementation, no longer maintained
- [`q-msgpack`](https://github.com/andrasq/node-q-msgpack) - experimental msgpack encoder
- [`json-simple`](https://github.com/andrasq/node-json-simple) - simplified experimental js-only json encoder
