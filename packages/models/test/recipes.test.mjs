import test from 'node:test';
import assert from 'node:assert/strict';
import { combineInputs, combinesBeforeDecimation, decimateMean, RECIPE_ROLES } from '../dist/recipes.js';
import { fromHalf, HALF_NAN, toHalf } from '@edgewarn/web-utils/grib2';
import { gridRotation, lambertProjection } from '../dist/lambert.js';
import { projectionFor } from '../dist/projection/index.js';
import { getDataset } from '../dist/datasets.js';
import { speedAndDirection } from '../dist/winds.js';

const lambert = lambertProjection(getDataset('hrrr').grid);
const proj = projectionFor(getDataset('hrrr').grid);

/** A float16 level of the given values, as the decoder hands them to a recipe. */
const level = (values, nx = values.length, ny = 1) => ({ level: 0, factor: 1, nx, ny, data: Uint16Array.from(values, (v) => (Number.isNaN(v) ? HALF_NAN : toHalf(v))) });
const pairs = (out) => Array.from({ length: out.data.length / 2 }, (_, k) => [fromHalf(out.data[2 * k]), fromHalf(out.data[2 * k + 1])]);
const close = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;

test('speed and direction become east and north components pointing where the air goes', () => {
    // Directions are the compass bearing the wind blows FROM.
    const out = combineInputs('speed-direction', [level([10, 10, 10, 10, 10]), level([0, 90, 180, 270, 45])], proj);
    assert.equal(out.channels, 2);
    const [n, e, s, w, ne] = pairs(out);
    assert.ok(close(n[0], 0) && close(n[1], -10), 'from the north blows south');
    assert.ok(close(e[0], -10) && close(e[1], 0), 'from the east blows west');
    assert.ok(close(s[0], 0) && close(s[1], 10), 'from the south blows north');
    assert.ok(close(w[0], 10) && close(w[1], 0), 'from the west blows east');
    assert.ok(close(ne[0], -7.07) && close(ne[1], -7.07), 'from the north-east blows south-west');
    // Round trip through the speed and direction the tooltip shows.
    for (const [k, bearing] of [[0, 0], [1, 90], [2, 180], [3, 270], [4, 45]]) {
        const { speed, direction } = speedAndDirection(...pairs(out)[k]);
        assert.ok(close(speed, 10, 0.05) && close((direction + 180) % 360 - 180, (bearing + 180) % 360 - 180, 0.5), `bearing ${bearing}: ${direction}`);
    }
});

test('calm air has no direction to miss, and a missing speed stays missing', () => {
    const out = combineInputs('speed-direction', [level([0, 0, NaN, 5]), level([NaN, 120, 90, NaN])], proj);
    const [calmNoDir, calmDir, noSpeed, noDir] = pairs(out);
    assert.deepEqual(calmNoDir, [0, 0]);
    assert.deepEqual(calmDir, [0, 0]);
    assert.ok(Number.isNaN(noSpeed[0]) && Number.isNaN(noSpeed[1]));
    assert.ok(Number.isNaN(noDir[0]) && Number.isNaN(noDir[1]), 'a speed with no direction is missing, not calm');
});

test('a direction given relative to the grid is rotated to east and north; one given to the earth is not', () => {
    const lon = -105;
    const k = 7;
    const speed = level(Array(16).fill(10), 4, 4);
    const direction = level(Array(16).fill(0), 4, 4);
    const earth = pairs(combineInputs('speed-direction', [speed, direction], proj, { frame: 'earth' }))[k];
    const grid = pairs(combineInputs('speed-direction', [speed, direction], proj, { frame: 'grid' }))[k];
    assert.ok(close(earth[0], 0) && close(earth[1], -10));
    assert.ok(Math.hypot(...grid) > 9.9 && Math.hypot(...grid) < 10.1, 'rotation keeps the speed');
    assert.ok(Math.abs(grid[0]) > 0.5, 'and turns the direction (the grid is not aligned with north away from its central meridian)');
    assert.ok(Number.isFinite(gridRotation(lambert, lon)));
});

test('vector components are rotated to the earth unless the field says they already are', () => {
    const u = level(Array(16).fill(10), 4, 4);
    const v = level(Array(16).fill(0), 4, 4);
    const rotated = pairs(combineInputs('vector', [u, v], proj))[3];
    const asIs = pairs(combineInputs('vector', [u, v], proj, { frame: 'earth' }))[3];
    const explicit = pairs(combineInputs('vector', [u, v], proj, { frame: 'grid' }))[3];
    assert.deepEqual(asIs, [10, 0], 'earth-relative components pass through');
    assert.deepEqual(rotated, explicit, 'grid is the default');
    assert.ok(rotated[0] !== 10 || rotated[1] !== 0, 'the grid frame rotates');
    assert.ok(close(Math.hypot(...rotated), 10, 0.05));
});

