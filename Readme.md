qbson
=====

This repo contains some experimental code for BSON conversions.

I was primarily interested in the speed difference between a hand-rolled bson
decoder and the official [bson](https://npmjs.org/bson) library.  Most of this
code first showed up in [`json-simple`](https://github.com/andrasq/node-json-simple)

For the curious, the hand-rolled decoder is slightly faster than the native C++
module to convert most atomic types, but is 2x faster decoding objects and 7x (!)
faster decoding arrays.  Timings on an 3.5GHz AMD Phenom II X4.


Related Work
------------

- [`bson`](https://github.com/mongodb/js-bson) - the "official" mongodb BSON driver
- [`buffalo`](https://github.com/marcello3d/node-buffalo) - alternate js-only implementation, no longer maintained
