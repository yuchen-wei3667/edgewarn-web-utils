import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseInventory } from './fixtures/parse-inventory.mjs';
import {
    fieldsForModel, findIdxEntry, findIdxWindowEntries, getModelField, inputsFor, MODEL_FIELDS,
    MODEL_PANES, modelHasField, modelHasIsobars, needsForecastStep, panesForModel, resolveModelFieldId,
} from '../dist/catalog.js';
import { getDataset, MODEL_IDS } from '../dist/datasets.js';
import { extractColormaps } from '@edgewarn/web-utils/colormap';
import { MODEL_CONFIGS } from '../dist/configs/index.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(ROOT, 'fixtures');
const idx = (name, model = 'hrrr') => parseInventory(getDataset(model), readFileSync(path.join(FIX, name), 'utf8'));

/**
 * Real NOAA `.idx` inventories, one per (dataset, file), at the step each dataset is probed at, listed in
 * `inventories.json` (a new model adds an entry there). These are the contract: every field a dataset lists
 * must be in them, so a field can never be offered by a dataset whose object does not have the component.
 * Entries marked `report` are other steps of the same run, read by models-nbm.test.mjs.
 */
const INVENTORIES = Object.fromEntries(
    Object.entries(JSON.parse(readFileSync(path.join(FIX, 'inventories.json'), 'utf8')))
        .filter(([, set]) => !set.report)
        .map(([name, set]) => [name, { ...set, files: Object.fromEntries(Object.entries(set.files).map(([key, file]) => [key, idx(file, set.model)])) }]),
);

/**
 * The other direction, a component carried but not offered, is held to the fields of the bucket's own
 * models. NBM and HRRR both carry a `VIL`, but NBM defining a field for it does not oblige HRRR to offer
 * one: what a bucket's models offer is decided by those models' configs.
 */
const inScope = (def, model) => def.models.some((m) => getDataset(m).bucket === getDataset(model).bucket);

/** Which components a field needs from one dataset, resolving selector files onto the dataset's own. */
function locate(def, model, set) {
    const dataset = getDataset(model);
    const product = set.product ?? 'mean';
    return inputsFor(def, model).map((sel) => {
        // A dataset with no object for the selector's source cannot carry the component.
        let file;
        try { file = dataset.fileOf(sel.file, product); } catch { return { sel, entries: undefined, file: undefined, dataset, product }; }
        return { sel, entries: set.files[file], file, dataset, product };
    });
}

test('every field is offered by exactly the datasets whose inventories carry its components (within a bucket)', () => {
    for (const set of Object.values(INVENTORIES)) {
        const model = set.model;
        for (const def of MODEL_FIELDS) {
            // A field belongs to a product, or to none; the coverage below is per product.
            if (def.product !== undefined && def.product !== set.product) continue;
            // A `sum-window` field is only meaningful on an hour boundary, where the windows it sums
            // end, so probe it at the next whole hour rather than at the inventory's nominal step.
            const found = locate(def, model, set).every(({ sel, entries, dataset: d }) => {
                if (!entries) return false;
                const step = sel.timing === 'sum-window' ? Math.ceil(set.step / 60) * 60 : set.step;
                return sel.timing === 'sum-window'
                    ? findIdxWindowEntries(entries, sel, step, d).length === (sel.sumCount ?? 1)
                    : findIdxEntry(entries, sel, step, d, set.product) !== null;
            });
            // Which datasets offer a field is decided by its default product. The other products are
            // allowed to lack a component -- REFS's `mean` carries a surface temperature its `prob`
            // does not -- and the layer reports that as a missing component naming the object.
            if ((getDataset(model).ensembles[0] ?? 'mean') === set.product) {
                if (def.models.includes(model)) assert.ok(found, `${def.id} on ${model}: components missing`);
                else if (inScope(def, model) && !(MODEL_CONFIGS.find((c) => c.id === model)?.notOffered ?? []).some((f) => f.id === def.id)) {
                    assert.ok(!found, `${def.id} on ${model}: components found but the field is not offered`);
                }
            }
        }
    }
});

