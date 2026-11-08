import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSounding, resolveMotion } from '@edgewarn/web-utils/met';
import { liftColumn, surfaceParcelDef } from '@edgewarn/web-utils/met';
import { unstableColumn, mkCol, LEVELS, HEIGHT_OF, straightWinds, lcg, assertAllFinite } from './helpers.mjs';

test('seeded physical columns have finite output, nonnegative CAPE, negative CIN and ordered layers', () => {
    const random = lcg(20261029);
    for (let sample = 0; sample < 60; sample++) {
        const surfaceT = 15 + 20 * random();
        const lapse = 0.003 + 0.005 * random();
        const depression = 1 + 15 * random();
        const t = LEVELS.map((p) => surfaceT - lapse * HEIGHT_OF(p));
        const td = t.map((v) => v - depression - random() * 2);
        const u = LEVELS.map((p) => 3 + HEIGHT_OF(p) * 0.004 + random());
        const v = LEVELS.map((p) => 5 + HEIGHT_OF(p) * 0.001 + random());
        const col = mkCol(LEVELS, t, td, u, v);
        col.validMs = sample;
        const result = analyzeSounding(col);
        assertAllFinite(result);
        for (const parcel of Object.values(result.parcels)) {
            assert.ok(parcel.cape === null || parcel.cape >= 0);
            assert.ok(parcel.cin === null || parcel.cin <= 1e-8);
            // Float32 pressure-grid rounding is sub-centimetre in height.
            if (parcel.lclZagl !== null && parcel.lfcZagl !== null) assert.ok(parcel.lclZagl <= parcel.lfcZagl + 0.01);
            if (parcel.lfcZagl !== null && parcel.elZagl !== null) assert.ok(parcel.lfcZagl <= parcel.elZagl + 1e-5);
        }
        const bounds = result.layers.effInflow;
        if (bounds) assert.ok(bounds.baseP >= bounds.topP);
    }
});

test('missing surface moisture nulls the surface parcel without throwing or leaking NaN', () => {
    const col = unstableColumn(...straightWinds());
    col.td[0] = NaN;
    col.surface.td = NaN;
    const result = analyzeSounding(col);
    assertAllFinite(result);
    for (const [key, value] of Object.entries(result.parcels.sb)) {
        assert.deepEqual(value, key === 'trace' ? [] : null);
    }
});

test('missing fields anywhere in the column do not leak non-finite results', () => {
    for (const field of ['p', 'z', 't', 'td', 'u', 'v']) {
        for (const index of [0, 5, LEVELS.length - 1, 'all']) {
            const col = unstableColumn(...straightWinds());
            if (index === 'all') col[field].fill(NaN);
            else col[field][index] = NaN;
            assertAllFinite(analyzeSounding(col));
        }
    }
});

test('analysis cache uses column content and motion options, while the parcel kernel is deterministic', () => {
    const col = unstableColumn(...straightWinds());
    const first = analyzeSounding(col);
    assert.strictEqual(analyzeSounding(col), first);
    assert.strictEqual(analyzeSounding(unstableColumn(...straightWinds())), first);
    const changedMotion = analyzeSounding(col, { stormMotion: { kind: 'bunkers-left' } });
    assert.notStrictEqual(changedMotion, first);
    assert.deepEqual(changedMotion.parcels, first.parcels);
    const def = surfaceParcelDef(col);
    assert.deepEqual(liftColumn(col, def), liftColumn(col, def));
    col.t[0] += 1;
    assert.notStrictEqual(analyzeSounding(col), first);
});

test('motion resolution selects each mover and interprets user direction as meteorological FROM', () => {
    const motions = { right: { u: 1, v: 2 }, left: { u: 3, v: 4 }, mean06: { u: 5, v: 6 } };
    assert.strictEqual(resolveMotion(undefined, motions), motions.right);
    assert.strictEqual(resolveMotion({ kind: 'bunkers-right' }, motions), motions.right);
    assert.strictEqual(resolveMotion({ kind: 'bunkers-left' }, motions), motions.left);
    assert.strictEqual(resolveMotion({ kind: 'mean-wind' }, motions), motions.mean06);
    const west = resolveMotion({ kind: 'user', dirDeg: 270, speedMs: 10 }, motions);
    assert.ok(Math.abs(west.u - 10) < 1e-10 && Math.abs(west.v) < 1e-10);
    assert.equal(resolveMotion({ kind: 'user', dirDeg: NaN, speedMs: 10 }, motions), null);
    assert.equal(resolveMotion({ kind: 'user', dirDeg: 270, speedMs: NaN }, motions), null);
});

test('structurally empty input is the sole documented analysis error', () => {
    const col = unstableColumn();
    col.p = new Float32Array();
    assert.throws(() => analyzeSounding(col), /structurally empty column/);
});
