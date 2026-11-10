import test from 'node:test';
import assert from 'node:assert/strict';
import { lightningWindow, sampleLightning, selectLightningCandidate } from '@edgewarn/web-utils/mrms';

const NOW = Date.UTC(2026, 9, 14, 18, 2);
const reading = (stage, extra = {}) => ({ stage, issuedAtMs: NOW, probability: null, distanceMiles: null, ...extra });
const candidate = (stage, extra) => selectLightningCandidate([reading(stage, extra)], NOW);

test('probability thresholds match the agreed level-6 cap', () => {
    for (const [stage, probability, threat] of [
        ['probability60', 19.9, null], ['probability60', 20, 8], ['probability60', 49.9, 8],
        ['probability60', 50, 6], ['probability30', 20, 6], ['probability30', 100, 6],
        ['probability30', 0, null], ['probability30', NaN, null], ['probability30', 101, null],
    ]) assert.equal(candidate(stage, { probability })?.threatLevel ?? null, threat);
});

test('15- and 5-minute density use distance bands without increasing severity from magnitude', () => {
    for (const [stage, distanceMiles, threat] of [
        ['activity15', 10, 6], ['activity15', 10.01, 8], ['activity15', 25, 8],
        ['activity5', 10, 6], ['activity5', 25, 6], ['activity5', 25.01, null],
        ['activity5', NaN, null], ['activity15', -1, null],
    ]) assert.equal(candidate(stage, { distanceMiles })?.threatLevel ?? null, threat);
    assert.equal(candidate('activity15', { distanceMiles: 3 }).title, 'Lightning detected within 3 miles');
});

test('strongest evidence wins; equal levels progress from 60 to 30 to 15 to 5', () => {
    const readings = [reading('probability60', { probability: 80 }), reading('probability30', { probability: 40 }),
        reading('activity15', { distanceMiles: 5 }), reading('activity5', { distanceMiles: 20 })];
    for (let length = 1; length <= 4; length++) {
        assert.equal(selectLightningCandidate(readings.slice(0, length), NOW).stage, readings[length - 1].stage);
    }
    assert.equal(selectLightningCandidate([reading('activity15', { distanceMiles: 20 }), readings[0]], NOW).stage, 'probability60');
    assert.equal(selectLightningCandidate([reading('probability30', { probability: 0 }), readings[3]], NOW).stage, 'activity5');
});

test('freshness is source-based and probability windows shrink without becoming arrival times', () => {
    assert.equal(selectLightningCandidate([reading('activity5', { distanceMiles: 1 })], NOW + 5 * 60_000 + 1), null);
    assert.equal(selectLightningCandidate([reading('probability30', { probability: 80 })], NOW + 6 * 60_000 + 1), null);
    assert.equal(selectLightningCandidate([reading('activity15', { distanceMiles: 1, issuedAtMs: NOW + 60_001 })], NOW), null);
    const result = selectLightningCandidate([reading('probability30', { probability: 80 })], NOW + 4 * 60_000);
    assert.equal(result.detail, '80% chance of lightning within 26 minutes.');
});

const grid = { ni: 3, nj: 3, lat1: 40.01, lon1: 259.99, lat2: 39.99, lon2: 260.01,
    di: 0.01, dj: 0.01, scanMode: 0, R: 0, E: 0, D: 0, nbits: 16, refTime: new Date(NOW).toISOString() };
const windowMessage = values => ({ type: 'window', jobId: 1, grid, rows: [0, 2], cols: [0, 2], data: new Float32Array(values).buffer });

test('probability samples only the containing grid cell and preserves unknown coverage', () => {
    const location = { lat: 40, lon: -100 };
    for (const missing of [NaN, 0, -1, -3, -99900]) {
        assert.equal(sampleLightning('probability30', location, windowMessage([100, 100, 100, 100, missing, 100, 100, 100, 100])).probability, null);
    }
    assert.equal(sampleLightning('probability30', location, windowMessage([100, 100, 100, 100, 30, 100, 100, 100, 100])).probability, 30);
});

test('NLDN sampling normalizes longitude and finds nearest active cell, ignoring missing values', () => {
    const value = sampleLightning('activity5', { lat: 40, lon: -100 }, windowMessage([-1, NaN, 0, -3, 0, 0.001, 0, 0, 10]));
    assert.ok(value.distanceMiles > 0.5 && value.distanceMiles < 0.6);
    assert.equal(sampleLightning('activity5', { lat: 45, lon: -100 }, windowMessage(Array(9).fill(1))).distanceMiles, null);
    assert.throws(() => sampleLightning('activity5', { lat: 40, lon: -100 }, windowMessage([1])), /Incomplete/);
});

test('regional windows reject locations outside CONUS and clamp domain edges', () => {
    assert.equal(lightningWindow({ lat: 65, lon: -150 }), null);
    assert.equal(lightningWindow({ lat: NaN, lon: -100 }), null);
    const edge = lightningWindow({ lat: 54.995, lon: -129.995 });
    assert.equal(edge.rows[0], 0);
    assert.equal(edge.cols[0], 0);
    assert.ok(edge.rows[1] > 0 && edge.cols[1] > 0);
});
