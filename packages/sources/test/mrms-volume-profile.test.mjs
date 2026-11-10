import test from 'node:test';
import assert from 'node:assert/strict';
import { distanceMeters } from '@edgewarn/web-utils/geo';
import { CONUS_VOLUME_GRID, gridCol, gridRow, profileColumns, sampleLevel, sampleProfile, verticalValue } from '@edgewarn/web-utils/mrms';

const haversineM = (a, b) => distanceMeters(a.lat, a.lng, b.lat, b.lng);

const g = CONUS_VOLUME_GRID;
const rect = { r0: 1600, r1: 1699, c0: 3100, c1: 3199 }; // 100 x 100 cells near 38.5N, 98.5W
const rows = 100, cols = 100;
const at = (lat, lng) => ({ lat, lng });
const latOf = (row) => g.lat1 - row * g.dj;
const lngOf = (col) => g.lon1 + col * g.di;

/** A level whose value is linear in the column (so bilinear sampling must reproduce it exactly). */
function gradientLevel(k, field = (r, c) => c + 0.5 * k) {
    const data = new Float32Array(rows * cols);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) data[r * cols + c] = field(r + rect.r0, c + rect.c0);
    return data;
}

test('samples a synthetic gradient along the line', () => {
    const source = { rect, data: [gradientLevel(0), gradientLevel(1)] };
    const a = at(latOf(1620), lngOf(3120)), b = at(latOf(1620), lngOf(3170)); // 50 cells east
    const p = sampleProfile(source, a, b);
    assert.equal(p.nLevels, 2);
    assert.ok(p.n >= 64 && p.n <= 600);
    assert.ok(Math.abs(p.lengthM - haversineM(a, b)) < 1);
    for (const i of [0, p.n >> 1, p.n - 1]) {
        const col = gridCol(p.lng[i]);
        assert.ok(Math.abs(p.values[i * 2] - col) < 1e-3, `level 0 at column ${i}`);
        assert.ok(Math.abs(p.values[i * 2 + 1] - (col + 0.5)) < 1e-3);
        assert.ok(Math.abs(p.distM[i] - p.lengthM * ((i + 0.5) / p.n)) < 1e-3);
    }
});

test('column count follows the line length within 64 to 600', () => {
    assert.equal(profileColumns(500, 1000), 64);
    assert.equal(profileColumns(51_500, 1112), 93);
    assert.equal(profileColumns(5_000_000, 1000), 600);
});

test('no-data neighbours do not bleed: the nearest cell is used at an echo edge', () => {
    const level = gradientLevel(0, (r, c) => (c >= 3150 ? NaN : 40));
    // between column 3149 (40) and 3150 (NaN) the nearest cell decides
    assert.equal(sampleLevel(level, rect, 1620, 3149.2), 40);
    assert.ok(Number.isNaN(sampleLevel(level, rect, 1620, 3149.8)));
    assert.equal(sampleLevel(level, rect, 1620, 3140.5), 40);
    assert.ok(Number.isNaN(sampleLevel(level, rect, 5, 5)), 'outside the region');
});

test('NaN edges stay NaN along the line and unloaded levels are NaN', () => {
    const edge = gradientLevel(0, (r, c) => (c > 3150 ? NaN : 30));
    const source = { rect, data: [edge, null] };
    const p = sampleProfile(source, at(latOf(1620), lngOf(3120)), at(latOf(1620), lngOf(3180)));
    assert.equal(p.values[0], 30);
    assert.ok(Number.isNaN(p.values[(p.n - 1) * 2]));
    for (let i = 0; i < p.n; i++) assert.ok(Number.isNaN(p.values[i * 2 + 1]));
});

test('vertical interpolation is linear between loaded levels and skips a missing one', () => {
    const heights = [0.5, 0.75, 1, 1.25];
    const column = [10, NaN, 30, 40];
    const usable = [true, false, true, true]; // 0.75 km is missing
    assert.equal(verticalValue(column, usable, heights, 0.75), 20);
    assert.equal(verticalValue(column, usable, heights, 0.5), 10);
    assert.equal(verticalValue(column, usable, heights, 1.125), 35);
    assert.equal(verticalValue(column, usable, heights, 0.4), 10, 'just under the lowest level takes it');
    assert.ok(Number.isNaN(verticalValue(column, usable, heights, 0.3)));
    assert.equal(verticalValue(column, usable, heights, 1.5), 40);
    assert.ok(Number.isNaN(verticalValue(column, usable, heights, 3)));
});

test('echo tops: one side without an echo gives the value only near the level that has it', () => {
    const heights = [8, 9, 10];
    const column = [35, 20, NaN];
    const usable = [true, true, true];
    assert.equal(verticalValue(column, usable, heights, 9.25), 20);
    assert.ok(Number.isNaN(verticalValue(column, usable, heights, 9.75)));
});

test('the helper grid maths round-trip a coordinate', () => {
    assert.ok(Math.abs(gridRow(latOf(1234.5)) - 1234.5) < 1e-6);
    assert.ok(Math.abs(gridCol(lngOf(3456.25)) - 3456.25) < 1e-6);
});