test('every probability field names a threshold its object actually publishes', () => {
    const set = INVENTORIES['refs-prob'];
    const probs = MODEL_FIELDS.filter((f) => f.product === 'prob');
    assert.equal(probs.length, 42);
    const thresholds = new Set();
    for (const def of probs) {
        const [{ sel, entries, dataset }] = locate(def, 'refs', set);
        assert.ok(sel.threshold, `${def.id} has no threshold`);
        const hit = findIdxEntry(entries, sel, set.step, dataset, 'prob');
        assert.ok(hit, `${def.id}: ${sel.threshold} is not in the prob object`);
        // Each field must name a distinct component, or two fields would draw the same one. The
        // threshold is what separates them, so the byte offset is the identity to compare.
        assert.equal(thresholds.has(hit.start), false, `${def.id} resolves to a component another field already uses`);
        thresholds.add(hit.start);
    }
});

test('the 15-minute products fall back to an hourly component only when they mean to', () => {
    // `TMP@2 m above ground` exists in the RRFS sub-hourly file under BOTH spellings. A sub-hourly
    // dataset must take the minute one, or a dataset picked for 15-minute resolution serves hourly data.
    const set = INVENTORIES['rrfs-subh'];
    const def = getModelField('HRRR_TMP_2M');
    const [{ sel, entries, dataset }] = locate(def, 'rrfs-subh', set);
    const hit = findIdxEntry(entries, sel, set.step, dataset);
    assert.ok(hit.forecast.endsWith('min fcst'), `expected a minute-labelled component, got "${hit.forecast}"`);
    assert.equal(hit.forecast, '315 min fcst');
});

test("HRRR's sub-hourly 1-hour precipitation is four adjacent quarter-hour windows", () => {
    const set = INVENTORIES['hrrr-subh'];
    const def = getModelField('HRRR_APCP_1H');
    assert.ok(def.models.includes('hrrr-subh'));
    const [{ sel, entries, dataset }] = locate(def, 'hrrr-subh', set);
    const found = findIdxWindowEntries(entries, sel, 360, dataset, set.product);
    assert.equal(found.length, 4);
    assert.deepEqual(found.map((e) => e.forecast), [
        '300-315 min acc fcst', '315-330 min acc fcst', '330-345 min acc fcst', '345-360 min acc fcst',
    ]);
    // Four distinct components, each its own range request: they are far apart in the object, so the
    // pipeline cannot merge them into one.
    const starts = found.map((e) => e.start);
    assert.equal(new Set(starts).size, 4);
    assert.ok(starts.every((v, k) => k === 0 || v - starts[k - 1] > 1e6), 'expected four separate components');
});

test("RRFS's sub-hourly object has no quarter-hour accumulation, so it offers no 1-h precipitation", () => {
    assert.equal(modelHasField('HRRR_APCP_1H', 'rrfs-subh'), false);
    assert.equal(modelHasField('HRRR_ASNOW_TOTAL', 'rrfs-subh'), true, 'it does publish a run total');
    // ...and the one it does publish is a run total, which the base selector already matches.
    const def = getModelField('HRRR_ASNOW_TOTAL');
    const { sel, entries, dataset } = locate(def, 'rrfs-subh', INVENTORIES['rrfs-subh'])[0];
    assert.equal(findIdxEntry(entries, sel, 315, dataset).forecast, '0-315 min acc fcst');
});

test('every HRRR field input is found in the real HRRR inventories', () => {
    const set = { model: 'hrrr', product: 'mean', step: 60, files: { sfc: idx('hrrr.t12z.wrfsfcf01.grib2.idx'), prs: idx('hrrr.t12z.wrfprsf01.grib2.idx') } };
    for (const def of MODEL_FIELDS.filter((d) => d.models.includes('hrrr'))) {
        for (const { sel, entries, dataset } of locate(def, 'hrrr', set)) {
            assert.ok(findIdxEntry(entries, sel, set.step, dataset), `${def.id}: ${sel.variable}:${sel.level} missing`);
        }
    }
});

test('the 00z inventories (a different cycle) match every analysis field', () => {
    const sfc = idx('hrrr.t00z.wrfsfcf00.grib2.idx');
    const prs = idx('hrrr.t00z.wrfprsf00.grib2.idx');
    const hrrr = getDataset('hrrr');
    for (const def of MODEL_FIELDS.filter((d) => d.models.includes('hrrr') && !needsForecastStep(d, 'hrrr'))) {
        for (const sel of inputsFor(def, 'hrrr')) {
            assert.ok(findIdxEntry(sel.file === 'sfc' ? sfc : prs, sel, 0, hrrr), `${def.id} ${sel.variable}`);
        }
    }
});

