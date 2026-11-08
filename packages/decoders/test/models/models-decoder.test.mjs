import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeGrib2ToHalf, decodeGrib2ToLevels, readGrib2Grid } from '../../dist/grib2/models/grib2.js';
import { fromHalf } from '../../dist/grib2/models/half.js';
import { buildLambertGrib, buildLatLonGrib } from '../fixtures/models/lcc-grib-builder.mjs';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'models');
const reference = JSON.parse(readFileSync(path.join(DIR, 'reference.json'), 'utf8'));
const fixture = (name) => new Uint8Array(readFileSync(path.join(DIR, name)));
/** HRRR's 3, 6 and 9 km levels. */
const FACTORS = [1, 2, 3];
/** Half a float16 step at v: the most round-to-nearest can move a value. */
const halfStep = (v) => Math.max(Math.abs(v), 2 ** -14) * 2 ** -11;

test('level 0 matches ecCodes at every reference point of every fixture', () => {
    for (const [name, ref] of Object.entries(reference)) {
        const { grid, data } = decodeGrib2ToHalf(fixture(name));
        assert.equal(grid.nx, ref.nx);
        assert.equal(grid.ny, ref.ny);
        assert.equal(grid.scanMode, 0x40);
        for (const s of ref.samples) {
            const got = fromHalf(data[s.j * ref.nx + s.i]);
            assert.ok(Math.abs(got - s.value) <= halfStep(s.value) + 1e-6, `${name} (${s.i},${s.j}): ${got} vs ${s.value}`);
        }
    }
});

test('the grid metadata matches ecCodes', () => {
    const ref = reference['t12z-f00-tmp2m.grib2'];
    const { grid } = decodeGrib2ToHalf(fixture('t12z-f00-tmp2m.grib2'));
    for (const k of ['lat1', 'lon1', 'lov', 'latin1', 'latin2', 'dx', 'dy']) assert.ok(Math.abs(grid[k] - ref[k]) < 1e-6, k);
});

test('a transform is folded into the unpack constants', () => {
    const ref = reference['t12z-f00-tmp2m.grib2'];
    const { data } = decodeGrib2ToHalf(fixture('t12z-f00-tmp2m.grib2'), { offset: -273.15 });
    for (const s of ref.samples) {
        const c = s.value - 273.15;
        assert.ok(Math.abs(fromHalf(data[s.j * ref.nx + s.i]) - c) <= halfStep(c) + 1e-4);
    }
});

test('a level-2-only decode allocates only the 3x grid', () => {
    const { levels } = decodeGrib2ToLevels(fixture('t12z-f00-tmp2m.grib2'), { factors: FACTORS, levels: [2] });
    assert.equal(levels.length, 1);
    assert.deepEqual([levels[0].level, levels[0].factor, levels[0].nx, levels[0].ny], [2, 3, 600, 353]);
    assert.equal(levels[0].data.length, 600 * 353);
});

test('mean levels equal block means of level 0 on real data, with partial edge blocks', () => {
    const msg = fixture('t12z-f00-hgt500.grib2');
    const { levels: [l0, l1, l2] } = decodeGrib2ToLevels(msg, { factors: FACTORS, levels: [0, 1, 2] });
    assert.deepEqual([l1.nx, l1.ny, l2.nx, l2.ny], [900, 530, 600, 353]);
    const blockMean = (f, c, r) => {
        let sum = 0, n = 0;
        for (let j = r * f; j < Math.min(r * f + f, l0.ny); j++) {
            for (let i = c * f; i < Math.min(c * f + f, l0.nx); i++) { sum += fromHalf(l0.data[j * l0.nx + i]); n++; }
        }
        return sum / n;
    };
    for (const [lvl, f] of [[l1, 2], [l2, 3]]) {
        for (const [c, r] of [[0, 0], [lvl.nx - 1, lvl.ny - 1], [lvl.nx >> 1, lvl.ny >> 1], [lvl.nx - 1, 0], [123, 77]]) {
            const want = blockMean(f, c, r);
            // Level 0 itself is rounded to float16, so allow one step either side.
            assert.ok(Math.abs(fromHalf(lvl.data[r * lvl.nx + c]) - want) <= 4 * halfStep(want), `f${f} (${c},${r})`);
        }
    }
});

test('max levels keep storm peaks that a mean would erase', () => {
    for (const name of ['t12z-f00-refc.grib2', 't12z-f01-mxuphl25.grib2']) {
        const ref = reference[name];
        const { levels: [l2] } = decodeGrib2ToLevels(fixture(name), { factors: FACTORS, levels: [2], reducer: 'max' });
        let max = -Infinity;
        for (const h of l2.data) max = Math.max(max, fromHalf(h));
        assert.ok(Math.abs(max - ref.max) <= halfStep(ref.max), `${name}: ${max} vs ${ref.max}`);
        const { levels: [mean] } = decodeGrib2ToLevels(fixture(name), { factors: FACTORS, levels: [2] });
        let meanMax = -Infinity;
        for (const h of mean.data) meanMax = Math.max(meanMax, fromHalf(h));
        assert.ok(meanMax <= max);
    }
});

