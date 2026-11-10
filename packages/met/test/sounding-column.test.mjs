import assert from 'node:assert/strict';
import test from 'node:test';
import { buildColumn, dewpointFromRelativeHumidity, rotateWind, surfacePressure } from '@edgewarn/web-utils/met';

/** Hand-checkable inputs: the heights are an isothermal 10 m per hPa so the bracket maths has a closed form. */
const level = (p, extra = {}) => ({ p, z: (1000 - p) * 10, t: 10, rh: 50, gu: 0, gv: 0, ...extra });
const LEVELS = [1000, 950, 900, 850, 800].map((p) => level(p));
const SURFACE = { t: 12, rh: 60, gu: 3, gv: 4, hsurf: 0 };

test('the surface pressure is interpolated in ln p between the levels that bracket the terrain', () => {
    const at = surfacePressure(LEVELS, 250);
    assert.equal(at.method, 'bracket');
    // Heights run 0, 500, 1000, 1500, 2000 m for 1000 to 800 hPa, so 250 m is halfway between 1000 and 950 hPa in ln p.
    assert.ok(Math.abs(at.p - Math.sqrt(1000 * 950)) < 1e-9, `${at.p}`);
    assert.ok(Math.abs(surfacePressure(LEVELS, 500).p - 950) < 1e-9);
    assert.ok(surfacePressure(LEVELS, 1990).p > 800 && surfacePressure(LEVELS, 1990).p < 805);
});

test('terrain below the lowest level is reached hypsometrically; terrain above every level has no surface', () => {
    const below = surfacePressure(LEVELS, -100);
    assert.equal(below.method, 'hypsometric');
    // 100 m of 10 degC air is about 12 hPa.
    assert.ok(below.p > 1010 && below.p < 1014, `${below.p}`);
    assert.equal(surfacePressure(LEVELS, 2500), null);
    assert.equal(surfacePressure([], 0), null);
    assert.equal(surfacePressure(LEVELS, Number.NaN), null);
});

test('winds turn from the grid axes to east and north, keeping their speed', () => {
    const [u, v] = rotateWind(1, 0, Math.PI / 6);
    assert.ok(Math.abs(u - Math.cos(Math.PI / 6)) < 1e-12 && Math.abs(v + Math.sin(Math.PI / 6)) < 1e-12);
    const [a, b] = rotateWind(3, 4, 0.7);
    assert.ok(Math.abs(Math.hypot(a, b) - 5) < 1e-12);
    assert.deepEqual(rotateWind(3, 4, 0), [3, 4]);
});

test('a column starts at the surface, drops what is under the ground and derives every dewpoint from humidity', () => {
    const built = buildColumn(1234, LEVELS, { ...SURFACE, hsurf: 600 }, 0);
    const c = built.column;
    assert.equal(c.validMs, 1234);
    assert.deepEqual(Array.from(c.z), [600, 1000, 1500, 2000]);
    assert.ok(c.p[0] < 950 && c.p[0] > 900 && c.p[1] === 900);
    assert.equal(built.dropped, 2, '1000 and 950 hPa are below a 600 m surface');
    assert.equal(c.td[1], Math.fround(dewpointFromRelativeHumidity(10, 50)));
    assert.equal(c.td[0], Math.fround(dewpointFromRelativeHumidity(12, 60)));
    assert.deepEqual(c.surface, { p: c.p[0], z: 600, t: 12, td: c.td[0], u: 3, v: 4 });
    for (let k = 1; k < c.p.length; k++) assert.ok(c.p[k] < c.p[k - 1] && c.z[k] > c.z[k - 1]);
});

test('a level too close to the surface pressure duplicates the surface row and is dropped', () => {
    // 950 hPa sits at 500 m: a 500 m surface lands exactly on it.
    const c = buildColumn(0, LEVELS, { ...SURFACE, hsurf: 500 }, 0).column;
    assert.deepEqual(Array.from(c.p), [950, 900, 850, 800]);
});

test('a level with a missing pressure, height or temperature is dropped, and missing humidity only blanks the dewpoint', () => {
    const levels = [level(1000), level(950, { t: Number.NaN }), level(900, { z: Number.NaN }), level(850, { rh: Number.NaN }), level(800)];
    const c = buildColumn(0, levels, { ...SURFACE, hsurf: -50 }, 0).column;
    assert.deepEqual(Array.from(c.p).slice(1), [1000, 850, 800]);
    assert.ok(Number.isNaN(c.td[2]) && Number.isFinite(c.td[1]));
});

test('a height that does not rise above the level under it is dropped', () => {
    const levels = [level(1000), level(950, { z: 400 }), level(900, { z: 300 }), level(850)];
    const c = buildColumn(0, levels, { ...SURFACE, hsurf: -50 }, 0).column;
    assert.deepEqual(Array.from(c.p).slice(1), [1000, 950, 850]);
});

test('a column with no usable surface is null, not a guess', () => {
    assert.equal(buildColumn(0, LEVELS, { ...SURFACE, t: Number.NaN }, 0), null);
    assert.equal(buildColumn(0, LEVELS, { ...SURFACE, gu: Number.NaN }, 0), null);
    assert.equal(buildColumn(0, LEVELS, { ...SURFACE, hsurf: 5000 }, 0), null);
    assert.equal(buildColumn(0, [], SURFACE, 0), null);
});

test('surface and level winds are rotated together', () => {
    const levels = LEVELS.map((l) => ({ ...l, gu: 10, gv: 0 }));
    const c = buildColumn(0, levels, { ...SURFACE, hsurf: -50, gu: 10, gv: 0 }, Math.PI / 2).column;
    for (let k = 0; k < c.p.length; k++) assert.ok(Math.abs(c.u[k]) < 1e-5 && Math.abs(c.v[k] + 10) < 1e-5, `level ${k}: ${c.u[k]}, ${c.v[k]}`);
});

test('vertical velocity is carried only when every level has it, with NaN at the surface row', () => {
    const withW = LEVELS.map((l, k) => ({ ...l, w: k / 10 }));
    const c = buildColumn(0, withW, { ...SURFACE, hsurf: -50 }, 0, true).column;
    assert.equal(c.vertical.units, 'm/s');
    assert.ok(Number.isNaN(c.vertical.values[0]));
    assert.equal(c.vertical.values.length, c.p.length);
    assert.equal(buildColumn(0, LEVELS, { ...SURFACE, hsurf: -50 }, 0, true).column.vertical, undefined);
    assert.equal(buildColumn(0, withW, { ...SURFACE, hsurf: -50 }, 0, false).column.vertical, undefined);
});
