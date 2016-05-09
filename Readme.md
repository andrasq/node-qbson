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


Related Work
------------

- [`bson`](https://github.com/mongodb/js-bson) - the "official" mongodb BSON driver
- [`buffalo`](https://github.com/marcello3d/node-buffalo) - alternate js-only implementation, no longer maintained
