import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODEL_CONFIGS } from '../dist/configs/index.js';
import { nbm as nbmConfig } from '../dist/configs/datasets/nbm.js';
import { compileDataset, compileFields } from '../dist/registry/compile.js';
import { validateConfigs } from '../dist/registry/validate.js';
import { fieldsForModel, findIdxEntry, getModelField, inputsFor, isVectorField, panesForModel } from '../dist/catalog.js';
import { getDataset } from '../dist/datasets.js';
import { gridMismatch } from '../dist/gridMatch.js';
import { fromHalf, parseIdx, readGrib2Grid } from '@edgewarn/web-utils/grib2';
import { chooseModelStep, modelFileUrl } from '../dist/listing.js';
import { ModelFetcher } from '../dist/sources/fetcher.js';
import { loadSourceAdapter } from '../dist/sources/index.js';
import { ModelMessageCache } from '../dist/messageCache.js';
import { levelLayout } from '../dist/tiles.js';
import { extractColormaps } from '@edgewarn/web-utils/colormap';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(ROOT, 'fixtures');
const NBM_FIX = path.join(FIX, 'nbm');
const nbm = getDataset('nbm');
const T = (s) => Date.parse(s);
const H = (n) => n * 60;
const availability = JSON.parse(readFileSync(path.join(NBM_FIX, 'step-availability.json'), 'utf8'));
const inventories = JSON.parse(readFileSync(path.join(FIX, 'inventories.json'), 'utf8'));
const idx = (name) => parseIdx(readFileSync(path.join(FIX, name), 'utf8'));

test('NBM is a registered model, offered on its four long-range cycles, with no analysis', () => {
    assert.equal(nbm.label, 'NBM');
    assert.deepEqual([...nbm.cycleHours], [0, 6, 12, 18]);
    assert.equal(nbm.minStep, 1);
    assert.equal(nbm.runSteps(12), 264);
    assert.deepEqual(nbm.ensembles, ['mean', 'p10', 'p50', 'p90']);
    assert.equal(nbm.defaultExtra, 'none');
    assert.equal(nbm.isobars, null, 'no pressure in the core files, so no isobars');
    assert.equal(getModelField('HRRR_MSLP').models.includes('nbm'), false);
    assert.equal(modelFileUrl(nbm, T('2026-10-22T12:00Z'), 'core', 12),
        'https://noaa-nbm-grib2-pds.s3.amazonaws.com/blend.20261022/12/core/blend.t12z.core.f012.co.grib2');
    assert.equal(modelFileUrl(nbm, T('2026-10-22T18:00Z'), 'core', 264),
        'https://noaa-nbm-grib2-pds.s3.amazonaws.com/blend.20261022/18/core/blend.t18z.core.f264.co.grib2');
});

test('the run shape is the one measured: hourly to 48, every 3 h to 192, every 6 h to 264, on every cycle', () => {
    const measured = availability.steps;
    assert.equal(measured.length, 108);
    for (const cycle of [0, 6, 12, 18]) {
        assert.deepEqual(nbm.stepsFor(cycle).map((m) => m / 60), measured, `cycle ${cycle}`);
        assert.deepEqual([...nbm.fileIndices(cycle)], measured, `cycle ${cycle}`);
    }
    // And the gaps the bucket really has: f049, f050, f052, f053, f193 to f197 do not exist.
    for (const gap of [49, 50, 52, 53, 193, 197, 199]) assert.ok(!availability.steps.includes(gap), `f${gap}`);
});

test('the declared grid is the one in the message, scan mode and radius included', () => {
    const decoded = readGrib2Grid(new Uint8Array(readFileSync(path.join(NBM_FIX, 't12z-f012-vis.grib2'))));
    assert.equal(gridMismatch(nbm.grid, decoded), null);
    assert.equal(nbm.grid.scanMode, 0x50);
    assert.equal(nbm.grid.radiusM, 6371200);
    assert.deepEqual([...nbm.factors], [1, 2, 4]);
});

test('NBM tile layouts: levels of 2.5, 5 and 10 km on its own grid', () => {
    const layouts = [0, 1, 2].map((l) => levelLayout(l, nbm.grid.nx, nbm.grid.ny, nbm.factors));
    assert.deepEqual(layouts.map((l) => [l.nx, l.ny]), [[2345, 1597], [1173, 799], [587, 400]]);
    assert.deepEqual(layouts.map((l) => [l.tilesX, l.tilesY]), [[10, 7], [5, 4], [3, 2]]);
});

