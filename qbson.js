/**
 * bson functions
 *
 * Copyright (C) 2016 Andras Radics
 * Licensed under the Apache License, Version 2.0
 *
 * 2016-05-06 - AR.
 */

'use strict';

var bsonTypes = require('./lib/bson-types.js');

module.exports = {
    encode: require('./lib/encode.js'),
    decode: require('./lib/decode.js'),

    ObjectId: bsonTypes.ObjectId,
    DbRef: bsonTypes.DbRef,
    Timestamp: bsonTypes.Timestamp,
    Long: bsonTypes.Long,
    Decimal128: bsonTypes.Decimal128,
    MinKey: bsonTypes.MinKey,
    MaxKey: bsonTypes.MaxKey,
};
