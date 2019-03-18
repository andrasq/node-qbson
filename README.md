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


Benchmarks
----------

Relative speed serializing and deserializing the data to and from BSON (or msgpack, or JSON.
Includes JSON.stringify and q-msgpack timings for included for comparison.)  These are
_rates_, higher is better.

Used to be that the native JSON serialization was head and shoulders above the any
user-space converter, but no longer.  In fact, most conversions outperform JSON.  Maybe it's
time to revisit `json-simple`.

To run the benchmarks (or tests), check out the repo from github.

- bson 4.0.2 - latest official bson library
- buffalo 0.1.3 - old abandoned experiment
- q-msgpack 0.1.0 - experimental msgpack encoder (no decode)
- qbson 0.1.0 - this package
- json 11.8.0 - nodejs builtin

Encoding.

| data                    | bson | buffalo | q-msgpack | qbson | json |
|-------------------------|------|--------:|----------:|------:|-----:|
| {"a":1234}                                                     | 100 |  65 | 142 | 486 | 125 |
| {"a":1234.5}                                                   | 100 |  80 | 178 | 557 | 116 |
| {"a":[1,2,3,4,5]}                                              | 100 |  46 | 261 | 391 | 236 |
| {"a":{"a":1,"b":2,"c":3,"d":4,"e":5}}                          | 100 |  60 | 201 | 617 | 182 |
| {"a":[1,[2,[3,[4,[5]]]]]}                                      | 100 |  47 | 290 | 430 | 228 |
| {"a":{"a":{"b":{"c":{"d":{"e":5}}}}}}                          | 100 |  71 | 208 | 455 | 183 |
| {"a":{"a":"ABC","b":1,"c":"DEFGHI\xff","d":1234.567,"e":null}} | 100 |  63 | 213 | 388 | 176 |

Decoding.

| data                    | bson | buffalo | q-msgpack | qbson | json |
|-------------------------|------|--------:|----------:|------:|-----:|
| {"a":1234}                                                     | 100 | 130 | - | 438 | 189 |
| {"a":1234.5}                                                   | 100 | 118 | - | 545 |  24 |
| {"a":[1,2,3,4,5]}                                              | 100 |  65 | - | 205 |  79 |
| {"a":{"a":1,"b":2,"c":3,"d":4,"e":5}}                          | 100 | 125 | - | 546 |  92 |
| {"a":[1,[2,[3,[4,[5]]]]]}                                      | 100 |  92 | - | 582 | 117 |
| {"a":{"a":{"b":{"c":{"d":{"e":5}}}}}}                          | 100 | 128 | - | 449 |  68 |
| {"a":{"a":"ABC","b":1,"c":"DEFGHI\xff","d":1234.567,"e":null}} | 100 | 122 | - | 383 |  58 |


To compare, here are the old timings, done with node-v5.10.1 on an 3.5GHz AMD Phenom II X4.
Timings with node-v0.10.42 can be remarkably different, so beware your node version.

User code used to run much slower than now, and the native JSON twice as fast, giving the
built-in JSON convesion a huge speed advantage.

- bson 0.3.2 (?)
- buffalo 0.1.3
- qbson 0.0.3 - early version of this code
- json 5.10.1 - nodejs builtin

Encode.

| data                    | bson | buffalo | qbson | json |
|-------------------------|------|--------:|------:|-----:|
| `1234`                  | 100 | 175 |  240 |  375 |
| `1234.5`                | 100 | 135 |  239 |  234 |
| `[1,2,3,4,5]`           | 100 | 210 |  702 | 1051 |
| `{a:1,b:2,c:3,d:4,e:5}` | 100 | 250 |  780 |  810 |
| `[1,[2,[3,[4,[5]]]]]`   | 100 | 176 | 1200 |  958 |
| `{a:{b:{c:{d:{e:5}}}}}` | 100 | 172 | 1275 | 1130 |
| `{a: "ABC", b: 1, c: "DEFGHI\xff", d: 12345.67e-1, e: null}` | 100 | 190 | 650 | 675 |

Decode.

| data               | bson | buffalo | qbson | json |
|-------------------------|-----|----:|-----:|------:|
| `1234`                  | 100 | 100 |  109 | 10000 |
| `1234.5`                | 100 | 100 |  113 |  4115 |
| `[1,2,3,4,5]`           | 100 | 105 |  650 | 14280 |
| `{a:1,b:2,c:3,d:4,e:5}` | 100 |  87 |  180 |  1720 |
| `[1,[2,[3,[4,[5]]]]]`   | 100 | 118 | 1160 | 12700 |
| `{a:{b:{c:{d:{e:5}}}}}` | 100 |  62 |  182 |  1160 |
| `{a: "ABC", b: 1, c: "DEFGHI\xff", d: 12345.67e-1, e: null}` | 100 |  91 | 190 | 3000 |


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
