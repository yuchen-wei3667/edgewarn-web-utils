/**
 * Builds tiny GRIB2 messages with simple packing (5.0), for decoder tests that need exact control over values,
 * NaNs and grid size: on the HRRR Lambert conformal grid template (3.30) or on a regular lat/lon grid (3.0).
 */

const be = (n, bytes) => { const b = Buffer.alloc(bytes); b.writeUIntBE(n >>> 0, 0, bytes); return b; };
const sm32 = (v) => be(v < 0 ? (-v | 0x80000000) >>> 0 : v, 4);
const section = (num, body) => Buffer.concat([be(body.length + 5, 4), Buffer.from([num]), body]);

/** Section 3 shared fields: shape of the earth (octets 15-20) and the point count. */
function earth(s3body, shape, radius) {
    s3body[9] = shape;
    if (shape === 1) {
        s3body[10] = 0;
        s3body.writeUInt32BE(radius, 11);
    }
}

/** Everything but section 3: sections 1, 4, 5, 6 (bitmap when a value is NaN) and 7, framed by sections 0 and 8. */
function assemble(s3, values, { decimal, nbits }) {
    const present = values.map((v) => !Number.isNaN(v));
    const hasBitmap = present.some((p) => !p);
    const packed = values.filter((_, k) => present[k]).map((v) => Math.round(v * 10 ** decimal));

    const s1 = section(1, Buffer.alloc(16));
    const s4 = section(4, Buffer.alloc(29));

    const s5body = Buffer.alloc(16);
    s5body.writeUInt32BE(packed.length, 0);
    s5body.writeUInt16BE(0, 4);
    s5body.writeFloatBE(0, 6);
    s5body.writeUInt16BE(0, 10);
    s5body.writeUInt16BE(decimal, 12);
    s5body[14] = nbits;
    const s5 = section(5, s5body);

    const bm = Buffer.alloc(Math.ceil(values.length / 8));
    present.forEach((p, k) => { if (p) bm[k >> 3] |= 0x80 >> (k & 7); });
    const s6 = section(6, hasBitmap ? Buffer.concat([Buffer.from([0]), bm]) : Buffer.from([255]));

    const data = Buffer.alloc(Math.ceil(packed.length * nbits / 8));
    let bit = 0;
    for (const v of packed) {
        for (let b = nbits - 1; b >= 0; b--, bit++) if ((v >>> b) & 1) data[bit >> 3] |= 0x80 >> (bit & 7);
    }
    const s7 = section(7, data);

    const body = Buffer.concat([s1, s3, s4, s5, s6, s7, Buffer.from('7777')]);
    const s0 = Buffer.alloc(16);
    s0.write('GRIB', 0);
    s0[7] = 2;
    s0.writeUInt32BE(body.length + 16, 12);
    return new Uint8Array(Buffer.concat([s0, body]));
}

/**
 * values: numbers in scan order (row 0 south), NaN for absent points (a bitmap is written if any).
 * Values are stored as integers: R = 0, E = 0, D = `decimal` (so value * 10^decimal must be integral).
 * `scanMode` is written as is (0x50: the caller supplies the odd rows already reversed). `shape` is the
 * GRIB shape-of-earth code (6 = HRRR's 6 371 229 m sphere; 1 writes `radius` as an explicit scaled value).
 */
export function buildLambertGrib(values, nx, ny, { decimal = 0, nbits = 16, grid = {}, scanMode = 0x40, shape = 6, radius = 6371200, resolutionFlags = 0 } = {}) {
    const g = { lat1: 21.138123, lon1: 237.280472, lov: 262.5, latin1: 38.5, latin2: 38.5, dx: 3000, dy: 3000, ...grid };
    const s3body = Buffer.alloc(76);
    s3body.writeUInt16BE(30, 7); // template at section offset 12
    earth(s3body, shape, radius);
    s3body.writeUInt32BE(nx, 25);
    s3body.writeUInt32BE(ny, 29);
    sm32(Math.round(g.lat1 * 1e6)).copy(s3body, 33);
    be(Math.round(g.lon1 * 1e6), 4).copy(s3body, 37);
    be(Math.round(g.lov * 1e6), 4).copy(s3body, 46);
    s3body[49] = resolutionFlags; // octet 55
    be(Math.round(g.dx * 1e3), 4).copy(s3body, 50);
    be(Math.round(g.dy * 1e3), 4).copy(s3body, 54);
    s3body[59] = scanMode;
    sm32(Math.round(g.latin1 * 1e6)).copy(s3body, 60);
    sm32(Math.round(g.latin2 * 1e6)).copy(s3body, 64);
    return assemble(section(3, s3body), values, { decimal, nbits });
}

/**
 * A regular lat/lon grid (template 3.0): `values` in scan order, with `scanMode` 0x00 (row 0 is the northernmost,
 * `lat1`) or 0x40 (row 0 is the southernmost). Defaults are GFS's 0.25 degree layout cut down to a few cells.
 * `last` overrides the stated last point (La2, Lo2), to build a grid whose extent disagrees with its increments;
 * `basicAngle` is written to octets 39-42.
 */