test('the fields offered are NBM\'s, grouped in the panes NBM has, with the shared ones it carries', () => {
    const ids = fieldsForModel('nbm').map((f) => f.id);
    assert.equal(ids.length, 28);
    for (const id of ['HRRR_TMP_2M', 'HRRR_DPT_2M', 'HRRR_RH_2M', 'HRRR_TMP_SFC', 'HRRR_VIS', 'HRRR_PWAT', 'HRRR_SBCAPE', 'HRRR_APCP_1H', 'HRRR_SNOD']) {
        assert.ok(ids.includes(id), id);
    }
    assert.ok(ids.filter((id) => id.startsWith('NBM_')).length >= 17);
    assert.deepEqual(panesForModel('nbm').map((p) => p.id), ['surface', 'severe', 'winter', 'precip'], 'no pressure levels, no probability pane');
    // Nothing from the other models' own sets leaks in.
    assert.ok(!ids.some((id) => id.startsWith('REFS_') || /MB$/.test(id)));
    assert.equal(getModelField('NBM_WIND_10M').models.join(), 'nbm,nbm-ak,nbm-hi,nbm-pr,nbm-gu');
});

test('wind is drawn from speed and direction', () => {
    for (const id of ['NBM_WIND_10M', 'NBM_WIND_30M', 'NBM_WIND_80M', 'NBM_TRANSPORT_WIND']) {
        const def = getModelField(id);
        assert.equal(def.recipe, 'speed-direction', id);
        assert.deepEqual(def.recipeParams, { frame: 'earth' }, id);
        assert.equal(isVectorField(def, 'nbm'), true, id);
        assert.deepEqual(inputsFor(def, 'nbm').map((s) => s.variable), id.includes('TRANSPORT') ? ['TRWSPD', 'TRWDIR'] : ['WIND', 'WDIR'], id);
    }
    assert.equal(isVectorField(getModelField('NBM_GUST_10M'), 'nbm'), false);
});

test('every NBM field is in the 12z f012 inventory, and the plain component beats its twins', () => {
    const entries = idx('nbm/blend.t12z.core.f012.co.grib2.idx');
    for (const def of fieldsForModel('nbm')) {
        for (const sel of inputsFor(def, 'nbm')) {
            const found = findIdxEntry(entries, sel, H(12), nbm, 'mean');
            assert.ok(found, `${def.id}: ${sel.variable}:${sel.level}`);
            // Unless the field asks for a descriptor, the component picked has none (no `ens std dev`, `10% level`, `prob >x`).
            if (!sel.extra) assert.deepEqual(found.extra, [], `${def.id}: ${sel.variable} picked ${found.extra}`);
        }
    }
    // 2 m temperature is listed three times at f012: ens std dev, then the plain one.
    const tmp = entries.filter((e) => e.variable === 'TMP' && e.level === '2 m above ground');
    assert.ok(tmp.length >= 2);
    assert.deepEqual(findIdxEntry(entries, getModelField('HRRR_TMP_2M').inputs[0], H(12), nbm).extra, []);
    // CWASP has no plain component; its blended value carries the descriptor the field asks for.
    assert.deepEqual(findIdxEntry(entries, getModelField('NBM_CWASP').inputs[0], H(12), nbm).extra, ['unknown derived fcst']);
});

/** The steps (minutes) at which every input of a field exists, from the measured availability of every step of one run. */
function measuredSteps(def) {
    const keyOf = (sel) => `${sel.variable}|${sel.level}|${sel.timing}|${sel.extra && sel.extra !== 'none' && sel.extra !== 'any' ? sel.extra : ''}`;
    let steps = new Set(availability.steps.map((h) => h * 60));
    for (const sel of def.inputs) {
        const has = new Set((availability.components[keyOf(sel)] ?? []).map((h) => h * 60));
        steps = new Set([...steps].filter((m) => has.has(m)));
    }
    return [...steps].sort((a, b) => a - b);
}

