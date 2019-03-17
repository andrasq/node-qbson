'use strict';

var nodeMajor = parseInt(process.versions.node);

// polyfills to make work with both old and new node
module.exports = {
    new: eval('nodeMajor < 10 ? Buffer : function(a, b, c) { return typeof(a) === "number" ? Buffer.allocUnsafe(a) : Buffer.from(a, b, c) }'),
    alloc: eval('nodeMajor >= 6 ? Buffer.allocUnsafe : Buffer'),
    from: eval('nodeMajor >= 6 ? Buffer.from : Buffer'),
};
