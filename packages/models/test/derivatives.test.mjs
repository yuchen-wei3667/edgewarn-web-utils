import test from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_CONFIGS } from '../dist/configs/index.js';
import { derivativeSpan, gradient, gridMetrics } from '../dist/derivatives.js';
import { combineInputs } from '../dist/recipes.js';
import { fromHalf, HALF_NAN, toHalf } from '@edgewarn/web-utils/grib2';
import { projectionFor } from '../dist/projection/index.js';
import { validateConfigs } from '../dist/registry/validate.js';
import { ehi, stpFixed } from '@edgewarn/web-utils/met';
import { thetaK } from '@edgewarn/web-utils/met';

/**
 * The diagnostic fields' maths against closed forms (phase 5.9): a derivative of a field that is linear in a coordinate
 * is its slope, on a lat/lon grid and on a turned Lambert grid; advection of a uniform gradient by a uniform wind and
 * Petterssen frontogenesis of a pure deformation are known; the composites are the sounding page's own functions.
 */

const R = 6371229;
const D2R = Math.PI / 180;
const METRES_PER_DEGREE = R * D2R;

/** A regional lat/lon grid (28 km cells): 40.25 N at the top, rows south to north. */
const REGION = { projection: 'latlon', nx: 60, ny: 41, lat1: 30, lon1: -100, dlat: 0.25, dlon: 0.25, scanMode: 0x40, radiusM: R };
/** A whole-globe 1 degree grid, columns closing around. */
const GLOBE = { projection: 'latlon', nx: 360, ny: 181, lat1: -90, lon1: -180, dlat: 1, dlon: 1, scanMode: 0x40, radiusM: R };
/** HRRR's Lambert grid shrunk to 120 x 80 cells in the same place (the rotation spans about +-15 degrees across the real one). */
const LAMBERT = {
    projection: 'lambert', nx: 120, ny: 80, lat1: 34, lon1: 255, lov: 262.5, latin1: 38.5, latin2: 38.5, dx: 3000, dy: 3000, scanMode: 0x40, radiusM: R,
};

const cells = (proj, f) => {
    const out = new Float32Array(proj.nx * proj.ny);
    for (let j = 0; j < proj.ny; j++) for (let i = 0; i < proj.nx; i++) { const [lat, lon] = proj.inverse(i, j); out[j * proj.nx + i] = f(lat, lon, i, j); }
    return out;
};
const level = (proj, values) => ({ level: 0, factor: 1, nx: proj.nx, ny: proj.ny, data: Uint16Array.from(values, (v) => (Number.isNaN(v) ? HALF_NAN : toHalf(v))) });
const read = (out) => Array.from(out.data, fromHalf);
const at = (proj, arr, i, j) => arr[j * proj.nx + i];
const close = (a, b, rel) => Math.abs(a - b) <= rel * Math.abs(b);

test('a gradient is the true slope per metre, east and north, on a lat/lon grid', () => {
    const proj = projectionFor(REGION);
    const m = gridMetrics(proj);
    assert.equal(m.span, 1, 'a 28 km cell is wider than the baseline');
    const g = gradient(cells(proj, (lat) => lat), m);
    const gl = gradient(cells(proj, (_lat, lon) => lon), m);
    const [lat] = proj.inverse(30, 20);
    assert.ok(close(at(proj, g.north, 30, 20), 1 / METRES_PER_DEGREE, 1e-4), `${at(proj, g.north, 30, 20)}`);
    assert.ok(Math.abs(at(proj, g.east, 30, 20)) < 1e-12);
    assert.ok(close(at(proj, gl.east, 30, 20), 1 / (METRES_PER_DEGREE * Math.cos(lat * D2R)), 1e-3), 'the east spacing narrows with latitude');
    assert.ok(Math.abs(at(proj, gl.north, 30, 20)) < 1e-12);
});

test('a grid scanned from the north (rows run southward) still gives northward derivatives', () => {
    const proj = projectionFor({ ...REGION, lat1: 50, scanMode: 0x00 });
    const [lat0] = proj.inverse(30, 20);
    const [lat1] = proj.inverse(30, 21);
    assert.ok(lat1 < lat0, 'row 21 is south of row 20');
    const g = gradient(cells(proj, (lat) => lat), gridMetrics(proj));
    assert.ok(close(at(proj, g.north, 30, 20), 1 / METRES_PER_DEGREE, 1e-4), `${at(proj, g.north, 30, 20)}`);
    const gl = gradient(cells(proj, (_lat, lon) => lon), gridMetrics(proj));
    assert.ok(close(at(proj, gl.east, 30, 20), 1 / (METRES_PER_DEGREE * Math.cos(lat0 * D2R)), 1e-3));
});

