import test from 'node:test';
import assert from 'node:assert/strict';
import { parseExpr, ExprError } from '../dist/compare/expr/parse.js';
import { checkExpr } from '../dist/compare/expr/check.js';
import { evaluate } from '../dist/compare/expr/vm.js';
import { alignSteps } from '../dist/compare/align.js';
import { relate, chooseReference } from '../dist/compare/gridRelation.js';
import { regridLevel } from '../dist/compare/regrid.js';
import { diffSpec, absDiffSpec, percentDiffSpec, zscoreSpec, blendSpec, runDeltaSpec } from '../dist/compare/presets.js';
import { resolveComparison } from '../dist/compare/resolve.js';
import { runPair } from '../dist/compare/runs.js';
import { getDataset } from '../dist/datasets.js';
import { comparisonHash } from '../dist/compare/identity.js';
const units = [{ id: 'a', units: 'm', ratioScale: true }, { id: 'b', units: 'm', ratioScale: true }];
const grid = { projection: 'latlon', nx: 4, ny: 3, lat1: -90, lon1: 0, dlat: 90, dlon: 90, scanMode: 64, radiusM: 6371229 };
const calc = (expr, a = [2], b = [1]) => evaluate(parseExpr(expr), { a: Float32Array.from(a), b: Float32Array.from(b) }, a.length).data;
test('precedence, constants, missing and renormalizing blends', () => {
    assert.equal(calc('-2^2 + 2^3^2')[0], 508);
    assert.equal(calc('wavg(a,1,b,3)', [NaN], [4])[0], 4);
    assert.ok(Number.isNaN(calc('a > b', [NaN])[0]));
    assert.equal(calc('where(valid(a),a,b)', [NaN], [7])[0], 7);
    assert.ok(Number.isNaN(calc('a / b', [2], [0])[0]));
    assert.equal(checkExpr('a - b', units).valueKind, 'delta');
    assert.equal(checkExpr('100 * (a - b) / b', units).valueKind, 'percent');
    assert.throws(() => checkExpr('a + b', [units[0], { id: 'b', units: 'degC' }]), ExprError);
    assert.throws(() => checkExpr('100 * (a - b) / b', units.map(x => ({ ...x, ratioScale: false }))), ExprError);
});
test('sandbox rejects hostile text and bounded fuzz never escapes ExprError', () => {
    for (const text of ['constructor', '__proto__', 'a.b', 'a[0]', '`x`', '"x"', 'import(x)', 'process', 'globalThis', "Function('x')", '1e999', '0x10', 'а', 'x'.repeat(100000)]) assert.throws(() => parseExpr(text), ExprError);
    let seed = 7;
    for (let n = 0; n < 5000; n++) {
        let text = '';
        for (let i = 0; i < n % 40; i++) { seed = (seed * 16807) % 2147483647; text += 'ab+*/().[]012foo'[seed % 15]; }
        try { parseExpr(text); } catch (e) { assert.ok(e instanceof ExprError); }
    }
});
test('register chunks match independent arithmetic with missing and overflow', () => {
    for (const size of [1, 4095, 4096, 4097]) {
        const a = Array.from({ length: size }, (_, i) => i / 32), b = a.map(x => x / 2);
        const values = calc('(a - b) * 2', a, b);
        for (let i = 0; i < size; i++) assert.equal(values[i], a[i]);
    }
    assert.equal(evaluate(parseExpr('exp(100)'), {}, 1).overflow, 1);
});
test('grid relation and longitude shift preserve cell data', () => {
    assert.equal(relate(grid, grid), 'identical');
    const shifted = { ...grid, lon1: 180 };
    assert.equal(relate(grid, shifted), 'shift');
    const data = Float32Array.from({ length: 12 }, (_, i) => i);
    assert.deepEqual([...regridLevel(data, grid, 1, grid, 1).data], [...data]);
    assert.deepEqual([...regridLevel(data, shifted, 1, grid, 1).data].slice(0, 4), [2, 3, 0, 1]);
    assert.equal(chooseReference('coarsest', [{ id: 'a', grid }, { id: 'b', grid: { ...grid, nx: 8, dlon: 45 } }]), 'a');
    const missing = regridLevel(new Float32Array(12).fill(NaN), grid, 1, grid, 1);
    assert.equal(missing.report.coverage, 0);
});
test('alignment excludes unpublished steps, never extrapolates and labels held steps', () => {
    const steps = (times) => times.map(minutes => ({ minutes, validMs: minutes * 60000, published: true }));
    const operands = [{ id: 'a', steps: steps([0, 60, 120]), interpolable: true }, { id: 'b', steps: steps([0, 120]), interpolable: true }];
    assert.deepEqual(alignSteps(operands, 'exact').map(x => x.validMs), [0, 7200000]);
    assert.equal(alignSteps(operands, 'hold')[1].alignment, 'held');
    assert.deepEqual(alignSteps(operands, 'interpolate')[1].per.b.map(x => x.weight), [0.5, 0.5]);
    assert.equal(alignSteps([{ ...operands[0] }, { ...operands[1], interpolable: false }], 'interpolate').length, 2);
});
test('presets resolve to concrete jobs and comparison identity includes samples', () => {
    const a = { id: 'a', model: 'hrrr', fieldId: 'tmp2m', product: 'mean', run: { kind: 'latest' } }, b = { ...a, id: 'b' };
    for (const s of [diffSpec([a,b]), absDiffSpec([a,b]), percentDiffSpec([a,b]), zscoreSpec([a,b,{...a,id:'c'}]), blendSpec([a,b],[1,3]), runDeltaSpec(a,6)]) assert.ok(parseExpr(s.expr));
    const job = resolveComparison(diffSpec([a,b]), { a: [{ initMs: 0, minutes: 60, weight: 1 }], b: [{ initMs: 0, minutes: 60, weight: 1 }] }, 'native');
    assert.notEqual(comparisonHash(job), comparisonHash({...job,expr:'b - a'}));
    assert.deepEqual(runPair(getDataset('hrrr'), 0, 6), [0, -21600000]);
});

