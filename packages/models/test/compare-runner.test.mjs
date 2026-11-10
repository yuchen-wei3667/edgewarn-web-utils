import test from 'node:test';
import assert from 'node:assert/strict';
import { runComparison } from '../dist/compare/compareRunner.js';
import { getDataset } from '../dist/datasets.js';
import { getModelField, inputsFor } from '../dist/catalog.js';
import { projectionFor } from '../dist/projection/index.js';
import { fromHalf, toHalf } from '@edgewarn/web-utils/grib2';
import { ModelMissing } from '../dist/sources/errors.js';
const initMs = Date.UTC(2026,9,25);
const operand = id => ({id,model:'hrrr',product:'mean',fieldId:'HRRR_TMP_2M',samples:[{initMs,minutes:60,weight:1}]});
function request(expr = 'a - b') {
    return {type:'decode',jobId:1,model:'hrrr',product:'mean',fieldId:'cmp~test',initMs:initMs+3600000,minutes:0,level:0,tiles:[{tx:0,ty:0}],compare:{v:1,expr,reference:'hrrr',alignment:'native',operands:[operand('a'),operand('b')]}};
}
test('runner interpolates, preserves incomplete ensembles, rejects missing operands and cancels', async () => {
    const dataset = getDataset('hrrr'), saved = {grid:dataset.grid,factors:dataset.factors};
    dataset.grid = {...dataset.grid,nx:3,ny:3}; dataset.factors = [1,2,3];
    const def = getModelField('HRRR_TMP_2M');
    const reads = [];
    const produce = async req => {
        reads.push(req);
        return {combined:{data:Uint16Array.from(new Array(9).fill(req.minutes),toHalf),channels:1},grid:dataset.grid,proj:projectionFor(dataset.grid),reads:[],fetched:1,
            ensemble:{product:'mean',membersUsed:2,membersExpected:3},def,selectors:inputsFor(def,'hrrr'),dataset};
    };
    try {
        const req = request(); req.compare.alignment = 'interpolated';
        req.compare.operands[0].samples = [{initMs,minutes:0,weight:0.5},{initMs,minutes:120,weight:0.5}];
        const result = await runComparison(req,produce,()=>{});
        assert.deepEqual([...result.combined.data].map(fromHalf),new Array(9).fill(0));
        assert.equal(reads.length,3);
        assert.ok(result.compare.incomplete.some(s=>s.includes('2 of 3')));
        assert.equal(result.compare.operands[0].regrid.coverage,1);
        await assert.rejects(()=>runComparison(request(),async()=>{throw new ModelMissing('unpublished');},()=>{}),/a: unpublished/);
        await assert.rejects(()=>runComparison(request(),produce,()=>{throw new Error('cancelled');}),/cancelled/);
        const bad = request(); bad.compare.operands[0].samples[0].minutes=120;
        await assert.rejects(()=>runComparison(bad,produce,()=>{}),/Future sample/);
        const missing = request(); missing.compare.operands[0].samples=[];
        await assert.rejects(()=>runComparison(missing,produce,()=>{}),/Invalid samples/);
        const over = request(); dataset.grid={...dataset.grid,nx:100000,ny:100000};
        const prior = reads.length;
        await assert.rejects(()=>runComparison(over,produce,()=>{}),/memory budget/);
        assert.equal(reads.length,prior);
    } finally {Object.assign(dataset,saved);}
});

test('a moving-grid model is refused as a comparison operand, naming the operand and the model', async () => {
    const { refuseMovingGrid } = await import('../dist/compare/gridRelation.js');
    const { getDataset, MODEL_IDS } = await import('../dist/datasets.js');
    const moving = MODEL_IDS.find((id) => getDataset(id).movingGrid);
    assert.ok(moving, 'a storm-following nest is registered');
    assert.throws(() => refuseMovingGrid(moving, 'Operand A'), (e) => e.message.startsWith('Operand A: ') && e.message.includes(getDataset(moving).label) && /cannot be compared/.test(e.message));
    assert.doesNotThrow(() => refuseMovingGrid('hrrr', 'Operand A'));
});