test('cells within the span of the edge have no derivative, and the interior is finite', () => {
    const proj = projectionFor(REGION);
    const g = gradient(cells(proj, (lat) => lat), gridMetrics(proj));
    for (const [i, j] of [[0, 20], [59, 20], [30, 0], [30, 40]]) assert.ok(Number.isNaN(at(proj, g.north, i, j)), `${i},${j}`);
    assert.ok(Number.isNaN(at(proj, g.east, 59, 1)) && Number.isNaN(at(proj, g.east, 1, 0)), 'the last column and the first row');
    assert.ok(Number.isFinite(at(proj, g.north, 1, 1)) && Number.isFinite(at(proj, g.east, 58, 39)));
});

test('a grid that closes around the globe wraps at the seam, and its poles have no derivative', () => {
    const proj = projectionFor(GLOBE);
    const m = gridMetrics(proj);
    assert.equal(m.periodic, true);
    const g = gradient(cells(proj, (_lat, lon) => Math.cos(lon * D2R)), m);
    for (const i of [0, 359]) {
        const [lat, lon] = proj.inverse(i, 120);
        const expected = -Math.sin(lon * D2R) / (R * Math.cos(lat * D2R));
        const got = at(proj, g.east, i, 120);
        assert.ok(Number.isFinite(got) && Math.abs(got - expected) < 2e-3 * Math.abs(1 / (R * Math.cos(lat * D2R))), `column ${i}: ${got} against ${expected}`);
    }
    assert.ok(Number.isNaN(at(proj, g.east, 100, 0)) && Number.isNaN(at(proj, g.north, 100, 180)), 'rows at the poles are NaN');
    assert.equal(projectionFor(REGION).kind, 'latlon');
    assert.equal(gridMetrics(projectionFor(REGION)).periodic, false);
});

test('on a turned Lambert grid the gradient still points east and north', () => {
    const proj = projectionFor(LAMBERT);
    const m = gridMetrics(proj);
    assert.equal(m.span, 2, 'the 12 km baseline over 3 km cells');
    const g = gradient(cells(proj, (lat) => lat), m);
    const gl = gradient(cells(proj, (_lat, lon) => lon), m);
    let checked = 0;
    for (const [i, j] of [[10, 10], [60, 40], [110, 70], [20, 60], [100, 15]]) {
        const [lat, lon] = proj.inverse(i, j);
        assert.ok(Math.abs(proj.rotation(lat, lon)) > 0 || i === 60, 'the grid is turned here');
        // d(lat)/d(north) and d(lon)/d(east) in degrees per metre; the finite difference over four 3 km cells bends a little.
        assert.ok(close(at(proj, g.north, i, j), 1 / METRES_PER_DEGREE, 5e-3), `${i},${j} north ${at(proj, g.north, i, j)}`);
        assert.ok(Math.abs(at(proj, g.east, i, j)) < 5e-3 / METRES_PER_DEGREE, `${i},${j} east ${at(proj, g.east, i, j)}`);
        assert.ok(close(at(proj, gl.east, i, j), 1 / (METRES_PER_DEGREE * Math.cos(lat * D2R)), 5e-3), `${i},${j} east of lon`);
        assert.ok(Math.abs(at(proj, gl.north, i, j)) < 5e-3 / (METRES_PER_DEGREE * Math.cos(lat * D2R)));
        checked++;
    }
    assert.equal(checked, 5);
});

test('the difference span follows the cell size', () => {
    assert.equal(derivativeSpan(projectionFor(LAMBERT)), 2);
    assert.equal(derivativeSpan(projectionFor(REGION)), 1);
    assert.equal(derivativeSpan(projectionFor(GLOBE)), 1);
});

