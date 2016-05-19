qbson
=====

This repo contains some experimental code for BSON conversions.

I was primarily interested in the speed difference between a hand-rolled bson
decoder and the native C++ [bson](https://npmjs.org/bson) library.  Most of this
decoder was originally in [`json-simple`](https://github.com/andrasq/node-json-simple),
the encoder is new.

The hand-rolled decoder is slightly faster than the native C++ module to convert
most atomic types, but is 6x (!) faster decoding arrays.  The encoder is overall
much faster, 2x to 6x faster on primitives and as much as 12x faster on compound
data.  Timed with node-v5.10.1 on an 3.5GHz AMD Phenom II X4.


encode
------

Encoding rates for an object with 10 fields (field names 25 ascii chars long;
5-char field names boost qbson throughput 25-50%), each field containing the same
data.  Includes JSON.stringify timings for comparison.

| data               | bson | buffalo | qbson | json |
|-------------------------|-----|-----|------|------|
| `1234`                  | 100 | 175 |  240 |  375 |
| `1234.5`                | 100 | 135 |  239 |  234 |
| `"some \xfftf8 Text"`   | 100 | 111 |  196 |  365 |
| <250 chrs, 20% 2b utf8> | 100 |  97 |  115 |  111 |
| `{}`                    | 100 | 400 |  480 |  605 |
| `/fo[o]/i`              | 100 | 189 |  450 |  434 |
| `[1,2,3,4,5]`           | 100 | 210 |  702 | 1051 |
| `{a:1,b:2,c:3,d:4,e:5}` | 100 | 250 |  780 |  810 |
| `[1,[2,[3,[4,[5]]]]]`   | 100 | 176 | 1200 |  958 |
| `{a:{b:{c:{d:{e:5}}}}}` | 100 | 172 |  191 | 1130 |
| `ObjectId()`            | 100 |  74 |  215 |    x |
| {a: "ABC", b: 1, c: "DEFGHI\xff", d: 12345.67e-1, e: null} | 100 | 190 | 650 | 690 |


decode
------

As above, but decoding.

Yes, JSON can be up to 140x faster than BSON.

| data               | bson | buffalo | qbson | json |
|-------------------------|-----|-----|------|-------|
| `1234`                  | 100 | 100 |  109 | 10000 |
| `1234.5`                | 100 |  99 |  104 |  4060 |
| `"some \xfftf8 Text"`   | 100 | 101 |   99 |  6760 |
| <250 chrs, 20% 2b utf8> | 100 | 100 |  104 |  3330 |
| `{}`                    | 100 |  78 |  110 |  3770 |
| `/fo[o]/i`              | 100 | 108 |  125 |     x |
| `[1,2,3,4,5]`           | 100 | 105 |  650 | 14280 |
| `{a:1,b:2,c:3,d:4,e:5}` | 100 |  87 |  180 |  1720 |
| `[1,[2,[3,[4,[5]]]]]`   | 100 | 118 | 1160 | 12700 |
| `{a:{b:{c:{d:{e:5}}}}}` | 100 |  62 |  182 |  1160 |
| `ObjectId()`            | 100 |  65 |  125 |     x |
| {a: "ABC", b: 1, c: "DEFGHI\xff", d: 12345.67e-1, e: null} | 100 |  91 | 184 | 1760 |

utf8
----

### encodeUtf8( string, from, to, buffer, offset )

encode the substring between `from` and `to` as utf8 bytes into the buffer starting
at offset, and return the number of bytes written.  Does not check for overflow.
The converted bytes are identical to `buffer.write`.  Does not use `string.slice`
or `buffer.write`.

### decodeUtf8( buffer, offset, limit )

return the utf8 encoded string in the buffer between offset and limit.  Traverses
the buffer, does not use `buffer.toString`.  Note: for non-trivial strings
buffer.toString() is faster.

### stringLength( buffer, offset, limit, [encoding] )

return the length of the utf8 encoded string found in the buffer between offset and
limit.  The string is presumed valid utf8 and is not tested for validity.  Examines
the buffer, does not use `buffer.toString`.

### byteLength( string, from, to )

return the number of bytes needed to store the specified portion of the string.
Examines the string, does not use `Buffer.byteLength`.


Change Log
----------

- 0.0.5 - more timings, encode functions and symbols, json-decoder, encodeJson, ObjectId
- 0.0.4 - utf8 functions complete and fully under test
- 0.0.3 - cleanups, refactored, timings
- 0.0.2 - encoder
- 0.0.1 - decoder

Related Work
------------

- [`bson`](https://github.com/mongodb/js-bson) - the "official" mongodb BSON driver
- [`buffalo`](https://github.com/marcello3d/node-buffalo) - alternate js-only implementation, no longer maintained
