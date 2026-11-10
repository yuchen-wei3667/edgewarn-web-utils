import test from 'node:test';
import assert from 'node:assert/strict';
import { EnsembleReducer, parseThreshold, thresholdKey } from '../dist/ensemble.js';
import { fromHalf, HALF_NAN, toHalf } from '@edgewarn/web-utils/grib2';
import { memberIds } from '../dist/ensemble.js';
import { validateConfigs } from '../dist/registry/validate.js';
import { MODEL_CONFIGS } from '../dist/configs/index.js';

const half = (values) => Uint16Array.from(values, (v) => (Number.isNaN(v) ? HALF_NAN : toHalf(v)));
const reduce = (stat, members, threshold) => {
    const r = new EnsembleReducer(members[0].length, stat, threshold);
    for (const m of members) r.add(half(m));
    return Array.from(r.result(), fromHalf);
};
const MEMBERS = [[1, 2, NaN, NaN], [3, 2, 5, NaN], [5, 2, 7, NaN]];

test('mean, sd, min, max skip missing members per cell', () => {
    assert.deepEqual(reduce('mean', MEMBERS).slice(0, 3), [3, 2, 6]);
    const sd = reduce('sd', MEMBERS);
    assert.equal(sd[0], 2);
    assert.equal(sd[1], 0);
    assert.ok(Math.abs(sd[2] - Math.SQRT2 * 1) < 0.01);
    assert.deepEqual(reduce('min', MEMBERS).slice(0, 3), [1, 2, 5]);
    assert.deepEqual(reduce('max', MEMBERS).slice(0, 3), [5, 2, 7]);
});

test('a cell no member covers stays missing', () => {
    for (const stat of ['mean', 'sd', 'min', 'max']) assert.ok(Number.isNaN(reduce(stat, MEMBERS)[3]), stat);
});

test('sd of a single valid member is missing', () => {
    assert.ok(Number.isNaN(reduce('sd', [[4], [NaN]])[0]));
});

test('exceedance is the percent of valid members past the threshold', () => {
    assert.deepEqual(reduce('exceed', MEMBERS, { op: '>', value: 2 }).slice(0, 3), [200 / 3, 0, 100].map((v) => fromHalf(toHalf(v))));
    assert.deepEqual(reduce('exceed', MEMBERS, { op: '<', value: 2.5 }).slice(0, 3), [100 / 3, 100, 0].map((v) => fromHalf(toHalf(v))));
});

test('reducer matches a float64 reference on random fields', () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const members = Array.from({ length: 9 }, () => Array.from({ length: 50 }, () => (rnd() < 0.1 ? NaN : fromHalf(toHalf(rnd() * 40 - 10)))));
    const got = reduce('mean', members);
    const sd = reduce('sd', members);
    for (let i = 0; i < 50; i++) {
        const v = members.map((m) => m[i]).filter((x) => !Number.isNaN(x));
        const mean = v.reduce((a, b) => a + b, 0) / v.length;
        assert.ok(Math.abs(got[i] - mean) <= Math.abs(mean) * 2 ** -10 + 2 ** -10, `mean ${i}`);
        const ref = v.length > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1)) : NaN;
        if (Number.isNaN(ref)) assert.ok(Number.isNaN(sd[i]));
        else assert.ok(Math.abs(sd[i] - ref) <= ref * 2 ** -10 + 2 ** -10, `sd ${i}`);
    }
});

test('exceed needs a threshold and the size must match', () => {
    assert.throws(() => new EnsembleReducer(2, 'exceed'));
    assert.throws(() => new EnsembleReducer(2, 'mean').add(new Uint16Array(3)));
});

test('threshold text round-trips', () => {
    assert.deepEqual(parseThreshold('gt35.5'), { op: '>', value: 35.5 });
    assert.deepEqual(parseThreshold('lt-5'), { op: '<', value: -5 });
    assert.equal(thresholdKey({ op: '>', value: 35.5 }), 'gt35.5');
    assert.equal(parseThreshold('bad'), null);
});

test('member ids include the control only when it exists', () => {
    assert.deepEqual(memberIds({ perturbed: 3, control: true, addressing: 'file', stats: 'computed' }), [0, 1, 2, 3]);
    assert.deepEqual(memberIds({ perturbed: 2, control: false, addressing: 'file', stats: 'computed' }), [1, 2]);
});

test('ensemble config rules reject a clone for each rule', () => {
    const base = MODEL_CONFIGS.find((c) => c.id === 'refs');
    const clone = (over) => validateConfigs([{ ...base, ...over }]).filter((p) => /ensemble/.test(p));
    assert.deepEqual(clone({ ensemble: { perturbed: 3, control: true, addressing: 'file', stats: 'files' } }).length, 1); // url does not vary by member
    assert.ok(clone({ ensemble: { perturbed: 0, control: true, addressing: 'file', stats: 'files' } }).some((p) => /perturbed/.test(p)));
    assert.ok(clone({ ensemble: { perturbed: 3, control: true, addressing: 'index', stats: 'files' } }).some((p) => /ecmwf/.test(p)));
    assert.ok(clone({ about: { ...base.about, category: 'ai', attribution: '' } }).some((p) => /AI model/.test(p)) || validateConfigs([{ ...base, about: { ...base.about, category: 'ai', attribution: '' } }]).some((p) => /AI model/.test(p)));
});