test('advection of a uniform gradient by a uniform wind is minus their product, per hour', () => {
    const proj = projectionFor(REGION);
    // 1 degC per degree of latitude, northward wind of 10 m/s: air from the cold side, so cooling.
    const t = level(proj, cells(proj, (lat) => lat - 35));
    const u = level(proj, cells(proj, () => 0));
    const v = level(proj, cells(proj, () => 10));
    const out = read(combineInputs('advection', [t, u, v], proj, { frame: 'earth' }));
    const expected = -10 / METRES_PER_DEGREE * 3600;
    assert.ok(close(at(proj, out, 30, 20), expected, 0.01), `${at(proj, out, 30, 20)} against ${expected}`);
    assert.ok(Number.isNaN(at(proj, out, 0, 20)), 'the edge has no derivative');
    // The same wind from the east against a zonal gradient is warm advection where the air comes from the warm side.
    const tz = level(proj, cells(proj, (_lat, lon) => lon + 85));
    const east = read(combineInputs('advection', [tz, level(proj, cells(proj, () => -10)), u], proj, { frame: 'earth' }));
    const [lat] = proj.inverse(30, 20);
    assert.ok(close(at(proj, east, 30, 20), 10 / (METRES_PER_DEGREE * Math.cos(lat * D2R)) * 3600, 0.01));
});

test('grid-relative winds are turned to the earth before they advect', () => {
    const proj = projectionFor(LAMBERT);
    const t = level(proj, cells(proj, (lat) => lat - 36));
    // A 10 m/s wind toward the north, written in the grid's own axes: (gu, gv) = (-10 sin a, 10 cos a).
    const gu = cells(proj, (lat, lon) => -10 * Math.sin(proj.rotation(lat, lon)));
    const gv = cells(proj, (lat, lon) => 10 * Math.cos(proj.rotation(lat, lon)));
    const earth = read(combineInputs('advection', [t, level(proj, cells(proj, () => 0)), level(proj, cells(proj, () => 10))], proj, { frame: 'earth' }));
    const fromGrid = read(combineInputs('advection', [t, level(proj, gu), level(proj, gv)], proj, { frame: 'grid' }));
    for (const [i, j] of [[10, 10], [60, 40], [110, 70]]) {
        assert.ok(close(at(proj, fromGrid, i, j), at(proj, earth, i, j), 0.03), `${i},${j}: ${at(proj, fromGrid, i, j)} against ${at(proj, earth, i, j)}`);
    }
});

test('frontogenesis of a pure deformation is the gradient times the confluence, in K per 100 km per 3 h', () => {
    const proj = projectionFor(REGION);
    const G = 1 / METRES_PER_DEGREE; // degC per metre northward
    const D = 5e-5; // s^-1: v = -D y compresses the north-south gradient
    const lat0 = 40;
    const t = level(proj, cells(proj, (lat) => lat - lat0));
    const u = level(proj, cells(proj, (lat, lon) => D * (lon + 85) * METRES_PER_DEGREE * Math.cos(lat0 * D2R)));
    const v = level(proj, cells(proj, (lat) => -D * (lat - lat0) * METRES_PER_DEGREE));
    const out = read(combineInputs('frontogenesis', [t, u, v], proj, { frame: 'earth', levelHpa: 850 }));
    const thetaGradient = G * thetaK(850, 10) / (10 + 273.15); // d(theta)/dT at 850 mb
    const expected = thetaGradient * D * 1e5 * 10800;
    assert.ok(close(at(proj, out, 30, 20), expected, 0.03), `${at(proj, out, 30, 20)} against ${expected}`);
});

test('frontogenesis is zero where potential temperature is uniform, and NaN where an input is missing', () => {
    const proj = projectionFor(REGION);
    const flat = level(proj, cells(proj, () => 5));
    const wind = level(proj, cells(proj, (lat) => lat - 35));
    const out = read(combineInputs('frontogenesis', [flat, wind, wind], proj, { frame: 'earth', levelHpa: 700 }));
    assert.equal(at(proj, out, 30, 20), 0);
    const holed = cells(proj, (lat) => lat - 35);
    holed[20 * proj.nx + 30] = NaN;
    const tHoled = read(combineInputs('advection', [level(proj, holed), flat, flat], proj, { frame: 'earth' }));
    // A centred difference skips its own cell: the four neighbours that read the hole are NaN, the hole's own cell is not.
    for (const [i, j] of [[29, 20], [31, 20], [30, 19], [30, 21]]) assert.ok(Number.isNaN(at(proj, tHoled, i, j)), `${i},${j}`);
    assert.ok(Number.isFinite(at(proj, tHoled, 30, 20)) && Number.isFinite(at(proj, tHoled, 26, 20)));
});

