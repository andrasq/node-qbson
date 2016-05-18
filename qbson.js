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
var ObjectId = require('./object-id.js');

module.exports = {
    encode: encode,
    decode: decode,
    toJson: null,
    ObjectId: ObjectId,
    ObjectID: ObjectId,
};

var utf8 = require('./utf8.js');

// work in progress
