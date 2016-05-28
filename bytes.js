/**
 * read and write data to/from byte arrays.
 *
 * 2016-05-27 - AR.
 */

module.exports = {
    getInt32: getInt32,
    getInt32LE: getInt32,
    getUInt32: getUInt32,
    getUInt32LE: getUInt32,

    putInt32: putInt32,
    putInt32LE: putInt32,
    putUInt32: putInt32,
    putUInt32LE: putInt32,
};

function getUInt32( buf, pos ) {
    return getInt32(buf, pos) >>> 0;    // coerced to unsigned
}

function getInt32( buf, pos ) {
    return buf[pos] +
        (buf[pos+1] << 8) +
        (buf[pos+2] << 16) +
        (buf[pos+3] << 24);             // yes shift into the sign bit, coerce to signed
}

function putInt32( n, target, offset ) {
    target[offset++] = n & 0xFF;
    target[offset++] = (n >> 8) & 0xFF;
    target[offset++] = (n >> 16) & 0xFF;
    target[offset++] = (n >> 24) & 0xFF;
    return offset;
}