test('window and total selectors pick the right record when several share a variable', () => {
    const hrrr = getDataset('hrrr');
    const f02 = idx('hrrr.t12z.wrfsfcf02.grib2.idx');
    const apcp = findIdxEntry(f02, inputsFor(getModelField('HRRR_APCP_1H'), 'hrrr')[0], 120, hrrr);
    assert.equal(apcp.forecast, '1-2 hour acc fcst');
    const asnow48 = findIdxEntry(idx('hrrr.t12z.wrfsfcf48.grib2.idx'), inputsFor(getModelField('HRRR_ASNOW_TOTAL'), 'hrrr')[0], 2880, hrrr);
    assert.equal(asnow48.forecast, '0-2 day acc fcst');
    const weasd = findIdxEntry(f02, inputsFor(getModelField('HRRR_WEASD'), 'hrrr')[0], 120, hrrr);
    assert.equal(weasd.forecast, '2 hour fcst'); // the instantaneous SWE, not the 1-h accumulation
    const mx = findIdxEntry(idx('hrrr.t12z.wrfsfcf24.grib2.idx'), inputsFor(getModelField('HRRR_MXUPHL_25KM'), 'hrrr')[0], 1440, hrrr);
    assert.equal(mx.forecast, '23-24 hour max fcst');
});

test('the unnamed local parameter matches by its raw description', () => {
    const sel = { file: 'sfc', variable: 'var discipline=0 center=7 local_table=1 parmcat=16 parm=201', level: 'entire atmosphere', timing: 'instant' };
    const hrrr = getDataset('hrrr');
    assert.ok(findIdxEntry(idx('hrrr.t12z.wrfsfcf01.grib2.idx'), sel, 60, hrrr));
    assert.ok(findIdxEntry(idx('hrrr.t00z.wrfsfcf00.grib2.idx'), sel, 0, hrrr));
});

test('U and V inputs of every vector field are separate messages', () => {
    const set = { model: 'hrrr', product: 'mean', step: 60, files: { sfc: idx('hrrr.t12z.wrfsfcf01.grib2.idx'), prs: idx('hrrr.t12z.wrfprsf01.grib2.idx') } };
    for (const def of MODEL_FIELDS.filter((d) => d.models.includes('hrrr') && d.recipe === 'vector')) {
        assert.equal(def.inputs.length, 2, def.id);
        const [u, v] = def.inputs.map((sel) => findIdxEntry(set.files[sel.file], sel, set.step, getDataset('hrrr')));
        assert.ok(u && v, `${def.id}: ${def.inputs.map((s) => s.variable).join('/')}`);
        assert.notEqual(u.start, v.start, def.id);
    }
});

test('ids are unique, every field sits in a known pane and every pane has fields', () => {
    const ids = new Set();
    for (const def of MODEL_FIELDS) {
        assert.ok(!ids.has(def.id), `duplicate id ${def.id}`);
        ids.add(def.id);
        assert.ok(MODEL_PANES.some((p) => p.id === def.pane), `${def.id} pane ${def.pane}`);
        assert.ok(def.models.length > 0, `${def.id} is offered by no dataset`);
    }
    for (const pane of MODEL_PANES) assert.ok(MODEL_FIELDS.some((f) => f.pane === pane.id), `empty pane ${pane.id}`);
});

test('every pane a dataset can fill has at least one field, and no field escapes its dataset panes', () => {
    for (const id of MODEL_IDS) {
        const fields = fieldsForModel(id);
        const panes = panesForModel(id);
        assert.ok(fields.length > 0, `${id} offers no fields`);
        assert.ok(panes.length > 0, `${id} offers no panes`);
        for (const f of fields) assert.ok(panes.some((p) => p.id === f.pane), `${id}: ${f.id} is in a pane it cannot fill`);
    }
    // The 15-minute products publish only the native near-surface components.
    assert.deepEqual(panesForModel('hrrr-subh').map((p) => p.id), ['surface', 'severe', 'winter', 'precip', 'satellite']);
    assert.deepEqual(panesForModel('rrfs-subh').map((p) => p.id), ['surface', 'severe', 'winter', 'precip']);
    // Atmospheric models do not offer the waves pane, and HRRR has no levels beyond the five pressure panes (`levels` holds the rest).
    assert.deepEqual(panesForModel('hrrr').map((p) => p.id), MODEL_PANES.map((p) => p.id).filter((id) => id !== 'waves'));
    for (const id of ['gfs-wave', 'gefs-wave']) assert.deepEqual(panesForModel(id).map((p) => p.id), ['waves']);
    assert.ok(panesForModel('hafs-a').some((p) => p.id === 'satellite'));
});

