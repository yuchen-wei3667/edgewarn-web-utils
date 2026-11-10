import test from 'node:test';
import assert from 'node:assert/strict';
import * as c from '@edgewarn/web-utils/colormap';

const cloud = {
    name: 'Cloud Cover',
    description: 'White, opacity linear in coverage',
    type: 'HRRR_CloudCover',
    units: '%',
    interpolate: true,
    interpolateAlpha: true,
    range: [0, 100],
    thresholds: [
        { value: 0, rgb: [255, 255, 255], alpha: 0 },
        { value: 100, rgb: [255, 255, 255], alpha: 255 },
    ],
};
const stepped = {
    name: 'Stepped',
    description: '',
    type: 'Stepped',
    units: 'dBZ',
    interpolate: false,
    range: [0, 60],
    thresholds: [
        { value: 0, rgb: [0, 0, 255] },
        { value: 20, rgb: [0, 255, 0] },
        { value: 40, rgb: [255, 0, 0], alpha: 128 },
    ],
};
const smooth = { ...stepped, name: 'Smooth', type: 'Smooth', interpolate: true, range: [0, 100], thresholds: [
    { value: 0, rgb: [0, 0, 255] }, { value: 45, rgb: [255, 255, 255] }, { value: 100, rgb: [255, 0, 0] },
] };

test('exports the documented runtime names', () => {
    assert.deepEqual(Object.keys(c).sort(), [
        'colormapStops', 'createColormapTextureData', 'extractColormaps', 'findColormapByKey', 'formatLegendValue',
        'getColormapTicks', 'isValidRgb', 'mapValueToRgba', 'normalizeColormapKey', 'thinColormapTicks',
    ]);
});

test('cloud cover uses white with opacity linear from zero to full coverage', () => {
    for (const value of [0, 1, 10, 25, 50, 75, 99, 100]) {
        assert.deepEqual(c.mapValueToRgba(value, cloud, cloud.range), [255, 255, 255, Math.round((value * 255) / 100)]);
    }
    const texture = c.createColormapTextureData(cloud, cloud.range, 101);
    for (let value = 0; value <= 100; value++) {
        assert.deepEqual([...texture.slice(value * 4, value * 4 + 4)], [255, 255, 255, Math.round((value * 255) / 100)]);
    }
    const cutoff = { ...cloud, interpolateAlpha: undefined };
    assert.deepEqual(c.mapValueToRgba(50, cutoff, cutoff.range), [255, 255, 255, 255], 'transparent cutoff stays the default');
});

test('stepped and interpolated lookups, clamping and the grey fallback', () => {
    assert.deepEqual(c.mapValueToRgba(-5, stepped, stepped.range), [0, 0, 255, 255]);
    assert.deepEqual(c.mapValueToRgba(25, stepped, stepped.range), [0, 255, 0, 255]);
    assert.deepEqual(c.mapValueToRgba(50, stepped, stepped.range), [255, 0, 0, 128]);
    assert.deepEqual(c.mapValueToRgba(-1, smooth, smooth.range), [0, 0, 255, 255]);
    assert.deepEqual(c.mapValueToRgba(200, smooth, smooth.range), [255, 0, 0, 255]);
    assert.deepEqual(c.mapValueToRgba(22.5, smooth, smooth.range), [128, 128, 255, 255]);
    assert.deepEqual(c.mapValueToRgba(0, null, [0, 10]), [32, 32, 32, 255]);
    assert.deepEqual(c.mapValueToRgba(10, null, [0, 10]), [240, 240, 240, 255]);
    assert.deepEqual(c.mapValueToRgba(5, { ...stepped, thresholds: [{ value: 0, rgb: ['x', 1, 2] }] }, [0, 10]), [136, 136, 136, 255]);
});

test('texture data is size x 4 bytes and a single texel samples the range minimum', () => {
    assert.equal(c.createColormapTextureData(stepped, stepped.range, 8).length, 32);
    assert.deepEqual([...c.createColormapTextureData(stepped, stepped.range, 1)], [0, 0, 255, 255]);
});

