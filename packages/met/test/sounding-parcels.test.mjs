import test from 'node:test';
import assert from 'node:assert/strict';

import { liftColumn, capeCheckColumn, dcapeColumn, surfaceParcelDef, meanLayerParcelDef, mostUnstableParcelDef, effectiveParcelDef } from '@edgewarn/web-utils/met';
import { wetLiftC, tempAtMixratioC, thetaK } from '@edgewarn/web-utils/met';
import { unstableColumn, stableColumn, mixedColumn, mkCol, LEVELS, HEIGHT_OF, assertAllFinite } from './helpers.mjs';

/** A level list with 2.5 hPa spacing from 1000 down to 200 hPa: the parcel grid of a saturated
 * lift (5 hPa mesh plus every level) collapses exactly onto this grid. */
const FINE_LEVELS = Array.from({ length: 321 }, (_, i) => 1000 - i * 2.5);

test('a saturated neutral column produces no buoyancy at all', () => {
    // The environment is chained through the same wet-lift sequence the parcel will follow, so
    // parcel and environment agree step for step: no LFC, no CIN, no lifted index.
    const t = [20];
    for (let i = 1; i < FINE_LEVELS.length; i++) {
        t[i] = wetLiftC(FINE_LEVELS[i - 1], t[i - 1], FINE_LEVELS[i]);
        assert.ok(Number.isFinite(t[i]), `chain survives to ${FINE_LEVELS[i]}`);
    }
    const col = mkCol(FINE_LEVELS, t, t.slice());
    const parcel = liftColumn(col, surfaceParcelDef(col));
    assert.ok(parcel, 'the lift itself is defined');
    assert.ok(parcel.cape === null || parcel.cape < 1, `CAPE ${parcel.cape}`);
    assert.ok(Math.abs(parcel.cin) < 1, `CIN ${parcel.cin}`);
    assert.ok(parcel.li === null || Math.abs(parcel.li) < 0.05, `LI ${parcel.li}`);
});

test('a stable dry column reports no LFC, a real negative CIN, and a defined lifted index', () => {
    const profile = stableColumn();
    const parcel = liftColumn(profile, surfaceParcelDef(profile));
    assert.ok(parcel, 'lift defined');
    assert.equal(parcel.cape, null, 'no positive area without an LFC');
    assert.ok(parcel.cin < -1, `negative buoyancy was accumulated: ${parcel.cin}`);
    assert.ok(parcel.lclP > 0 && parcel.lfcP === null && parcel.elP === null);
    assert.equal(parcel.li, null, 'the trace never reaches 500 hPa when the LCL sits above it');
    for (let k = 1; k < parcel.trace.length; k++) {
        assert.ok(parcel.trace[k].p < parcel.trace[k - 1].p, 'the trace descends in pressure');
        assert.ok(parcel.trace[k - 1].p - parcel.trace[k].p <= 5.001, 'trace spacing stays within the mesh');
    }
});

test('an unstable column yields a full parcel anatomy with the plan ordering', () => {
    const col = unstableColumn();
    const parcel = liftColumn(col, surfaceParcelDef(col));
    assert.ok(parcel);
    assert.ok(parcel.cape !== null && parcel.cape > 100, `CAPE ${parcel.cape}`);
    assert.ok(parcel.cape03 !== null && parcel.cape03 <= parcel.cape + 1e-6);
    assert.ok(parcel.cin <= 0, `CIN ${parcel.cin}`);
    assert.ok(Number.isFinite(parcel.li), `LI ${parcel.li}`);
    assert.ok(parcel.lclZagl !== null && (parcel.lfcZagl === null || parcel.lfcZagl >= parcel.lclZagl));
    assert.ok(parcel.elZagl === null || (parcel.lfcZagl !== null && parcel.elZagl > parcel.lfcZagl));
    assert.equal(parcel.trace[0].p, 1000, 'the trace starts at the parcel level');
    assert.ok(parcel.trace.length > 20, `trace sampled at strip resolution: ${parcel.trace.length}`);
});

test('the mixed-layer parcel reproduces the mixed temperature and mixing ratio at the base', () => {
    const col = mixedColumn();
    const def = meanLayerParcelDef(col);
    assert.ok(def, 'ML parcel defined');
    assert.ok(Math.abs(def.t - col.t[0]) < 0.05, `ML T ${def?.t} vs ${col.t[0]}`);
    assert.ok(Math.abs(def.td - col.td[0]) < 0.05, `ML Td ${def?.td} vs ${col.td[0]}`);
    assert.ok(Math.abs(def.p - 1000) < 1e-6);
});

