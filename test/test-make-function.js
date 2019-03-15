'use strict';

var assert = require('assert');
var makeFunction = require('../make-function');

var src = 'function tt() { return 1 }';
assert.ok(typeof makeFunction(src), 'function');
// older node insert a space between 'function' and '()', newer do not.  Name the function to avoid the issue.
assert.equal(makeFunction(src).toString(), 'function tt() { return 1 }');
assert.strictEqual(makeFunction(src)(), 1);

var src = 'function tt() { return a + b }';
var scope = { a: 1, b: '2' };
assert.ok(typeof makeFunction(src, scope), 'function');
assert.equal(makeFunction(src, scope).toString(), 'function tt() { return a + b }');
assert.strictEqual(makeFunction(src, scope)(), '12');

assert.ok(makeFunction() instanceof Error);
assert.ok(makeFunction('1 2 3') instanceof Error);
