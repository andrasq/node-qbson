/*
 * shim to unify the apis of the various incarnations of the bson package
 */

var bson = require('bson-v0.3.2');
var bson = require('bson-v0.4.23');             // 15% faster than bson3
var bson = require('bson-v0.5.7');              // 11% faster than bson3
var bson = require('bson-v1.0.4');              // 11% faster than bson3

var ObjectID, serialize, deserialize;

if (typeof bson == 'function') {
    ObjectID = bson.ObjectID;
    serialize = new bson().serialize;
    deserialize = new bson().deserialize;
}
else if (typeof bson.BSONPure.BSON == 'function') {
    var obj = new bson.BSONPure.BSON()
    ObjectID = bson.ObjectID;
    serialize = function(o) { return obj.serialize(o) };
    deserialize = function(b) { return obj.deserialize(b) };
}
else {
    ObjectID = bson.ObjectID;
    serialize = bson.BSONPure.BSON.serialize;
    deserialize = bson.BSONPure.BSON.deserialize;
}

module.exports = {
    ObjectID: ObjectID,
    serialize: serialize,
    deserialize: deserialize,
};

//console.log("AR:", module.exports.ObjectID())
//console.log("AR:", module.exports.serialize({a:1}))
//console.log("AR:", module.exports.deserialize(module.exports.serialize({a:1})))