test('the most unstable parcel of a mixed layer is its base level', () => {
    const col = mixedColumn();
    const def = mostUnstableParcelDef(col);
    assert.ok(def && Math.abs(def.p - col.p[0]) < 1e-6, `MU level ${def?.p}`);
});

test('the effective-layer mean parcel of a constant layer is the layer midpoint', () => {
    const col = mixedColumn();
    const pHpa = 950;
    const expectedT = 305 * (pHpa / 1000) ** 0.28571426 - 273.15;
    const expectedTd = tempAtMixratioC(12, pHpa);
    const def = effectiveParcelDef(col, 1000, 900);
    assert.ok(def);
    assert.ok(Math.abs(def.p - 950) < 1e-9);
    assert.ok(Math.abs(def.t - expectedT) < 0.05, `eff T ${def?.t} vs ${expectedT}`);
    assert.ok(Math.abs(def.td - expectedTd) < 0.05, `eff Td ${def?.td} vs ${expectedTd}`);
});

test('the cheap CAPE for layer searches agrees with the full lifter in sign and magnitude', () => {
    const col = unstableColumn();
    const def = surfaceParcelDef(col);
    const cheap = capeCheckColumn(col, def);
    const full = liftColumn(col, def);
    assert.ok(cheap.cape > 100, `cheap CAPE ${cheap.cape}`);
    assert.ok(cheap.cin <= 0.0001, `cheap CIN ${cheap.cin}`);
    assert.ok(full && full.cape !== null && Math.abs(cheap.cape - full.cape) < full.cape * 0.15, `${cheap.cape} vs ${full?.cape}`);
});

test('DCAPE is positive for a moist column and null when the moisture profile is missing', () => {
    const col = unstableColumn();
    const dcape = dcapeColumn(col);
    assert.ok(dcape !== null && dcape > 0 && dcape < 3000, `DCAPE ${dcape}`);
    const dry = mkCol(LEVELS, LEVELS.map((p) => 30 - 0.0065 * HEIGHT_OF(p)), LEVELS.map(() => Number.NaN));
    assert.equal(dcapeColumn(dry), null);
});

test('undefined parcel input gives NaN from the cheap lifter and null from the full one', () => {
    const col = unstableColumn();
    const broken = { p: Number.NaN, t: 20, td: 15 };
    const cheap = capeCheckColumn(col, broken);
    assert.ok(Number.isNaN(cheap.cape) && Number.isNaN(cheap.cin));
    assert.equal(liftColumn(col, broken), null);
    assert.equal(liftColumn(col, { p: 1100, t: 20, td: 15 }), null, 'a parcel below the surface is rejected');
});

test('an isothermal environment has no LFC and a dry adiabat keeps constant theta', () => {
    const dryAdiabat = LEVELS.map((p) => 300 * (p / 1000) ** 0.28571426 - 273.15);
    for (let i = 0; i < LEVELS.length; i++) assert.ok(Math.abs(thetaK(LEVELS[i], dryAdiabat[i]) - 300) < 1e-9);
    const col = mkCol(LEVELS, LEVELS.map(() => 20), LEVELS.map(() => 10));
    const parcel = liftColumn(col, surfaceParcelDef(col));
    assert.ok(parcel);
    assert.equal(parcel.cape, null);
    assert.equal(parcel.lfcP, null);
    assert.ok(parcel.cin < 0);
});

test('a superadiabatic surface perturbation and a high terrain surface remain analyzable', () => {
    const col = unstableColumn();
    col.t[0] += 5;
    const perturbed = liftColumn(col, surfaceParcelDef(col));
    assert.ok(perturbed);
    assertAllFinite(perturbed);
    const levels = LEVELS.filter((p) => p <= 800);
    const high = mkCol(levels, levels.map((p) => 20 - 0.0065 * (HEIGHT_OF(p) - 2000)), levels.map((p) => 15 - 0.0065 * (HEIGHT_OF(p) - 2000)));
    const parcel = liftColumn(high, surfaceParcelDef(high));
    assert.ok(parcel);
    assertAllFinite(parcel);
    assert.equal(parcel.trace[0].p, 800);
    assert.ok(parcel.lclZagl >= 0);
});