test('lookup by key matches name or type exactly, then ignoring case and punctuation', () => {
    const maps = [stepped, cloud];
    assert.equal(c.findColormapByKey(maps, 'Stepped'), stepped);
    assert.equal(c.findColormapByKey(maps, 'hrrr cloud-cover'), cloud);
    assert.equal(c.findColormapByKey(maps, 'hrrr'), null);
    assert.equal(c.findColormapByKey(maps, 'HRRR_cloudcover'), cloud);
    assert.equal(c.findColormapByKey(maps, 'cloud cover'), cloud);
    assert.equal(c.findColormapByKey(maps, '--'), null);
    assert.equal(c.normalizeColormapKey('GOES_ABI-C07'), 'goesabic07');
    assert.equal(c.isValidRgb([1, 2, 3]), true);
    assert.equal(c.isValidRgb([1, 2]), false);
    assert.equal(c.isValidRgb([1, NaN, 3]), false);
    assert.equal(c.isValidRgb('abc'), false);
});

test('extractColormaps accepts flat lists, grouped payloads and a single group, and normalizes thresholds', () => {
    const raw = { ...stepped, thresholds: [
        { value: '5', rgba: [1.4, 2.6, 3, 300] },
        { value: 10, rgb: [4, 5, 6] },
        { value: 'x', rgb: [0, 0, 0] },
        { value: 20, rgb: ['a', 0, 0] },
        null,
    ] };
    const expected = [{ ...stepped, thresholds: [{ value: 5, rgb: [1, 3, 3], alpha: 255 }, { value: 10, rgb: [4, 5, 6] }] }];
    assert.deepEqual(c.extractColormaps([raw]), expected);
    assert.deepEqual(c.extractColormaps([{ source: 's', product: 'p', version: '1', colormaps: [raw, { name: 1 }] }]), expected);
    assert.deepEqual(c.extractColormaps({ source: 's', product: 'p', version: '1', colormaps: [raw] }), expected);
    assert.deepEqual(c.extractColormaps([{ ...stepped, thresholds: [{ value: 'x', rgb: [0, 0, 0] }] }]), []);
    for (const payload of [null, 'x', 3, {}, [null, 4]]) assert.deepEqual(c.extractColormaps(payload), []);
});

test('legend stops: one per threshold when interpolated, hard pairs when stepped or uniform', () => {
    assert.deepEqual(c.colormapStops(smooth).map((s) => s.percent), [0, 45, 100]);
    assert.deepEqual(c.colormapStops({ ...smooth, interpolate: false }).map((s) => s.percent), [0, 45, 45, 100, 100, 100]);
    assert.deepEqual(c.colormapStops({ ...stepped, uniformBlocks: true }).map((s) => Math.round(s.percent)), [0, 33, 33, 67, 67, 100]);
    assert.deepEqual(c.colormapStops({ ...smooth, range: [1, 1] }), [{ rgb: [0, 0, 255], percent: 0 }, { rgb: [0, 0, 255], percent: 100 }]);
    assert.deepEqual(c.colormapStops(null), []);
    assert.deepEqual(c.colormapStops({ ...smooth, thresholds: [] }), []);
});

test('legend ticks are rounded to 1, 2 or 5 steps, uniform blocks use thresholds, and thinning keeps every nth', () => {
    assert.deepEqual(c.getColormapTicks(smooth, 5).map((t) => t.value), [0, 20, 40, 60, 80, 100]);
    assert.deepEqual(c.getColormapTicks(smooth, 5).map((t) => t.percent), [0, 20, 40, 60, 80, 100]);
    assert.deepEqual(c.getColormapTicks({ ...stepped, uniformBlocks: true }).map((t) => t.value), [0, 20, 40]);
    assert.deepEqual(c.getColormapTicks({ ...smooth, range: [3, 3] }), [{ value: 3, percent: 0 }]);
    assert.deepEqual(c.getColormapTicks(null), []);
    const ticks = c.getColormapTicks(smooth, 10);
    assert.equal(c.thinColormapTicks(ticks, 100), ticks);
    assert.deepEqual(c.thinColormapTicks(ticks, 4).map((t) => t.value), [0, 30, 60, 90]);
    assert.equal(c.formatLegendValue(5), '5');
    assert.equal(c.formatLegendValue(2.55), '2.5');
});