test('older-run probe accepts a caller-supplied read-only probe', async () => {
    const { probeOlderRun } = await import('../dist/compare/runs.js');
    const result = await probeOlderRun(getDataset('hrrr'), Date.UTC(2026,9,25), 24, async () => false);
    assert.equal(result.published, 0);
});

test('seeded differential expressions agree with independent float64 arithmetic', () => {
    let seed = 17;
    const random = () => (seed = seed * 16807 % 2147483647) / 2147483647;
    for (let n = 0; n < 2000; n++) {
        const x = Math.fround(random() * 20 - 10), y = Math.fround(random() * 20 - 10);
        const c = Math.floor(random() * 8) + 1;
        const op = ['+', '-', '*', '/'][Math.floor(random() * 4)];
        const ref = op === '+' ? x + y : op === '-' ? x - y : op === '*' ? x * y : x / y;
        const actual = calc(`(a ${op} b) / ${c}`, [x], [y])[0];
        assert.ok(Math.abs(actual - ref / c) <= Math.max(1e-5, Math.abs(ref / c) * 2e-7));
    }
});
test('resampling linear analytic fields preserves values and reports coverage', () => {
    const source = {...grid,nx:5,ny:5,lat1:0,lon1:0,dlon:1,dlat:1};
    const target = {...source,nx:3,ny:3,lon1:0.5,lat1:0.5};
    const data = Float32Array.from({length:25},(_,i) => i % 5 + 2 * Math.floor(i/5));
    const result = regridLevel(data,source,1,target,1);
    for (let y=0;y<3;y++) for (let x=0;x<3;x++) assert.ok(Math.abs(result.data[y*3+x]-(x+0.5+2*(y+0.5)))<1e-5);
    assert.equal(result.report.coverage,1);
    assert.equal(result.report.method,'bilinear');
});

