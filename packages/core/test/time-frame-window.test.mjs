import test from 'node:test';
import assert from 'node:assert/strict';
import { nearestFrameWindow, framesForTimeline } from '@edgewarn/web-utils/time';

const pad = (n) => String(n).padStart(2, '0');
const ts = (h, m, s = 0) => `20261012-${pad(h)}${pad(m)}${pad(s)}`;
const at = (h, m, s = 0) => new Date(Date.UTC(2026, 9, 12, h, m, s));
const MIN = 60_000;

test('each timeline frame keeps only the scan playback shows for it', () => {
    const scans = [ts(0, 0, 10), ts(0, 1, 10), ts(0, 2, 10), ts(0, 3, 10), ts(0, 4, 10)];
    assert.deepEqual(
        framesForTimeline(scans, [at(0, 0), at(0, 2), at(0, 4)], (s) => s, 5 * MIN),
        [ts(0, 0, 10), ts(0, 2, 10), ts(0, 4, 10)],
    );
});

test('frames sharing a scan load it once, and frames with no nearby scan load nothing', () => {
    const scans = [ts(0, 0), ts(0, 30)];
    assert.deepEqual(
        framesForTimeline(scans, [at(0, 0), at(0, 2), at(0, 14)], (s) => s, 5 * MIN),
        [ts(0, 0)],
    );
});

test('framesForTimeline skips frames whose timestamp does not parse', () => {
    assert.deepEqual(
        framesForTimeline(['bad', ts(0, 0)], [at(0, 0)], (s) => s, MIN),
        [ts(0, 0)],
    );
});

test('nearestFrameWindow keeps the closest frames, older first on ties, returned oldest first', () => {
    const frames = [ts(0, 0), ts(0, 10), ts(0, 20), ts(0, 30), 'bad'];
    assert.deepEqual(nearestFrameWindow(frames, at(0, 15), 2, (s) => s), [ts(0, 10), ts(0, 20)]);
    assert.deepEqual(nearestFrameWindow(frames, at(0, 15), 3, (s) => s), [ts(0, 0), ts(0, 10), ts(0, 20)]);
    assert.deepEqual(nearestFrameWindow(frames, at(0, 30), 1, (s) => s), [ts(0, 30)]);
    assert.deepEqual(nearestFrameWindow([], at(0, 0), 3, (s) => s), []);
});

test('nearestFrameWindow does not mutate its input', () => {
    const frames = [ts(0, 20), ts(0, 0)];
    nearestFrameWindow(frames, at(0, 0), 1, (s) => s);
    assert.deepEqual(frames, [ts(0, 20), ts(0, 0)]);
});