test('each field\'s steps equal the steps its components exist at, measured over a whole run', () => {
    const own = nbm.stepsFor(12);
    let thinned = 0;
    for (const def of fieldsForModel('nbm')) {
        const measured = measuredSteps(def);
        const declared = nbm.fieldSteps(def.id, 12) ?? own;
        assert.deepEqual([...declared], measured, `${def.id}`);
        if (nbm.fieldSteps(def.id, 12)) thinned++;
    }
    assert.ok(thinned >= 10, `${thinned} fields have a cadence of their own`);
    // Spot checks of what the table says.
    assert.equal(nbm.fieldSteps('NBM_VIL', 12).length, 48);
    assert.equal(nbm.fieldSteps('HRRR_VIS', 12).at(-1), H(78));
    assert.equal(nbm.fieldSteps('NBM_CEIL', 12).at(-1), H(84));
    assert.equal(nbm.fieldSteps('HRRR_TMP_2M', 12), null);
    assert.equal(nbm.fieldSteps('NBM_WIND_10M', 12), null);
});

test('at every other step of the run, a field is in the inventory exactly when its steps say so', () => {
    for (const [name, set] of Object.entries(inventories)) {
        if (!set.report || set.model !== 'nbm') continue;
        const entries = idx(set.files.core);
        for (const def of fieldsForModel('nbm')) {
            const here = (nbm.fieldSteps(def.id, 12) ?? nbm.stepsFor(12)).includes(set.step);
            const found = inputsFor(def, 'nbm').every((sel) => findIdxEntry(entries, sel, set.step, nbm, 'mean') !== null);
            assert.equal(found, here, `${def.id} at ${name} (+${set.step / 60} h): ${found ? 'in the inventory' : 'missing'}`);
        }
    }
});

test('the timeline for a field follows the field: forecast steps it does not have resolve to nothing', () => {
    const newest = { initMs: T('2026-10-22T12:00Z'), maxSteps: 264, published: 265 };
    const ctx = (fieldId) => ({ nowMs: T('2026-10-22T14:00Z'), newest, selected: newest, forecastOnly: false, fieldId });
    const at = (h) => newest.initMs + h * 3_600_000;
    assert.equal(chooseModelStep(at(49), ctx('HRRR_TMP_2M'), nbm), null, 'the run has no f049');
    assert.equal(chooseModelStep(at(40), ctx('HRRR_TMP_2M'), nbm).minutes, H(40));
    assert.equal(chooseModelStep(at(40), ctx('HRRR_TMP_SFC'), nbm), null, 'surface temperature is 3-hourly after f036');
    assert.equal(chooseModelStep(at(39), ctx('HRRR_TMP_SFC'), nbm).minutes, H(39));
    assert.equal(chooseModelStep(at(39), ctx('HRRR_VIS'), nbm).minutes, H(39));
    assert.equal(chooseModelStep(at(81), ctx('HRRR_VIS'), nbm), null, 'visibility ends at f078');
    assert.equal(chooseModelStep(at(81), ctx('HRRR_TMP_2M'), nbm).minutes, H(81));
    assert.equal(chooseModelStep(at(51), ctx('NBM_VIL'), nbm), null, 'VIL ends at f048');
    assert.equal(chooseModelStep(at(48), ctx('NBM_VIL'), nbm).minutes, H(48));
    assert.equal(chooseModelStep(at(240), ctx('NBM_MIXHT'), nbm), null);
    assert.equal(chooseModelStep(at(246), ctx('NBM_MIXHT'), nbm).minutes, H(246));
});

/** A bucket serving the real f012 inventory and, at the real VIS byte range, the real VIS message. */
function nbmBucket() {
    const init = T('2026-10-22T12:00Z');
    const url = modelFileUrl(nbm, init, 'core', 12);
    const text = readFileSync(path.join(NBM_FIX, 'blend.t12z.core.f012.co.grib2.idx'), 'utf8');
    const vis = parseIdx(text).find((e) => e.variable === 'VIS' && e.level === 'surface' && e.extra.length === 0);
    const bytes = new Uint8Array(readFileSync(path.join(NBM_FIX, 't12z-f012-vis.grib2')));
    const requests = [];
    const fetch = async (u, req = {}) => {
        requests.push({ url: u, range: req.headers?.Range ?? null });
        if (u === `${url}.idx`) return new Response(text);
        const m = /bytes=(\d+)-(\d*)/.exec(req.headers?.Range ?? '');
        if (u === url && m && Number(m[1]) === vis.start && Number(m[2]) === vis.end) return new Response(bytes, { status: 206 });
        return new Response('missing', { status: 404 });
    };
    return { init, fetch, requests, vis, bytes };
}

