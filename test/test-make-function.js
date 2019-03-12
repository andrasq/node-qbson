'use strict';

var assert = require('assert');
var makeFunction = require('../make-function');

var src = 'function() { return 1 }';
assert.ok(typeof makeFunction(src), 'function');
assert.equal(makeFunction(src).toString(), 'function () { return 1 }'); // note the inserted space before ()
assert.strictEqual(makeFunction(src)(), 1);

var src = 'function() { return a + b }';
var scope = { a: 1, b: '2' };
assert.ok(typeof makeFunction(src, scope), 'function');
assert.equal(makeFunction(src, scope).toString(), 'function () { return a + b }'); // note the inserted space before ()
assert.strictEqual(makeFunction(src, scope)(), '12');

assert.ok(makeFunction() instanceof Error);
assert.ok(makeFunction('1 2 3') instanceof Error);