const DIAGNOSTICS = [
    'advection', 'ehi', 'frontogenesis', 'lapse-rate', 'moisture-flux', 'stp-fixed',
    'differential-advection', 'isentropic', 'ivt', 'potential-vorticity', 'q-vector', 'storm-relative', 'absolute-vorticity',
];

test('every recipe has its input roles, and only a direction or a diagnostic needs combining before it is decimated', () => {
    assert.deepEqual(Object.keys(RECIPE_ROLES).sort(), [...DIAGNOSTICS, 'ptype', 'single', 'speed-direction', 'sum', 'thetae', 'vector'].sort());
    assert.deepEqual(RECIPE_ROLES['speed-direction'], ['speed', 'direction']);
    assert.equal(RECIPE_ROLES.sum, null, 'sum takes any number of windows');
    assert.equal(combinesBeforeDecimation('speed-direction'), true);
    for (const recipe of DIAGNOSTICS) assert.equal(combinesBeforeDecimation(recipe), true, recipe);
    for (const recipe of ['single', 'vector', 'ptype', 'thetae', 'sum']) assert.equal(combinesBeforeDecimation(recipe), false, recipe);
});

test('decimating combined components averages them; averaging directions would not', () => {
    // A 2x2 block of 10 m/s wind from 350, 10, 350 and 10 degrees blows almost due south.
    const nx = 2, ny = 2;
    const speed = level([10, 10, 10, 10], nx, ny);
    const direction = level([350, 10, 350, 10], nx, ny);
    const full = combineInputs('speed-direction', [speed, direction], proj);
    const coarse = decimateMean(full.data, nx, ny, 2, 2);
    assert.deepEqual([coarse.nx, coarse.ny], [1, 1]);
    const [u, v] = pairs({ data: coarse.data })[0];
    const { speed: s, direction: d } = speedAndDirection(u, v);
    assert.ok(close(u, 0, 0.02) && close(v, -9.85, 0.02), `${u}, ${v}`);
    assert.ok(close(s, 9.85, 0.02) && (d < 0.5 || d > 359.5), `speed ${s} direction ${d}`);
    // The mean of the directions themselves is nonsense: 180 degrees, a wind from the south.
    const meanDirection = fromHalf(toHalf((350 + 10 + 350 + 10) / 4));
    assert.equal(meanDirection, 180);
});

test('decimation follows the decoder\'s mean: partial edge blocks, NaN left out, an all-NaN block stays NaN', () => {
    const nx = 5, ny = 3;
    const values = [
        1, 2, 3, 4, 5,
        6, 7, NaN, 9, 10,
        NaN, NaN, 13, 14, NaN,
    ];
    const src = level(values, nx, ny);
    const out = decimateMean(src.data, nx, ny, 1, 2);
    assert.deepEqual([out.nx, out.ny], [3, 2]);
    const at = (c, r) => fromHalf(out.data[r * out.nx + c]);
    const half = (v) => fromHalf(toHalf(v));
    assert.equal(at(0, 0), 4);                       // (1+2+6+7)/4
    assert.equal(at(1, 0), half((3 + 4 + 9) / 3));   // the NaN is left out
    assert.equal(at(2, 0), 7.5);                     // partial column: 5 and 10
    assert.ok(Number.isNaN(at(0, 1)), 'a block with nothing in it');
    assert.equal(at(1, 1), half((13 + 14) / 2));
    assert.ok(Number.isNaN(at(2, 1)));
    // Two channels are averaged together, and a texel missing either is left out.
    const two = new Uint16Array([toHalf(2), toHalf(4), toHalf(4), HALF_NAN, toHalf(6), toHalf(8), toHalf(8), toHalf(10)]);
    const merged = decimateMean(two, 2, 2, 2, 2);
    assert.deepEqual([fromHalf(merged.data[0]), fromHalf(merged.data[1])], [16 / 3, 22 / 3].map((v) => fromHalf(toHalf(v))));
});

test('vector with componentsRelativeToGrid false skips rotation unless the field says grid', () => {
    const u = level(Array(16).fill(10), 4, 4);
    const v = level(Array(16).fill(0), 4, 4);
    const flagged = (frame, relative) => pairs(combineInputs('vector', [u, v], proj, frame ? { frame } : {}, relative))[3];
    assert.deepEqual(flagged(undefined, false), [10, 0], 'the message says east/north: no rotation');
    assert.deepEqual(flagged(undefined, true), flagged('grid', undefined), 'the message says grid: rotated');
    assert.deepEqual(flagged(undefined, undefined), flagged('grid', undefined), 'no flag: rotated, as before');
    assert.deepEqual(flagged('grid', false), flagged('grid', undefined), 'the field outranks the flag (HRRR, RRFS and REFS flag grid-relative winds as earth)');
    assert.deepEqual(flagged('earth', true), [10, 0], 'and so does an earth field over a grid flag');
});
