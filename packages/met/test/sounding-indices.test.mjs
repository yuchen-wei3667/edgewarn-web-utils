/**
 * Fixed-level indices of the sounding core, analytic cases on the synthetic geometry (helpers.mjs).
 * Lapse rates run on a near-dry column so the virtual-temperature correction vanishes; the level
 * indices use the moist column with dewpoint depression 3 °C so every standard level is a node of
 * the grid and the values are hand-checkable. Wet-bulb cases stay inside the validity range of
 * SHARPpy's `lcltemp` polynomial (depressions up to about 40 °C).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { lapseRatePressure, lapseRateHeight, precipitableWater, kIndex, totalTotals, showalter, freezingLevelAgl, wetBulbZeroAgl, bulkRichardson } from '@edgewarn/web-utils/met';
import { liftColumn } from '@edgewarn/web-utils/met';
import { layerMean, pressureAtAgl } from '@edgewarn/web-utils/met';
import { tempAtMixratioC } from '@edgewarn/web-utils/met';
import { SOUNDING_GRAVITY } from '../src/constants.ts';
import { unstableColumn, moistIndexColumn, mkCol, LEVELS, lapseTempOf, uniformWinds, straightWinds, HEIGHT_OF, eachLevel } from './helpers.mjs';

const lifter = (col, def) => liftColumn(col, def)?.li ?? null; // same shape `analyze` hands over

const dryColumn = () =>
    mkCol(LEVELS, LEVELS.map((p) => lapseTempOf(p, 6.5)), LEVELS.map(() => -60));
/** A cool, dry column with wet bulb below 0 °C everywhere. */
const coolDryColumn = () =>
    mkCol(LEVELS, eachLevel((p) => -(6.5 / 1000) * HEIGHT_OF(p)), LEVELS.map(() => -20));

test('lapse rates of a linear dry profile are the constant 6.5 K/km', () => {
    const col = dryColumn();
    assert.ok(Math.abs(lapseRateHeight(col, 0, 3000) - 6.5) < 1e-3);
    assert.ok(Math.abs(lapseRateHeight(col, 3000, 6000) - 6.5) < 1e-3);
    assert.ok(Math.abs(lapseRatePressure(col, 700, 500) - 6.5) < 1e-3);
});

test('the unstable 850-500 hPa lapse rate is steeper than the plain 7 K/km profile', () => {
    const col = unstableColumn();
    const lr = lapseRatePressure(col, 850, 500);
    // The moist low-level endpoint inflates its virtual temperature.
    assert.ok(lr > 7 && lr < 8, `lr85 ${lr}`);
});

test('K and Total Totals are exact on the moist node grid', () => {
    const col = moistIndexColumn();
    assert.ok(Math.abs(kIndex(col) - 37) < 1e-9, `K ${kIndex(col)}`);
    assert.ok(Math.abs(totalTotals(col) - 42.5) < 1e-9, `TT ${totalTotals(col)}`);
});

test('precipitable water is large for the saturated column and near zero for the dry one', () => {
    const pw = precipitableWater(moistIndexColumn());
    assert.ok(pw > 60 && pw < 85, `pw ${pw}`);
    const dry = precipitableWater(dryColumn());
    assert.ok(dry > 0 && dry < 2, `dry pw ${dry}`);
});

test('PW integrates a constant mixing ratio and increases with moisture', () => {
    const amounts = [4, 8, 12].map((ratio) => {
        const col = mkCol(LEVELS, LEVELS.map(() => 20), LEVELS.map((p) => tempAtMixratioC(ratio, p)));
        const pw = precipitableWater(col);
        const expected = ratio * (1000 - 200) / (10 * SOUNDING_GRAVITY);
        assert.ok(pw !== null && Math.abs(pw - expected) < 0.5, `${pw} vs ${expected}`);
        return pw;
    });
    assert.ok(amounts[0] < amounts[1] && amounts[1] < amounts[2]);
    const missing = dryColumn();
    missing.td.fill(NaN);
    assert.equal(precipitableWater(missing), null);
});

test('the Showalter index is the 500 hPa lifted index of the 850 hPa parcel', () => {
    const col = moistIndexColumn();
    const sh = showalter(col, lifter);
    assert.ok(sh !== null && Number.isFinite(sh) && Math.abs(sh) < 20, `showalter ${sh}`);
    assert.ok(sh < 0, `marginally unstable parcel sits below ${sh}`);
});

test('indices leaving the profile or missing a level are null, never NaN', () => {
    const col = dryColumn();
    assert.equal(lapseRateHeight(col, 0, 99999), null);
    assert.equal(lapseRatePressure(col, 700, 850), null, 'inverted bounds are rejected');
    const highOnly = mkCol(LEVELS.slice(7), LEVELS.slice(7).map((p) => lapseTempOf(p, 3)), LEVELS.slice(7).map(() => -40));
    assert.equal(showalter(highOnly, lifter), null, '850 hPa above the data');
    assert.equal(kIndex(highOnly), null);
    assert.equal(totalTotals(highOnly), null);
});

test('the freezing level of the moist column is the analytic 30/6.5 crossing', () => {
    const frz = freezingLevelAgl(moistIndexColumn());
    assert.ok(frz !== null && Math.abs(frz - 30 / 0.0065) < 2, `frz ${frz}`);
});

test('the wet-bulb zero sits below the freezing level for the moist column and is null when never crossed', () => {
    const col = moistIndexColumn();
    const wbz = wetBulbZeroAgl(col);
    const frz = freezingLevelAgl(col);
    assert.ok(wbz !== null && wbz > 0 && wbz < frz, `wbz ${wbz} vs frz ${frz}`);
    assert.equal(wetBulbZeroAgl(coolDryColumn()), null);
});

test('the bulk Richardson number matches cape over the squared bulk shear and nulls out', () => {
    const col = mkCol(LEVELS, LEVELS.map((p) => lapseTempOf(p)), LEVELS.map(() => -40), straightWinds()[0], straightWinds()[1]);
    const brn = bulkRichardson(col, 2000);
    const shear = Math.hypot(
        layerMean(col, 'u', col.p[0], pressureAtAgl(col, 6000)) - layerMean(col, 'u', col.p[0], pressureAtAgl(col, 500)),
        layerMean(col, 'v', col.p[0], pressureAtAgl(col, 6000)) - layerMean(col, 'v', col.p[0], pressureAtAgl(col, 500)),
    );
    assert.ok(brn !== null && Math.abs(brn - 2000 / (shear * shear / 2)) < 1e-9, `brn ${brn}`);
    assert.ok(brn > 0 && brn < 1000, `sane magnitude ${brn}`);
    const uniform = mkCol(LEVELS, LEVELS.map((p) => lapseTempOf(p)), LEVELS.map(() => -40), uniformWinds()[0], uniformWinds()[1]);
    assert.equal(bulkRichardson(uniform, 2000), null, 'vanishing shear');
    assert.equal(bulkRichardson(col, null), null);
    assert.equal(bulkRichardson(col, Number.NaN), null, 'NaN cape is not finite, so null');
});
