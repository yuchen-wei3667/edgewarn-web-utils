import test from 'node:test';
import assert from 'node:assert/strict';
import { projectionFor } from '../dist/projection/index.js';
import { getDataset } from '../dist/datasets.js';
import { ISOBAR_INTERVAL_HPA, ISOBAR_MAJOR_EVERY } from '../dist/limits.js';
import { buildIsobarSet, findPressureCenters, smoothGrid } from '../dist/isobars.js';

const proj = projectionFor(getDataset('hrrr').grid);
const NX = 200, NY = 140;

/** 1016 hPa background with a 1000 hPa low and a 1032 hPa high, each a Gaussian ~25 texels wide. */
function synoptic() {
    const values = new Float32Array(NX * NY);
    const bump = (x, y, cx, cy, amp) => amp * Math.exp(-(((x - cx) ** 2 + (y - cy) ** 2) / (2 * 25 ** 2)));
    for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) values[y * NX + x] = 1016 + bump(x, y, 60, 70, -16) + bump(x, y, 150, 70, 16);
    return { nx: NX, ny: NY, factor: 3, values };
}

test('smoothing keeps NaN texels NaN and leaves a flat field flat', () => {
    const flat = new Float32Array(20 * 20).fill(1012);
    flat[5 * 20 + 5] = Number.NaN;
    const out = smoothGrid(flat, 20, 20, 2);
    assert.ok(Number.isNaN(out[5 * 20 + 5]));
    assert.ok(Math.abs(out[10 * 20 + 10] - 1012) < 1e-4);
});

test('finds one Low and one High, in the right places and with their pressure', () => {
    const centers = findPressureCenters(synoptic(), 24, 2, 8);
    const lows = centers.filter((c) => c.kind === 'L'), highs = centers.filter((c) => c.kind === 'H');
    assert.equal(lows.length, 1);
    assert.equal(highs.length, 1);
    assert.ok(Math.abs(lows[0].c - 60) <= 1 && Math.abs(lows[0].r - 70) <= 1);
    assert.ok(Math.abs(highs[0].c - 150) <= 1 && Math.abs(highs[0].r - 70) <= 1);
});

test('a ridge that is only the edge of the grid is not a High', () => {
    const values = new Float32Array(NX * NY);
    for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) values[y * NX + x] = 1000 + x * 0.2;
    assert.deepEqual(findPressureCenters({ nx: NX, ny: NY, factor: 3, values }, 24, 2, 8), []);
});

test('isobars come at the configured interval, close around a Low, and mark every fifth as major', () => {
    const set = buildIsobarSet(synoptic(), proj);
    const levels = new Set(set.lines.map((l) => l.hpa));
    for (const hpa of levels) assert.equal(hpa % ISOBAR_INTERVAL_HPA, 0);
    assert.ok(levels.has(1000 + ISOBAR_INTERVAL_HPA) && levels.has(1020) && levels.has(1028));
    for (const l of set.lines) assert.equal(l.major, l.hpa % (ISOBAR_INTERVAL_HPA * ISOBAR_MAJOR_EVERY) === 0);
    // The 1008 hPa contour surrounds the Low: one loop whose end meets its start.
    const ring = set.lines.filter((l) => l.hpa === 1008);
    assert.equal(ring.length, 1);
    const [first, last] = [ring[0].coordinates[0], ring[0].coordinates.at(-1)];
    assert.ok(Math.abs(first[0] - last[0]) < 1e-9 && Math.abs(first[1] - last[1]) < 1e-9);
    assert.deepEqual(set.centers.map((c) => c.kind).sort(), ['H', 'L']);
    const low = set.centers.find((c) => c.kind === 'L');
    assert.ok(low.hpa >= 1000 && low.hpa <= 1002);
});

test('a NaN hole produces no contours through it', () => {
    const field = synoptic();
    for (let y = 60; y < 80; y++) for (let x = 50; x < 70; x++) field.values[y * NX + x] = Number.NaN;
    const set = buildIsobarSet(field, proj);
    assert.ok(set.lines.every((l) => l.coordinates.every(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat))));
});

test('height fields declare automatic contours in decameters at each pressure level', async () => {
    const { getModelField } = await import('../dist/catalog.js');
    for (const [mb, interval] of [[925, 3], [850, 3], [700, 3], [500, 6], [250, 12]]) {
        const field = getModelField(`HRRR_HGT_${mb}MB`);
        assert.equal(field.units, 'dam');
        assert.equal(field.contourInterval, interval);
    }
    assert.equal(getModelField('HRRR_TMP_500MB').contourInterval, undefined);
});