test('NaN cells are excluded from means and an all-NaN block stays NaN', () => {
    // 5 x 4 grid (edges do not divide by 2 or 3).
    const N = NaN;
    const values = [
        1, 3, N, N, 9,
        5, 7, N, N, N,
        2, N, 4, 4, 6,
        N, N, 4, 4, 8,
    ];
    const msg = buildLambertGrib(values, 5, 4);
    const { levels: [l0, l1] } = decodeGrib2ToLevels(msg, { factors: FACTORS, levels: [0, 1] });
    assert.ok(Number.isNaN(fromHalf(l0.data[2])));
    assert.equal(fromHalf(l0.data[4]), 9);
    const at = (c, r) => fromHalf(l1.data[r * l1.nx + c]);
    assert.deepEqual([l1.nx, l1.ny], [3, 2]);
    assert.equal(at(0, 0), 4);          // (1+3+5+7)/4
    assert.ok(Number.isNaN(at(1, 0)));  // all NaN
    assert.equal(at(2, 0), 9);          // partial edge column: 9 and NaN
    assert.equal(at(0, 1), 2);          // 2, NaN, NaN, NaN
    assert.equal(at(1, 1), 4);
    assert.equal(at(2, 1), 7);          // (6+8)/2
});

test('the mode reducer keeps the most common category per block', () => {
    const values = [
        1, 1, 2, 0, 0, 0,
        1, 3, 2, 0, 4, 4,
        3, 3, 2, 4, 4, 0,
    ];
    const msg = buildLambertGrib(values, 6, 3);
    const { levels: [l2] } = decodeGrib2ToLevels(msg, { factors: FACTORS, levels: [2], reducer: 'mode' });
    assert.deepEqual(Array.from(l2.data, fromHalf), [3, 0]);
    // A tie goes to the higher category so a rarer hazard code is not hidden.
    const tie = decodeGrib2ToLevels(buildLambertGrib([1, 4], 2, 1), { factors: FACTORS, levels: [1], reducer: 'mode' });
    assert.deepEqual(Array.from(tie.levels[0].data, fromHalf), [4]);
});

test('decimal scaling and the max reducer agree on synthetic data', () => {
    const values = [0.5, 1.25, 2.75, 0, 3.5, 0.25];
    const msg = buildLambertGrib(values, 3, 2, { decimal: 2 });
    const { levels: [l0, l1] } = decodeGrib2ToLevels(msg, { factors: FACTORS, levels: [0, 1], reducer: 'max' });
    assert.deepEqual(Array.from(l0.data, fromHalf), values);
    assert.deepEqual(Array.from(l1.data, fromHalf), [3.5, 2.75]);
});

// ── Scan modes, earth radius and the NBM grid (general Lambert grids) ──

/** Rows of `values` (natural order, row 0 south) laid out as a scan-mode 0x50 message stores them. */
const alternate = (values, nx, ny) => {
    const out = [];
    for (let j = 0; j < ny; j++) {
        const row = values.slice(j * nx, (j + 1) * nx);
        out.push(...(j % 2 === 1 ? row.reverse() : row));
    }
    return out;
};

test('adjacent-row scanning (0x50) decodes to the same grid as its 0x40 twin at every level', () => {
    const nx = 7, ny = 5;
    const natural = Array.from({ length: nx * ny }, (_, k) => (k * 7) % 31);
    const withHoles = natural.map((v, k) => (k % 6 === 4 ? NaN : v));
    for (const [name, values] of [['full', natural], ['bitmap', withHoles]]) {
        const twin = decodeGrib2ToLevels(buildLambertGrib(values, nx, ny), { factors: FACTORS, levels: [0, 1, 2] });
        const alt = decodeGrib2ToLevels(buildLambertGrib(alternate(values, nx, ny), nx, ny, { scanMode: 0x50 }), { factors: FACTORS, levels: [0, 1, 2] });
        assert.equal(alt.grid.scanMode, 0x50);
        for (let l = 0; l < 3; l++) assert.deepEqual(Array.from(alt.levels[l].data), Array.from(twin.levels[l].data), `${name} level ${l}`);
    }
});

test('adjacent-row scanning keeps coarse levels right when only a coarse level is asked for', () => {
    const nx = 6, ny = 4;
    const natural = Array.from({ length: nx * ny }, (_, k) => k);
    const alt = buildLambertGrib(alternate(natural, nx, ny), nx, ny, { scanMode: 0x50 });
    const { levels: [l1] } = decodeGrib2ToLevels(alt, { factors: FACTORS, levels: [1] });
    // 2x2 block means of 0..23 laid out 6 wide: columns pair (0,1)(2,3)(4,5), rows pair (0,1)(2,3).
    assert.deepEqual(Array.from(l1.data, fromHalf), [3.5, 5.5, 7.5, 15.5, 17.5, 19.5]);
});