test('a derivative needs the full-resolution grid and, for frontogenesis, its pressure level', () => {
    const proj = projectionFor(REGION);
    const x = level(proj, cells(proj, () => 1));
    assert.throws(() => combineInputs('advection', [{ ...x, factor: 2 }, x, x], proj, { frame: 'earth' }), /full-resolution/);
    assert.throws(() => combineInputs('frontogenesis', [x, x, x], proj, { frame: 'earth' }), /pressure level/);
    const hrrr = MODEL_CONFIGS.find((c) => c.id === 'hrrr');
    const field = hrrr.fields.find((f) => f.id === 'HRRR_FGEN_850MB');
    const broken = { ...hrrr, fields: hrrr.fields.map((f) => (f === field ? { ...f, recipeParams: { frame: 'grid' } } : f)) };
    assert.match(validateConfigs([broken]).join('\n'), /HRRR_FGEN_850MB: recipe frontogenesis needs recipeParams.levelHpa/);
});

test('moisture flux is humidity times speed, wind frame aside', () => {
    const proj = projectionFor(REGION);
    const out = read(combineInputs('moisture-flux', [level(proj, cells(proj, () => 8)), level(proj, cells(proj, () => 6)), level(proj, cells(proj, () => 8))], proj, { frame: 'grid' }));
    assert.equal(out[500], 80);
    const withHole = cells(proj, () => 8);
    withHole[500] = NaN;
    assert.ok(Number.isNaN(read(combineInputs('moisture-flux', [level(proj, withHole), level(proj, withHole), level(proj, withHole)], proj, {}))[500]));
});

test('the fixed-layer STP and the EHI are the sounding page\'s own composites, caps and floors included', () => {
    const proj = projectionFor({ ...REGION, nx: 4, ny: 4 });
    // [SBCAPE, LCL MSL, terrain, SRH 0-1 km, shear u, shear v]: around every cap and floor of the formula.
    const cases = [
        [3000, 1500, 500, 150, 0, 25], // LCL 1000 m AGL: the LCL term is exactly 1
        [3000, 2000, 500, 150, 0, 25], // 1500 m AGL: halfway
        [3000, 3000, 500, 150, 0, 25], // 2500 m AGL: zero
        [3000, 600, 500, 150, 0, 25], // 100 m AGL: capped at 1
        [3000, 1500, 500, 150, 0, 12], // shear under the 12.5 m/s floor
        [3000, 1500, 500, 150, 0, 40], // shear over the 30 m/s cap
        [3000, 1500, 500, -80, 0, 25], // anticyclonic helicity
        [0, 1500, 500, 150, 0, 25],
        [2000, 1000, 0, 100, 18, 24], // shear from components: 30 m/s
        [1500, 1000, 0, 150, 3, 4],
        [4000, 800, 0, 250, 15, 20],
        [500, 400, 0, 50, 5, 5],
        [2500, 900, 100, 200, 10, 10],
        [1000, 1800, 100, 120, 0, 15],
        [1200, 1100, 100, 90, 12, 5],
        [3500, 700, 100, 300, 20, 20],
    ];
    const columns = cases[0].map((_, c) => level(proj, cases.map((row) => row[c])));
    const out = read(combineInputs('stp-fixed', columns, proj, {}));
    cases.forEach(([cape, lcl, terrain, srh, su, sv], k) => {
        const expected = stpFixed(cape, lcl - terrain, srh, Math.hypot(su, sv));
        assert.ok(Math.abs(out[k] - expected) <= Math.max(0.002, 0.002 * Math.abs(expected)), `case ${k}: ${out[k]} against ${expected}`);
    });
    const ehiOut = read(combineInputs('ehi', [level(proj, cases.map((r) => r[0])), level(proj, cases.map((r) => r[3]))], proj, {}));
    cases.forEach(([cape, , , srh], k) => {
        const expected = ehi(cape, srh);
        assert.ok(Math.abs(ehiOut[k] - expected) <= Math.max(0.002, 0.002 * Math.abs(expected)), `ehi ${k}`);
    });
});

test('the 700-500 mb lapse rate is the temperature fall over the height difference, in degC per km', () => {
    const proj = projectionFor({ ...REGION, nx: 2, ny: 2 });
    const same = (v) => level(proj, [v, v, v, v]);
    // 14 degC to -12 degC over 3 100 m... heights 3 000 and 5 800 m: 26 degC over 2.8 km.
    const out = read(combineInputs('lapse-rate', [same(14), same(-12), same(3000), same(5800)], proj, {}));
    assert.ok(close(out[0], 26 / 2.8, 0.005), `${out[0]}`);
    // Inverted heights are no profile.
    assert.ok(Number.isNaN(read(combineInputs('lapse-rate', [same(14), same(-12), same(5800), same(3000)], proj, {}))[0]));
});