test('REFS probability fields appear in their weather categories', () => {
    const fields = fieldsForModel('refs', 'prob');
    for (const [id, pane] of Object.entries({ REFS_PROB_REFC20: 'severe', REFS_PROB_APCP13: 'precip', REFS_PROB_ASNOW25: 'winter', REFS_PROB_TMPFRZ: 'surface', REFS_PROB_WIND85031: '850', REFS_PROB_WIND25041: '250' })) {
        assert.equal(fields.find(field => field.id === id)?.pane, pane, id);
    }
    assert.ok(panesForModel('refs', 'prob').every(pane => pane.id !== 'probability'));
    assert.ok(fields.every(field => field.product === 'prob'), 'the probability file does not contain ordinary mean fields');
});

test('ensemble modes list only fields that can be rendered for that mode', () => {
    const member = fieldsForModel('gefs', 'member');
    const chance = fieldsForModel('gefs', 'exceed');
    assert.ok(member.some(field => field.kind === 'vector'));
    assert.ok(chance.length > 0);
    assert.ok(chance.every(field => field.kind !== 'vector' && field.kind !== 'categorical'));
    assert.ok(!chance.some(field => field.id === 'HRRR_WIND_10M'));
    const normalized = fieldsForModel('gefs', 'nsprd');
    assert.ok(normalized.length > 0);
    assert.ok(normalized.every(field => getDataset('gefs').products.find(product => product.id === 'nsprd').fields.includes(field.id)));
});

test('the sub-hourly datasets offer their native quarter-hour fields', () => {
    const want = {
        'hrrr-subh': ['HRRR_SAT_GOES11_WV', 'HRRR_SAT_GOES11_IR', 'HRRR_SAT_GOES12_WV', 'HRRR_SAT_GOES12_IR', 'HRRR_TMP_2M', 'HRRR_DPT_2M', 'HRRR_THETAE_2M', 'HRRR_WIND_10M', 'HRRR_GUST_SFC', 'HRRR_VIS', 'HRRR_REFC', 'HRRR_PTYPE', 'HRRR_APCP_1H', 'HRRR_PRATE', 'HRRR_SNOWFALL_WE_1H'],
        'rrfs-subh': ['HRRR_TMP_2M', 'HRRR_DPT_2M', 'HRRR_THETAE_2M', 'HRRR_WIND_10M', 'HRRR_GUST_SFC', 'HRRR_VIS', 'HRRR_REFC', 'HRRR_ASNOW_TOTAL', 'HRRR_PTYPE', 'HRRR_PRATE'],
    };
    for (const [model, ids] of Object.entries(want)) {
        assert.deepEqual(fieldsForModel(model).map((f) => f.id), ids, model);
    }
    // No pressure levels, no instability, no shear: those live only in the hourly objects.
    for (const model of ['hrrr-subh', 'rrfs-subh']) {
        for (const def of MODEL_FIELDS) {
            if (model === 'hrrr-subh' && def.pane === 'satellite') continue;
            if (def.pane === 'surface' || def.pane === 'severe' || def.pane === 'precip' || def.pane === 'winter') continue;
            assert.equal(def.models.includes(model), false, `${model} must not offer ${def.id}`);
        }
    }
});

test('every field colormap exists in the bundled colormaps', () => {
    const bundle = JSON.parse(readFileSync(path.join(ROOT, 'fixtures', 'colormaps.json'), 'utf8'));
    const names = new Set(extractColormaps(bundle).map((c) => c.name));
    for (const def of MODEL_FIELDS) assert.ok(names.has(def.colormap.name), `${def.id}: ${def.colormap.name}`);
});

// Every RAP ID the app labelled (rapCatalog's RAP_LABEL_OVERRIDES), plus the wind pairs.
const RAP_IDS = [
    'RAP_TMP_2M', 'RAP_DPT_2M', 'RAP_CAPE_Surface', 'RAP_CIN_Surface', 'RAP_GUST_10M', 'RAP_UGRD_10M', 'RAP_VGRD_10M',
    'Absolutevorticity 500mb', 'CAPE 0-3km', 'CAPE Surface', 'CIN Surface', 'Dewpoint 2m', 'Freezinglevelheight',
    'Liftedindex Surface 500-1000mb', 'MLCAPE', 'MLCIN', 'MUCAPE', 'MUCIN', 'Relativehumidity 250mb', 'Relativehumidity 2m',
    'Relativehumidity 500mb', 'Relativehumidity 700mb', 'Relativehumidity 850mb', 'Relativehumidity 925mb', 'Srh-0-1km', 'SRH 0-3km',
    'Snowdepth Surface', 'Snowwaterequivalent Surface', 'Temperature 250mb', 'Temperature 2m', 'Temperature 500mb', 'Temperature 700mb',
    'Temperature 850mb', 'Temperature 925mb', 'Temperature Surface', 'Thetae Surface',
    'RAP_WIND_10M', 'RAP_WIND_925MB', 'RAP_WIND_850MB', 'RAP_WIND_700MB', 'RAP_WIND_500MB', 'RAP_WIND_250MB',
    'RAP_TMP_850MB', 'RAP_RH_850MB',
];