test('scan modes other than 0x40 and 0x50 are refused', () => {
    for (const scanMode of [0x00, 0x80, 0x20, 0x60, 0xc0, 0x41]) {
        const msg = buildLambertGrib([1, 2, 3, 4], 2, 2, { scanMode });
        assert.throws(() => decodeGrib2ToHalf(msg), new RegExp(`Scan mode 0x${scanMode.toString(16)} not supported`), `0x${scanMode.toString(16)}`);
    }
});

test('the earth radius is read from the message and unknown shapes are refused', () => {
    const radius = (opts) => readGrib2Grid(buildLambertGrib([1, 2, 3, 4], 2, 2, opts)).radiusM;
    assert.equal(radius({ shape: 6 }), 6371229);
    assert.equal(radius({ shape: 1, radius: 6371200 }), 6371200);
    assert.equal(radius({ shape: 1, radius: 6378137 }), 6378137);
    assert.equal(radius({ shape: 0 }), 6367470);
    assert.throws(() => radius({ shape: 2 }), /Shape of earth 2 not supported/);
});

test('every real HRRR fixture declares the 6 371 229 m sphere', () => {
    for (const name of Object.keys(reference)) assert.equal(readGrib2Grid(fixture(name)).radiusM, 6371229, name);
});

test('a real NBM message decodes on its declared grid with coherent rows', () => {
    const msg = new Uint8Array(readFileSync(path.join(DIR, 'nbm', 't12z-f012-vis.grib2')));
    const { grid, data } = decodeGrib2ToHalf(msg);
    assert.deepEqual(
        { nx: grid.nx, ny: grid.ny, lat1: grid.lat1, lon1: grid.lon1, lov: grid.lov, latin1: grid.latin1, latin2: grid.latin2, scanMode: grid.scanMode, radiusM: grid.radiusM },
        { nx: 2345, ny: 1597, lat1: 19.229, lon1: 233.7234, lov: 265, latin1: 25, latin2: 25, scanMode: 0x50, radiusM: 6371200 },
    );
    assert.ok(Math.abs(grid.dx - 2539.703) < 1e-3 && Math.abs(grid.dy - 2539.703) < 1e-3);
    // Read as 0x40 the odd rows would be mirrored and the next row would differ by ~13x what a column
    // neighbour does (773 m against 67 m of visibility, measured before the fix). Coherent rows keep it near 1x.
    let rowDiff = 0, colDiff = 0, n = 0;
    for (let r = 100; r < grid.ny - 100; r += 7) {
        for (let c = 100; c < grid.nx - 100; c += 5) {
            const at = (rr, cc) => fromHalf(data[rr * grid.nx + cc]);
            const a = at(r, c), below = at(r + 1, c), right = at(r, c + 1);
            if (!Number.isFinite(a) || !Number.isFinite(below) || !Number.isFinite(right)) continue;
            rowDiff += Math.abs(a - below);
            colDiff += Math.abs(a - right);
            n++;
        }
    }
    assert.ok(n > 1000);
    assert.ok(rowDiff / colDiff < 2, `rows differ ${(rowDiff / n).toFixed(0)} against ${(colDiff / n).toFixed(0)} along a row`);
});

test('the component flag is read from octet 55 bit 5', () => {
    const flag = (resolutionFlags) => readGrib2Grid(buildLambertGrib([1, 2, 3, 4], 2, 2, { resolutionFlags })).componentsRelativeToGrid;
    assert.equal(flag(0x08), true);
    assert.equal(flag(0x00), false);
    assert.equal(flag(0xa0), false, 'the other resolution flags do not count');
    assert.equal(flag(0xa8), true);
});

test('the real HRRR messages carry the earth flag although their winds are grid-relative', () => {
    // Why a vector field's own `frame` outranks this flag (recipes.test.mjs): it cannot be trusted on HRRR, RRFS or REFS.
    for (const name of Object.keys(reference)) assert.equal(readGrib2Grid(fixture(name)).componentsRelativeToGrid, false, name);
});

test('a lat/lon grid whose increments are rounded to micro-degrees still decodes (HAFS: 0.02 stored as 19999)', () => {
    const nx = 1001;
    const grid = { lat1: 10, lon1: 270, dlat: 0.019999, dlon: 0.019999 };
    const last = { lat: 10 + 800 * 0.02, lon: 270 + 1000 * 0.02 };
    const got = readGrib2Grid(buildLatLonGrib(new Array(nx * 2).fill(1), nx, 2, { grid, scanMode: 0x40, last: { lat: 10 + 0.02, lon: last.lon } }));
    assert.equal(got.nx, nx);
    assert.throws(() => readGrib2Grid(buildLatLonGrib([1, 2, 3, 4], 2, 2, { last: { lat: 0, lon: 5 } })), /extent does not match/);
});