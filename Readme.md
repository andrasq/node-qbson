qbson
=====

This repo contains some experimental code for BSON conversions.

I was primarily interested in the speed difference between a hand-rolled bson
decoder and the native C++ [bson](https://npmjs.org/bson) library.  Most of this
decoder was originally in [`json-simple`](https://github.com/andrasq/node-json-simple),
the encoder is new.

The hand-rolled decoder is slightly faster than the native C++ module to convert
most atomic types, but is 6x (!) faster decoding arrays.  The encoder is overall
much faster, 60% to 6x faster on primitives and as much as 7x to 11x faster on
compound data.  Timed on an 3.5GHz AMD Phenom II X4.


Encoding an object with 10 fields (field names 25 ascii chars long; 5-char field
names boost qbson throughput 25-50%), each field containing the same data:

| data                    | bson | buffalo | qbson |
|-------------------------|-----|-----|-----|
| `1234`                  | 100 | 165 | 225 |
| `1234.5`                | 100 | 135 | 225 |
| `{}`                    | 100 | 400 | 480 |
| `/fo[o]/i`              | 100 | 189 | 450 |
| `[1,2,3,4,5]`           | 100 | 210 | 702 |
| `{a:1,b:2,c:3,d:4,e:5}` | 100 | 250 | 780 |
| `[1,[2,[3,[4,[5]]]]]`   | 100 | 176 | 1200 |
| `{a:{b:{c:{d:{e:5}}}}}` | 100 | 172 | 191 |


Change Log
----------

- 0.0.3 - cleanups, refactored, timings
- 0.0.2 - encoder
- 0.0.1 - decoder

Related Work
------------

- [`bson`](https://github.com/mongodb/js-bson) - the "official" mongodb BSON driver
- [`buffalo`](https://github.com/marcello3d/node-buffalo) - alternate js-only implementation, no longer maintained