test('height contours preserve dam values, texel-center alignment, masks and dateline splits', async () => {
    const { buildContourLines } = await import('../dist/isobars.js');
    const nx = 30, ny = 30, factor = 3;
    const values = Float32Array.from({ length: nx * ny }, (_, k) => 540 + k % nx);
    // A missing horizontal band must break every contour crossing it.
    for (let y = 12; y <= 16; y++) values.fill(NaN, y * nx, (y + 1) * nx);
    const projection = {
        inverse: (x, y) => [y, x > 60 ? x - 360 : x],
    };
    const lines = buildContourLines({ nx, ny, factor, values }, projection, 6);
    assert.ok(lines.some((line) => line.value === 552));
    for (const line of lines) {
        assert.equal(line.value % 6, 0);
        assert.equal(line.major, line.value % 30 === 0);
        for (let i = 0; i < line.coordinates.length; i++) {
            const [lng, lat] = line.coordinates[i];
            assert.ok(Number.isFinite(lng) && Number.isFinite(lat));
            assert.ok(lat < 12 * factor + 1 || lat > 16 * factor + 1);
            if (i) assert.ok(Math.abs(lng - line.coordinates[i - 1][0]) <= 180);
            // The 552-dam line is at x=12 in the reduced grid, then shifted to the center of its source texel.
            if (line.value === 552) assert.ok(Math.abs(lng - (12 * factor + 1)) < 1e-6);
        }
    }
    assert.ok(lines.filter((line) => line.value === 552).length >= 2);
    assert.deepEqual(buildContourLines({ nx, ny, factor, values: new Float32Array(nx * ny).fill(NaN) }, projection, 6), []);
    assert.throws(() => buildContourLines({ nx, ny, factor, values }, projection, 0));
});

test('height contours crossing the dateline split instead of spanning the map', async () => {
    const { buildContourLines } = await import('../dist/isobars.js');
    const nx = 30, ny = 30;
    const values = Float32Array.from({ length: nx * ny }, (_, k) => 540 + Math.floor(k / nx));
    const projection = { inverse: (x, y) => [y, x < 15 ? 165 + x : -195 + x] };
    const lines = buildContourLines({ nx, ny, factor: 1, values }, projection, 6).filter((line) => line.value === 552);
    assert.equal(lines.length, 2);
    assert.ok(lines.some((line) => line.coordinates.every(([lng]) => lng > 0)));
    assert.ok(lines.some((line) => line.coordinates.every(([lng]) => lng < 0)));
    for (const line of lines) for (let i = 1; i < line.coordinates.length; i++) {
        assert.ok(Math.abs(line.coordinates[i][0] - line.coordinates[i - 1][0]) <= 180);
    }
});

test('pressure-level winds automatically resolve matching height contours for supported models', async () => {
    const { heightContourFieldForModel, getModelField, MODEL_FIELDS, modelHasField } = await import('../dist/catalog.js');
    for (const mb of [925, 850, 700, 500, 250]) {
        const wind = getModelField(`HRRR_WIND_${mb}MB`);
        assert.equal(wind.contourField, `HRRR_HGT_${mb}MB`);
        for (const model of wind.models) {
            const height = heightContourFieldForModel(wind.id, model);
            assert.equal(height?.id ?? null, modelHasField(wind.contourField, model) ? wind.contourField : null);
        }
        assert.equal(heightContourFieldForModel(wind.id, 'hrrr')?.id, wind.contourField);
        assert.equal(heightContourFieldForModel(wind.contourField, 'hrrr')?.id, wind.contourField);
        assert.equal(heightContourFieldForModel(wind.id, 'hrrr', 'exceed'), null);
        assert.equal(heightContourFieldForModel(wind.id, 'hrrr', 'nsprd'), null);
    }
    // Surface winds have no pressure-level height overlay.
    for (const field of MODEL_FIELDS.filter((f) => f.kind === 'vector' && !f.contourField)) {
        assert.equal(heightContourFieldForModel(field.id, field.models[0]), null);
    }
    assert.equal(heightContourFieldForModel('HRRR_WIND_500MB', 'nbm'), null);
    assert.equal(heightContourFieldForModel('HRRR_TMP_500MB', 'hrrr'), null);
});
