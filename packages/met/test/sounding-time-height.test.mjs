import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTimeHeight, relativeHumidity } from '@edgewarn/web-utils/met/plot';
import { equivalentPotentialTemperature } from '@edgewarn/web-utils/met';
import { LEVELS, moistIndexColumn, mkCol } from './helpers.mjs';

/** The time-height arrays: a row per pressure, a column per time, NaN where a level is under the ground. */

const at = (grid, field, p, col) => grid[field][grid.levels.indexOf(p) * grid.times.length + col];

/** The helpers' moist column with a raised surface: levels at or below `surfaceP` are cut and the surface row is inserted. */
function columnOver(surfaceP, validMs, shift = 0) {
    const base = moistIndexColumn();
    const keep = LEVELS.map((p, k) => k).filter((k) => LEVELS[k] < surfaceP);
    const p = [surfaceP, ...keep.map((k) => LEVELS[k])];
    const t = [base.t[0] - 1 + shift, ...keep.map((k) => base.t[k] + shift)];
    const td = [base.td[0] - 1 + shift, ...keep.map((k) => base.td[k] + shift)];
    const col = mkCol(p, t, td);
    return { ...col, validMs };
}

test('rows are the union of the levels above ground, highest pressure first, the same in every column', () => {
    const grid = buildTimeHeight([columnOver(1012, 7200_000), columnOver(1000.5, 0)]);
    assert.deepEqual(grid.times, [0, 7200_000], 'columns are in time order whatever order they came in');
    assert.equal(grid.levels[0], 1000);
    assert.deepEqual(grid.levels, [...grid.levels].sort((a, b) => b - a));
    assert.equal(new Set(grid.levels).size, grid.levels.length);
    assert.equal(grid.rh.length, grid.levels.length * 2);
    assert.deepEqual(Array.from(grid.surfaceP), [1000.5, 1012]);
});

test('a level under the ground in a column is NaN there and filled in the others', () => {
    const grid = buildTimeHeight([columnOver(950, 0), columnOver(1000.5, 3600_000)]);
    assert.ok(Number.isNaN(at(grid, 'rh', 1000, 0)) && Number.isNaN(at(grid, 'thetaE', 975, 0)), 'underground at the 950 hPa surface');
    assert.ok(Number.isFinite(at(grid, 'rh', 975, 1)) && Number.isFinite(at(grid, 'u', 925, 0)));
    assert.ok(Number.isFinite(at(grid, 'rh', 925, 0)));
});

test('humidity and theta-e are the Bolton relations of the column\'s own temperature and dewpoint', () => {
    const col = columnOver(1000.5, 0);
    const grid = buildTimeHeight([col]);
    const k = Array.from(col.p).indexOf(700);
    assert.ok(Math.abs(at(grid, 'rh', 700, 0) - relativeHumidity(col.t[k], col.td[k])) < 1e-4);
    assert.ok(Math.abs(at(grid, 'thetaE', 700, 0) - equivalentPotentialTemperature(700, col.t[k], col.td[k])) < 1e-2);
    assert.equal(relativeHumidity(10, 10), 100);
    assert.ok(relativeHumidity(10, 0) > 40 && relativeHumidity(10, 0) < 60);
    assert.ok(Number.isNaN(relativeHumidity(10, Number.NaN)));
});

test('a missing dewpoint blanks humidity and theta-e but keeps the wind', () => {
    const col = columnOver(1000.5, 0);
    col.td[5] = Number.NaN;
    const grid = buildTimeHeight([col]);
    const p = col.p[5];
    assert.ok(Number.isNaN(at(grid, 'rh', p, 0)) && Number.isNaN(at(grid, 'thetaE', p, 0)) && Number.isFinite(at(grid, 'u', p, 0)));
});

test('vertical velocity is carried only when every column has it', () => {
    const a = columnOver(1000.5, 0);
    const b = columnOver(1000.5, 3600_000);
    a.vertical = { units: 'm/s', values: Float32Array.from(a.p, (_, k) => k / 10) };
    assert.equal(buildTimeHeight([a, b]).w, undefined);
    b.vertical = { units: 'm/s', values: Float32Array.from(b.p, () => 0.5) };
    const grid = buildTimeHeight([a, b]);
    assert.ok(grid.w && at(grid, 'w', 1000, 1) === 0.5);
    assert.ok(Math.abs(at(grid, 'w', 1000, 0) - 0.1) < 1e-6, 'the first level above the surface row is element 1 of the column');
});

test('no columns is an empty grid, not a throw', () => {
    const grid = buildTimeHeight([]);
    assert.deepEqual([grid.times, grid.levels, grid.rh.length], [[], [], 0]);
});
