/**
 * bson functions
 *
 * Copyright (C) 2016 Andras Radics
 * Licensed under the Apache License, Version 2.0
 *
 * 2016-05-06 - AR.
 */

'use strict';

var encode = require('./encode.js');
var decode = require('./decode.js');
var bsonTypes = require('./bson-types.js');

module.exports = {
    encode: encode,
    decode: decode,

    ObjectId: bsonTypes.ObjectId,
    ObjectID: bsonTypes.ObjectId,
    DbRef: bsonTypes.DbRef,
    ScopedFunction: bsonTypes.ScopedFunction,
    Timestamp: bsonTypes.Timestamp,
    Long: bsonTypes.Long,
    Float128: bsonTypes.Float128,
    MinKey: bsonTypes.MinKey,
    MaxKey: bsonTypes.MaxKey,
};