test('every old RAP ID resolves to a field HRRR offers, and wet-bulb zero is dropped', () => {
    for (const id of RAP_IDS) {
        const fieldId = resolveModelFieldId(id, 'hrrr');
        assert.ok(fieldId && modelHasField(fieldId, 'hrrr'), `${id} -> ${fieldId} is not an HRRR field`);
    }
    const warnings = [];
    const warn = console.warn;
    console.warn = (m) => warnings.push(m);
    try { assert.equal(resolveModelFieldId('Wetbulbzeroheight', 'hrrr'), null); } finally { console.warn = warn; }
    assert.equal(warnings.length, 1);
});

test('an ID resolves only for datasets that offer it', () => {
    // MSLP feeds the isobars and is never a field to pick, under its own or its old RAP name.
    assert.equal(resolveModelFieldId('HRRR_MSLP', 'rrfs-subh'), null);
    assert.equal(resolveModelFieldId('RAP_MSLP_Surface', 'hrrr'), null);
    // Pressure levels are hourly only.
    assert.equal(resolveModelFieldId('HRRR_TMP_500MB', 'rrfs'), 'HRRR_TMP_500MB');
    assert.equal(resolveModelFieldId('HRRR_TMP_500MB', 'hrrr-subh'), null);
    // Unknown IDs stay null.
    assert.equal(resolveModelFieldId('NOPE', 'hrrr'), null);
    assert.equal(resolveModelFieldId(null, 'hrrr'), null);
});

test('MSLP is an overlay field: carried by the models that publish it, absent from every picker', () => {
    for (const model of ['hrrr', 'rrfs', 'rrfs-subh', 'refs']) {
        assert.ok(MODEL_FIELDS.find((f) => f.id === getDataset(model).isobars.fieldId).models.includes(model), model);
    }
    for (const model of ['hrrr', 'hrrr-subh', 'rrfs', 'rrfs-subh', 'refs']) {
        assert.equal(fieldsForModel(model).some((f) => f.id === getDataset(model).isobars.fieldId), false, model);
        // HRRR 15-minute has no pressure of its own but borrows the hourly HRRR's.
        assert.equal(modelHasIsobars(model), true, model);
    }
    assert.deepEqual(getDataset('hrrr-subh').isobars.borrowFrom, { dataset: 'hrrr', roundMinutes: 60 });
});


test('HRRR and RRFS offer their published simulated satellite channels with temperature transforms', () => {
    for (const [model, variables] of [
        ['hrrr', ['SBT113', 'SBT114', 'SBT123', 'SBT124']],
        ['hrrr-subh', ['SBT113', 'SBT114', 'SBT123', 'SBT124']],
        ['hrrr-ak', ['SBT113', 'SBT114', 'SBT123', 'SBT124']],
        ['rrfs', Array.from({ length: 10 }, (_, i) => `SBTA16${i + 7}`)],
    ]) {
        const fields = fieldsForModel(model).filter(field => field.pane === 'satellite');
        assert.deepEqual(fields.map(field => inputsFor(field, model)[0].variable), variables, model);
        assert.ok(panesForModel(model).some(pane => pane.id === 'satellite'));
        for (const field of fields) {
            const [selector] = inputsFor(field, model);
            assert.equal(selector.file, 'sfc');
            assert.equal(selector.level, 'top of atmosphere');
            assert.equal(selector.timing, 'instant');
            assert.equal(selector.transform.offset, -273.15);
            assert.equal(field.colormap.toStored.offset, -273.15);
            assert.equal(field.units, '°C');
        }
    }
    assert.ok(!panesForModel('rrfs-subh').some(pane => pane.id === 'satellite'), 'RRFS quarter-hour inventory has no simulated ABI bands');
});
