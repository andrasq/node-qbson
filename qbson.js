/**
 * bson functions
 *
 * Copyright (C) 2016 Andras Radics
 * Licensed under the Apache License, Version 2.0
 *
 * 2016-05-06 - AR.
 */

'use strict';

var decode = require('./decode.js');

module.exports = {
    encode: null,
    decode: decode,
    toJSON: null,
};

var utf8 = require('./utf8.js');

// work in progress
