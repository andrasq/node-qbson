'use strict';

var assert = require('assert');

var qbson = require('../');
var types = require('../bson-types');

assert.equal(types.typeIds.T_FLOAT, 1);
assert.equal(types.typeInfo[1].id, 1);

var long = new qbson.Long()
function checkLong(i) {
    var l = qbson.Long.fromNumber(i);
    assert.equal(l.valueOf(), i);
}
for (var i=0; i<1e5; i++) checkLong(i);
for (var i=0; i>-1e5; i--) checkLong(i);
for (var i = 0; i < 1e12; i += Math.floor(Math.random() * 1e6)) checkLong(i);
for (var i = 0; i > -1e12; i -= Math.floor(Math.random() * 1e6)) checkLong(i);