test('run references resolve latest, pins, offsets and reject cycles', async () => {
    const { resolveRuns } = await import('../dist/compare/runs.js');
    const a = {id:'a',model:'hrrr',product:'mean',fieldId:'HRRR_TMP_2M',run:{kind:'latest'}};
    const b = {...a,id:'b',run:{kind:'offset',from:'a',hours:6}};
    assert.deepEqual(resolveRuns([a,b],{hrrr:0}),{a:0,b:-21600000});
    assert.throws(() => resolveRuns([{...a,run:{kind:'offset',from:'b',hours:6}},b],{}), /Cyclic/);
});

test('statistic units and affine transforms are product aware', async () => {
    const { operandUnits } = await import('../dist/compare/operandUnits.js');
    const def = {units:'hPa',display:{scale:2,offset:1000}};
    assert.equal(operandUnits(def,'mean').offset,1000);
    assert.equal(operandUnits(def,'sprd').offset,0);
    assert.equal(operandUnits(def,'sprd').scale,2);
    assert.equal(operandUnits(def,'exceed').units,'%');
    assert.equal(operandUnits(def,'exceed').scale,1);
    assert.equal(operandUnits(def,'nsprd').units,'');
    assert.equal(checkExpr(' (100 * (a - b)) / b ', units).valueKind,'percent');
    assert.throws(() => checkExpr('(100 * (a - b)) / b',units.map(o=>({...o,ratioScale:false}))),ExprError);
    assert.equal(checkExpr('(a - b) * 2',units).valueKind,'delta');
    assert.throws(() => checkExpr('valid(a) + valid(b)',units),ExprError);
    assert.equal(calc(blendSpec([{id:'a'},{id:'b'}],[1e308,1e308]).expr,[2],[4])[0],3);
});

test('nonfinite decimal literals fail before execution and ratio eligibility is configured', async () => {
    assert.throws(()=>parseExpr('9'.repeat(512)),ExprError);
    const { getModelField } = await import('../dist/catalog.js');
    assert.equal(getModelField('HRRR_WIND_10M').ratioScale,true);
    assert.equal(getModelField('HRRR_SBCAPE').ratioScale,true);
    assert.equal(getModelField('HRRR_APCP_1H').ratioScale,true);
    assert.equal(getModelField('HRRR_TMP_2M').ratioScale,undefined);
    assert.equal(getModelField('HRRR_MSLP').ratioScale,undefined);
});

test('Lambert to latitude/longitude resampling agrees with an analytic latitude field', async () => {
    const { projectionFor } = await import('../dist/projection/index.js');
    const source = {...getDataset('hrrr').grid,nx:11,ny:11};
    const projection = projectionFor(source), [lat,lon] = projection.inverse(5,5);
    const target = {...grid,nx:3,ny:3,lat1:lat-0.01,lon1:lon-0.01,dlat:0.01,dlon:0.01};
    const data = Float32Array.from({length:121},(_,i)=>projection.inverse(i%11,Math.floor(i/11))[0]);
    const result = regridLevel(data,source,1,target,1);
    assert.equal(result.report.coverage,1);
    for(let y=0;y<3;y++)for(let x=0;x<3;x++)assert.ok(Math.abs(result.data[y*3+x]-(target.lat1+y*0.01))<1e-4);
});
test('functions and powers preserve honest dimensional metadata', () => {
    assert.equal(checkExpr('sqrt(a)',units).units,'custom');
    assert.equal(checkExpr('a ^ 2',units).units,'custom');
    assert.equal(checkExpr('2 ^ a',units).units,'custom');
    assert.equal(checkExpr('atan2(a,b)',units).units,'');
    assert.equal(checkExpr('sign(a)',units).units,'');
    assert.throws(()=>checkExpr('sin(a)',units),ExprError);
});