export function buildLatLonGrib(values, nx, ny, { decimal = 0, nbits = 16, grid = {}, scanMode = 0x00, shape = 6, radius = 6371200, resolutionFlags = 0, last = null, basicAngle = 0 } = {}) {
    const g = { lat1: 90, lon1: 0, dlat: 0.25, dlon: 0.25, ...grid };
    const sign = scanMode === 0x00 ? -1 : 1;
    const lat2 = last?.lat ?? g.lat1 + sign * (ny - 1) * g.dlat;
    const lon2 = last?.lon ?? (g.lon1 + (nx - 1) * g.dlon) % 360;
    // A grid with a `rotation` is template 3.1: the 3.0 layout, then the southern pole (octets 73-80) and a zero angle of rotation (octets 81-84).
    const s3body = Buffer.alloc(g.rotation ? 79 : 67);
    s3body.writeUInt16BE(g.rotation ? 1 : 0, 7); // template 3.0 or 3.1 at section offset 12
    if (g.rotation) {
        sm32(Math.round(g.rotation.southPoleLat * 1e6)).copy(s3body, 67); // octets 73-76
        be(Math.round(g.rotation.southPoleLon * 1e6), 4).copy(s3body, 71); // octets 77-80
    }
    earth(s3body, shape, radius);
    s3body.writeUInt32BE(nx, 25);
    s3body.writeUInt32BE(ny, 29);
    s3body.writeUInt32BE(basicAngle, 33); // octets 39-42
    s3body.writeUInt32BE(0xffffffff, 37); // octets 43-46: subdivisions missing
    sm32(Math.round(g.lat1 * 1e6)).copy(s3body, 41); // octets 47-50
    be(Math.round(g.lon1 * 1e6), 4).copy(s3body, 45); // octets 51-54
    s3body[49] = resolutionFlags; // octet 55
    sm32(Math.round(lat2 * 1e6)).copy(s3body, 50); // octets 56-59
    be(Math.round(lon2 * 1e6), 4).copy(s3body, 54); // octets 60-63
    be(Math.round(g.dlon * 1e6), 4).copy(s3body, 58); // Di, octets 64-67
    be(Math.round(g.dlat * 1e6), 4).copy(s3body, 62); // Dj, octets 68-71
    s3body[66] = scanMode; // octet 72
    return assemble(section(3, s3body), values, { decimal, nbits });
}

/** A north polar stereographic grid (template 3.20), defaults cut down from HRRR Alaska's. `scanMode` is written as is. */
export function buildPolarStereoGrib(values, nx, ny, { decimal = 0, nbits = 16, grid = {}, scanMode = 0x40, shape = 6, radius = 6371200, resolutionFlags = 0 } = {}) {
    const g = { lat1: 41.612949, lon1: 185.117126, lov: 225, latD: 60, dx: 3000, dy: 3000, ...grid };
    const s3body = Buffer.alloc(60);
    s3body.writeUInt16BE(20, 7); // template at section offset 12
    earth(s3body, shape, radius);
    s3body.writeUInt32BE(nx, 25);
    s3body.writeUInt32BE(ny, 29);
    sm32(Math.round(g.lat1 * 1e6)).copy(s3body, 33);
    be(Math.round(g.lon1 * 1e6), 4).copy(s3body, 37);
    s3body[41] = resolutionFlags; // octet 47
    sm32(Math.round(g.latD * 1e6)).copy(s3body, 42);
    be(Math.round(g.lov * 1e6), 4).copy(s3body, 46);
    be(Math.round(g.dx * 1e3), 4).copy(s3body, 50);
    be(Math.round(g.dy * 1e3), 4).copy(s3body, 54);
    s3body[58] = 0; // octet 64: north pole on the plane
    s3body[59] = scanMode; // octet 65
    return assemble(section(3, s3body), values, { decimal, nbits });
}

/** A Mercator grid (template 3.10), defaults cut down from NBM Hawaii's. The last point and orientation are not read, so they stay zero. */
export function buildMercatorGrib(values, nx, ny, { decimal = 0, nbits = 16, grid = {}, scanMode = 0x50, shape = 6, radius = 6371200, resolutionFlags = 0 } = {}) {
    const g = { lat1: 14.3515, lon1: 195.0305, latD: 20, dx: 2500, dy: 2500, ...grid };
    const s3body = Buffer.alloc(67);
    s3body.writeUInt16BE(10, 7); // template at section offset 12
    earth(s3body, shape, radius);
    s3body.writeUInt32BE(nx, 25);
    s3body.writeUInt32BE(ny, 29);
    sm32(Math.round(g.lat1 * 1e6)).copy(s3body, 33);
    be(Math.round(g.lon1 * 1e6), 4).copy(s3body, 37);
    s3body[41] = resolutionFlags; // octet 47
    sm32(Math.round(g.latD * 1e6)).copy(s3body, 42);
    s3body[54] = scanMode; // octet 60
    be(Math.round(g.dx * 1e3), 4).copy(s3body, 59); // Di, octets 65-68
    be(Math.round(g.dy * 1e3), 4).copy(s3body, 63); // Dj, octets 69-72
    return assemble(section(3, s3body), values, { decimal, nbits });
}
