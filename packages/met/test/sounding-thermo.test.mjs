import test from 'node:test';
import assert from 'node:assert/strict';

import { thetaK, thetaC, temperatureFromThetaC, lclTempC, lclPressureHpa, dryLift, dryLiftToC, virtualTemperatureC, wobf, satLiftC, wetLiftC, wetBulbC, tempAtMixratioC } from '@edgewarn/web-utils/met';
import { mixingRatioHpa, saturationVapourPressure, lclTemperatureK, equivalentPotentialTemperature } from '@edgewarn/web-utils/met';
import { heightAt, pressureAt, heightsAgl, levelOfTemperature, isLayerValid } from '@edgewarn/web-utils/met';
import { moistIndexColumn } from './helpers.mjs';

test('Bolton vapour pressure agrees with rounded saturation table values', () => {
    for (const [temperature, hPa] of [[0, 6.112], [20, 23.37], [30, 42.46]]) {
        assert.ok(Math.abs(saturationVapourPressure(temperature) - hPa) < 0.02);
    }
    assert.equal(lclTemperatureK(293.15, 293.15), 293.15);
    const tl = lclTemperatureK(298.15, 288.15);
    assert.ok(tl < 288.15 && tl > 280);
    assert.ok(equivalentPotentialTemperature(1000, 25, 20) > equivalentPotentialTemperature(1000, 25, 10));
});

test('vertical interpolation preserves nodes, brackets crossings and rejects invalid layers', () => {
    const col = moistIndexColumn();
    assert.equal(heightAt(col, 700), 3000);
    assert.equal(pressureAt(col, 3000), 700);
    assert.deepEqual(heightsAgl(col), col.z);
    const crossing = levelOfTemperature(col, 0);
    assert.ok(crossing < 550 && crossing > 525);
    assert.ok(Number.isNaN(levelOfTemperature(col, 100)));
    assert.ok(Number.isNaN(heightAt(col, 1100)));
    assert.ok(Number.isNaN(pressureAt(col, -100)));
    assert.equal(isLayerValid(col, 1000, 500), true);
    assert.equal(isLayerValid(col, 500, 1000), false);
    assert.equal(isLayerValid(col, 1000, 100), false);
});

test('potential temperature round-trips along its own dry adiabat', () => {
    const t = 25;
    const theta = thetaC(850, t);
    assert.ok(Math.abs(temperatureFromThetaC(theta, 850) - t) < 1e-9);
    // ascending with the same theta keeps it constant
    assert.ok(Math.abs(thetaC(700, temperatureFromThetaC(theta, 700)) - theta) < 1e-9);
    // theta in K is the same value shifted
    assert.ok(Math.abs((thetaK(850, t) - 273.15) - theta) < 1e-9);
});

test('a saturated parcel keeps its LCL at the level it starts from', () => {
    const p = 1000;
    const t = 20;
    assert.ok(Math.abs(lclTempC(t, t) - t) < 1e-12);
    const lcl = dryLift(p, t, t);
    assert.ok(Math.abs(lcl.p - p) < 1e-9 && Math.abs(lcl.t - t) < 1e-9);
});

test('the LCL preserves the parcel mixing ratio to the accuracy of the SHARPpy dry lift', () => {
    const p = 1000;
    const t = 25;
    const td = 15;
    const lcl = dryLift(p, t, td);
    const rStart = mixingRatioHpa(p, td);
    const rLcl = mixingRatioHpa(lcl.p, lcl.t);
    assert.ok(Math.abs(rLcl - rStart) < rStart * 0.005, `${rLcl} vs ${rStart}`);
});

test('the Wobus function matches its calibration value at 20 degree input', () => {
    assert.ok(Math.abs(wobf(20) - 15.13) < 1e-9);
});

test('the wet lift is the identity at its own pressure and cooler below', () => {
    const t = wetLiftC(600, -5, 600);
    assert.ok(t !== null && Math.abs(t - (-5)) < 0.01, `${t}`);
    const above = wetLiftC(600, -5, 400);
    assert.ok(above < -5, `moist ascent above cools: ${above} at 400 hPa`);
});

test('a descending dry step is exactly reversible', () => {
    const t = 10;
    assert.ok(Math.abs(dryLiftToC(700, dryLiftToC(850, t, 700), 850) - t) < 1e-6);
});

test('the virtual temperature rises with moisture and passes plain values through without it', () => {
    const dry = virtualTemperatureC(1000, 25, -60);
    assert.ok(Math.abs(dry - 25) < 0.01); // r ≈ 0.007 g/kg bends Tv by a few thousandths of a K
    const humid = virtualTemperatureC(1000, 25, 20);
    assert.ok(humid > 25 && humid < 30, `${humid}`);
    assert.ok(Number.isNaN(virtualTemperatureC(1000, Number.NaN, 20)));
    assert.equal(virtualTemperatureC(1000, 25, Number.NaN), 25);
});

test('the mixing-ratio functions invert each other', () => {
    const p = 800;
    const td = 5;
    const r = mixingRatioHpa(p, td);
    assert.ok(Math.abs(tempAtMixratioC(r, p) - td) < 0.1, `inverse gives ${tempAtMixratioC(r, p)}`);
});

test('the wet-bulb temperature sits between the temperature and the dewpoint', () => {
    const wb = wetBulbC(1000, 25, 15);
    assert.ok(wb < 25 && wb > 15, `${wb}`);
    const saturated = wetBulbC(1000, 25, 25);
    assert.ok(Math.abs(saturated - 25) < 0.01);
});

test('the saturated lift converges or reports NaN on hostile input, never throws', () => {
    assert.ok(Math.abs(satLiftC(500, 30) - satLiftC(500, 30)) < 1e-9); // deterministic
    assert.ok(Number.isFinite(satLiftC(500, 30)));
    assert.ok(Number.isNaN(satLiftC(Number.NaN, 30)));
    assert.ok(Number.isNaN(satLiftC(500, Number.NaN)));
    assert.ok(Number.isNaN(satLiftC(0, 30)));
});

test('every thermo helper answers NaN to NaN input without throwing', () => {
    for (const [name, fn] of Object.entries({
        thetaC: () => thetaC(Number.NaN, 20),
        thetaK: () => thetaK(1000, Number.NaN),
        lclTempC: () => lclTempC(Number.NaN, 15),
        lclPressureHpa: () => lclPressureHpa(1000, 25, Number.NaN),
        dryLift: () => dryLift(Number.NaN, 25, 15).p,
        tempAtMixratioC: () => tempAtMixratioC(Number.NaN, 1000),
        wobf: () => wobf(Number.NaN),
        satLiftC: () => satLiftC(500, Number.NaN),
    })) {
        assert.ok(Number.isNaN(fn()), `${name} returns NaN`);
    }
});