test('a real NBM message decodes through the adapter: only its byte range, on its own grid, scan mode applied', async () => {
    const bucket = nbmBucket();
    const fetcher = new ModelFetcher({ cache: new ModelMessageCache({ memoryBytes: 256e6 }), fetch: bucket.fetch });
    const def = getModelField('HRRR_VIS');
    const adapter = await loadSourceAdapter(nbm.source);
    const result = await adapter.readInputs({
        dataset: nbm, def, selectors: inputsFor(def, 'nbm'), model: 'nbm', product: 'mean', initMs: bucket.init, minutes: H(12), step: 12, level: 2, reducer: 'mean',
    }, { fetcher, check() {} });
    assert.equal(bucket.requests.filter((r) => r.range).length, 1, 'one range request for the one message');
    assert.equal(result.fetched, bucket.bytes.length);
    assert.equal(gridMismatch(nbm.grid, result.grid), null);
    assert.equal(result.grid.scanMode, 0x50);
    const { nx, ny, data } = result.levels[0];
    assert.deepEqual([nx, ny], [587, 400], 'the 10 km level on NBM\'s own grid');
    const values = Array.from(data, fromHalf).filter(Number.isFinite);
    // Visibility in km: between 0.4 and the 16.2 km cap NBM writes.
    assert.ok(values.length > 1000);
    const low = values.reduce((a, v) => Math.min(a, v), Infinity), high = values.reduce((a, v) => Math.max(a, v), -Infinity);
    assert.ok(low >= 0.4 && high <= 16.3, `${low}..${high}`);
    // With rows read in the wrong direction the neighbour of a texel would be an unrelated one: coherent rows mean small steps.
    let rowStep = 0, colStep = 0, n = 0;
    for (let y = 2; y < ny - 2; y++) for (let x = 2; x < nx - 2; x++) {
        const a = fromHalf(data[y * nx + x]), b = fromHalf(data[(y + 1) * nx + x]), c = fromHalf(data[y * nx + x + 1]);
        if (Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c)) { rowStep += Math.abs(a - b); colStep += Math.abs(a - c); n++; }
    }
    assert.ok(n > 1000 && rowStep / colStep < 2, `row ${rowStep / n} column ${colStep / n}`);
});

test('adding a model is one config file: a copy of NBM under another id is accepted as is', () => {
    const copy = { ...nbmConfig, id: 'nbm-copy', label: 'NBM copy', shortLabel: 'NBM copy' };
    const configs = [...MODEL_CONFIGS, copy];
    const colormaps = new Set(extractColormaps(JSON.parse(readFileSync(path.join(ROOT, 'fixtures', 'colormaps.json'), 'utf8'))).map((c) => c.name));
    assert.deepEqual(validateConfigs(configs, { colormaps }), []);
    const dataset = compileDataset(copy);
    assert.equal(dataset.id, 'nbm-copy');
    assert.deepEqual(dataset.stepsFor(12), nbm.stepsFor(12));
    assert.deepEqual([...dataset.fieldSteps('NBM_VIL', 12)], [...nbm.fieldSteps('NBM_VIL', 12)]);
    const fields = compileFields(configs);
    // NBM's regional configs share its fields, so the copy is checked against NBM and itself only.
    assert.deepEqual(fields.find((f) => f.id === 'NBM_VIL').models.filter((m) => m === 'nbm' || m === 'nbm-copy'), ['nbm', 'nbm-copy']);
    const tmp = fields.find((f) => f.id === 'HRRR_TMP_2M').models;
    assert.ok(tmp.indexOf('nbm') >= 0 && tmp.indexOf('nbm') < tmp.indexOf('nbm-copy') && tmp.at(-1) === 'nbm-copy', 'the copy is offered after the models before it');
    // The copy reads the same inventory as NBM does.
    const entries = idx('nbm/blend.t12z.core.f012.co.grib2.idx');
    for (const def of copy.fields) for (const sel of def.inputs) assert.ok(findIdxEntry(entries, sel, H(12), dataset, 'mean'), def.id);
    // A broken copy is caught by validation, not at the map.
    assert.match(validateConfigs([...MODEL_CONFIGS, { ...copy, grid: { ...copy.grid, nx: 0 } }]).join('\n'), /positive numbers/);
});
