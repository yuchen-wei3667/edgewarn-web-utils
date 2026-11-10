import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODEL_CONFIGS } from '../dist/configs/index.js';
import { APPROVED_DATA_ORIGINS, OPEN_METEO_BUCKET } from '../dist/configs/shared.js';
import { validateConfigs } from '../dist/registry/validate.js';
import { expandSteps, levelFactors, runEntryFor } from '../dist/registry/compile.js';
import { getDataset, isModelId, MODEL_IDS } from '../dist/datasets.js';
import { extractColormaps } from '@edgewarn/web-utils/colormap';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATASETS_DIR = path.join(ROOT, '..', 'dist', 'configs', 'datasets');
const colormaps = new Set(extractColormaps(JSON.parse(readFileSync(path.join(ROOT, 'fixtures', 'colormaps.json'), 'utf8'))).map((c) => c.name));

const real = (id) => MODEL_CONFIGS.find((c) => c.id === id);
/** The real registry with one model replaced by a copy changed by `edit`; returns what validation says. */
const problemsWith = (id, edit) => {
    const copy = { ...real(id), ...edit };
    return validateConfigs(MODEL_CONFIGS.map((c) => (c.id === id ? copy : c)), { colormaps });
};

test('every registered model passes validation', () => {
    assert.deepEqual(validateConfigs(MODEL_CONFIGS, { colormaps }), []);
});

test('every file in datasets/ is registered in index.ts', async () => {
    const files = readdirSync(DATASETS_DIR).filter((f) => f.endsWith('.js'));
    assert.ok(files.length >= 5);
    const registered = new Set(MODEL_CONFIGS);
    for (const file of files) {
        const mod = await import(path.join(DATASETS_DIR, file));
        const exported = Object.values(mod).filter((v) => v && typeof v === 'object' && 'objects' in v);
        assert.ok(exported.length >= 1, `${file} exports no model`);
        for (const config of exported) assert.ok(registered.has(config), `${file}: ${config.id} is not in MODEL_CONFIGS (src/configs/index.ts)`);
    }
});

test('model ids are unique and the compiled registry follows the config order', () => {
    assert.deepEqual([...MODEL_IDS], MODEL_CONFIGS.map((c) => c.id));
    assert.equal(new Set(MODEL_IDS).size, MODEL_IDS.length);
    assert.ok(isModelId('hrrr') && !isModelId('nope') && !isModelId(undefined));
});

// ── One bad-config test per rule the types cannot express ──

test('validation: ids', () => {
    assert.match(problemsWith('hrrr', { id: 'HRRR_X' }).join('\n'), /id must match/);
    assert.match(problemsWith('hrrr', { id: 'rrfs' }).join('\n'), /id is used by another model/);
});

test('validation: object paths and bucket', () => {
    const objects = { sfc: { serves: ['sfc'], url: () => 'same/path.grib2' }, prs: real('hrrr').objects.prs };
    assert.match(problemsWith('hrrr', { objects }).join('\n'), /same path for different steps/);
    const broken = { sfc: { serves: ['sfc'], url: ({ step }) => `x/../f${step}` }, prs: real('hrrr').objects.prs };
    assert.match(problemsWith('hrrr', { objects: broken }).join('\n'), /looks malformed/);
    const undef = { sfc: { serves: ['sfc'], url: ({ step, cycle }) => `x/${cycle}/${step}/${undefined}` }, prs: real('hrrr').objects.prs };
    assert.match(problemsWith('hrrr', { objects: undef }).join('\n'), /looks malformed/);
    assert.match(problemsWith('hrrr', { bucket: 'http://example.com' }).join('\n'), /not https|https origin/);
    assert.match(problemsWith('hrrr', { gate: ['nope'] }).join('\n'), /gate names unknown object nope/);
});

test('validation: a field cannot read an object the model lacks', () => {
    const objects = { sfc: real('hrrr').objects.sfc };
    assert.match(problemsWith('hrrr', { objects, gate: ['sfc'] }).join('\n'), /reads a prs object, which the model has none of/);
});

test('validation: grid and levels', () => {
    assert.match(problemsWith('hrrr', { grid: { ...real('hrrr').grid, nx: 0 } }).join('\n'), /positive numbers/);
    assert.match(problemsWith('hrrr', { grid: { ...real('hrrr').grid, lat1: 120 } }).join('\n'), /out of range/);
    assert.match(problemsWith('hrrr', { grid: { ...real('hrrr').grid, radiusM: 1 } }).join('\n'), /not an earth radius/);
    assert.match(problemsWith('hrrr', { levelTargetsKm: [6, 12, 18] }).join('\n'), /must start at 1 and rise/);
});

test('level factors follow the grid spacing and always rise', () => {
    assert.deepEqual(levelFactors(3000, [3, 6, 9]), [1, 2, 3]);
    assert.deepEqual(levelFactors(2539.703, [3, 6, 9]), [1, 2, 4]);
    assert.deepEqual(levelFactors(9000, [3, 6, 9]), [1, 2, 3], 'targets finer than the grid still give three distinct levels');
    assert.deepEqual([...getDataset('hrrr').factors], [1, 2, 3]);
});

test('validation: time', () => {
    const time = real('hrrr').time;
    assert.match(problemsWith('hrrr', { time: { ...time, firstStep: 1 } }).join('\n'), /firstStep is 1 but the first step 0 min is in file 0/);
    assert.match(problemsWith('hrrr', { runs: [{ steps: [{ from: 0, to: 600, every: 45 }] }] }).join('\n'), /off the 60-minute grid/);
    assert.match(problemsWith('hrrr', { runs: [{ steps: [{ from: 0, to: 600, every: 60 }, { from: 300, to: 900, every: 60 }] }] }).join('\n'), /ascend without repeating/);
    assert.match(problemsWith('hrrr', { runs: [{ cycles: [0], steps: [{ from: 0, to: 60, every: 60 }] }] }).join('\n'), /no run shape covers cycle 1/);
    assert.match(problemsWith('hrrr', { runs: [{ cycles: [0, 99], steps: [{ from: 0, to: 60, every: 60 }] }, { steps: [{ from: 0, to: 60, every: 60 }] }] }).join('\n'), /cycle 99, which the model does not run/);
    assert.match(problemsWith('hrrr-subh', { time: { ...real('hrrr-subh').time, idxUnit: 'hour', fileIndex: { kind: 'forecast-hour' } } }).join('\n'), /sub-hourly model must address its files by hourly file index/);
    assert.match(problemsWith('hrrr', { time: { ...time, idxUnit: 'minute' } }).join('\n'), /labels minutes/);
});

test('step ranges expand to the valid minutes of a run, per cycle', () => {
    assert.deepEqual(expandSteps([{ from: 60, to: 240, every: 60 }, { from: 360, to: 720, every: 180 }]), [60, 120, 180, 240, 360, 540, 720]);
    assert.equal(expandSteps(runEntryFor(real('hrrr'), 12).steps).length, 49);
    assert.equal(expandSteps(runEntryFor(real('hrrr'), 13).steps).length, 19);
    assert.equal(getDataset('hrrr').runSteps(12), 48);
    assert.equal(getDataset('hrrr').runSteps(13), 18);
});

test('validation: fields', () => {
    const hrrr = real('hrrr');
    assert.match(problemsWith('hrrr', { defaultField: real('refs').fields.at(-1) }).join('\n'), /defaultField REFS_PROB_FLGHT3 is not in fields/);
    const stray = { ...hrrr.fields[0], id: 'HRRR_STRAY', recipe: 'vector' };
    assert.match(problemsWith('hrrr', { fields: [...hrrr.fields, stray] }).join('\n'), /recipe vector takes 2 inputs \(u, v\), got 1/);
    const unknownRecipe = { ...hrrr.fields[0], id: 'HRRR_STRAY', recipe: 'average' };
    assert.match(problemsWith('hrrr', { fields: [...hrrr.fields, unknownRecipe] }).join('\n'), /unknown recipe average/);
    const noColor = { ...hrrr.fields[0], id: 'HRRR_STRAY', colormap: { name: 'No_Such_Map' } };
    assert.match(problemsWith('hrrr', { fields: [...hrrr.fields, noColor] }).join('\n'), /colormap No_Such_Map, which public\/colormaps.json lacks/);
    const twin = { ...hrrr.fields[0], label: 'Different' };
    assert.match(problemsWith('rrfs', { fields: [twin, ...real('rrfs').fields.slice(1)] }).join('\n'), /defined differently in another model/);
    const clash = { ...hrrr.fields[1], id: 'HRRR_STRAY', legacyIds: ['RAP_TMP_2M'] };
    assert.match(problemsWith('hrrr', { fields: [...hrrr.fields, clash] }).join('\n'), /legacy id "RAP_TMP_2M" belongs to HRRR_TMP_2M and HRRR_STRAY/);
    const orphan = { ...hrrr.fields[0], id: 'HRRR_STRAY', product: 'prob' };
    assert.match(problemsWith('hrrr', { fields: [...hrrr.fields, orphan] }).join('\n'), /belongs to product prob, which the model lacks/);
    assert.match(problemsWith('hrrr', { fields: [...hrrr.fields, hrrr.fields[0]] }).join('\n'), /listed twice/);
});

test('validation: the default field is a plain field of the default product', () => {
    const overlay = real('hrrr').fields.find((f) => f.overlay);
    assert.match(problemsWith('hrrr', { defaultField: overlay }).join('\n'), /plain field of the default product/);
    const prob = real('refs').fields.find((f) => f.product === 'prob');
    assert.match(problemsWith('refs', { defaultField: prob }).join('\n'), /plain field of the default product/);
});

test('validation: isobars', () => {
    const hrrr = real('hrrr');
    assert.match(problemsWith('hrrr', { isobars: { field: hrrr.fields[0] } }).join('\n'), /must be an overlay field/);
    assert.match(problemsWith('hrrr', { fields: hrrr.fields.filter((f) => !f.overlay) }).join('\n'), /isobars field HRRR_MSLP is not in fields/);
    const subh = real('hrrr-subh');
    assert.match(problemsWith('hrrr-subh', { isobars: { ...subh.isobars, borrowFrom: { dataset: 'ghost', roundMinutes: 60 } } }).join('\n'), /borrow from unknown model ghost/);
    // hrrr-subh lists no pressure, so it cannot lend it; and a model that lists MSLP has nothing to borrow.
    const borrowFromSubh = { ...hrrr.isobars, borrowFrom: { dataset: 'hrrr-subh', roundMinutes: 60 } };
    assert.match(problemsWith('hrrr', { isobars: borrowFromSubh }).join('\n'), /hrrr-subh does not list HRRR_MSLP, so hrrr cannot borrow it/);
    assert.match(problemsWith('hrrr', { isobars: borrowFromSubh }).join('\n'), /HRRR_MSLP is listed, so there is nothing to borrow/);
});

test('validation: per-field step lists name real fields and real steps', () => {
    const f = real('hrrr').fields[0];
    assert.match(problemsWith('hrrr', { fieldSteps: { NOT_A_FIELD: [{ from: 0, to: 60, every: 60 }] } }).join('\n'), /fieldSteps names unknown field NOT_A_FIELD/);
    assert.match(problemsWith('hrrr', { fieldSteps: { [f.id]: [{ from: 0, to: 90, every: 30 }] } }).join('\n'), /has step 30 min, which no run holds/);
    assert.deepEqual(problemsWith('hrrr', { fieldSteps: { [f.id]: [{ from: 0, to: 600, every: 120 }] } }), []);
});

test('validation: products', () => {
    const refs = real('refs');
    assert.match(problemsWith('refs', { products: [...refs.products.slice(0, 2), { ...refs.products[2], id: 'sprd' }] }).join('\n'), /product ids repeat/);
    assert.match(problemsWith('refs', { products: [{ ...refs.products[0], object: 'ghost' }, ...refs.products.slice(1)] }).join('\n'), /names unknown object ghost/);
});

test('the compiled datasets expose everything the engine reads', () => {
    for (const id of MODEL_IDS) {
        const d = getDataset(id);
        assert.equal(d.defaultField, real(id).defaultField.id);
        assert.ok(d.grid.radiusM > 6e6 && d.grid.nx > 0, id);
        assert.equal(d.factors.length, 3);
        assert.ok(d.docs.runs && d.docs.length, id);
    }
});

// ── The contract added for the model viewer: provenance, access, sources, aliases, windows, lat/lon grids ──

test('validation: the data host must be on the approved list', () => {
    assert.match(problemsWith('hrrr', { bucket: 'https://example.com' }).join('\n'), /bucket https:\/\/example.com is not in APPROVED_DATA_ORIGINS/);
    assert.deepEqual(problemsWith('hrrr', { bucket: real('rrfs').bucket }).filter((p) => /APPROVED/.test(p)), []);
});

test('validation: corsVerifiedOn is a real past date', () => {
    for (const bad of ['2026-13-01', '26-10-26', 'yesterday', '2999-01-01', '2026-02-30', '']) {
        assert.match(problemsWith('hrrr', { access: { corsVerifiedOn: bad } }).join('\n'), /corsVerifiedOn .* is not a YYYY-MM-DD date in the past/, bad);
    }
    assert.deepEqual(problemsWith('hrrr', { access: { corsVerifiedOn: '2026-10-01' } }), []);
});

test('validation: a non-NOAA or derived model carries an attribution', () => {
    const about = real('hrrr').about;
    assert.match(problemsWith('hrrr', { about: { ...about, provider: 'DWD' } }).join('\n'), /attribution is required/);
    assert.match(problemsWith('hrrr', { about: { ...about, derivedFrom: 'a regridding' } }).join('\n'), /attribution is required/);
    assert.deepEqual(problemsWith('hrrr', { about: { ...about, provider: 'DWD', derivedFrom: 'a regridding', attribution: 'DWD via a third party' } }), []);
    assert.match(problemsWith('hrrr', { about: { ...about, provider: ' ' } }).join('\n'), /provider is empty/);
});

test('validation: component aliases look like VARIABLE|level', () => {
    const alias = (components) => problemsWith('hrrr', { idx: { components } }).join('\n');
    assert.match(alias({ TMP: { variable: 'temperature_2m', level: '' } }), /component alias "TMP" must look like VARIABLE\|level/);
    assert.match(alias({ '|2 m': { variable: 'x', level: '' } }), /must look like VARIABLE\|level/);
    assert.match(alias({ 'TMP|2 m above ground': { variable: '', level: '' } }), /names no variable/);
    assert.equal(alias({ 'TMP|2 m above ground': { variable: 'temperature_2m', level: '' } }), '');
});

test('validation: windowMinutes is a positive multiple of the step', () => {
    const f = real('hrrr').fields.find((x) => x.inputs.some((s) => s.timing === 'window'));
    const withWindow = (windowMinutes) => ({ ...f, id: 'HRRR_STRAY', inputs: f.inputs.map((s) => ({ ...s, windowMinutes })) });
    const hrrr = real('hrrr');
    const problems = (windowMinutes) => problemsWith('hrrr', { fields: [...hrrr.fields, withWindow(windowMinutes)] }).join('\n');
    assert.match(problems(90), /windowMinutes 90 must be a positive multiple of the 60-minute step/);
    assert.match(problems(0), /windowMinutes 0 must be a positive multiple/);
    assert.match(problems(-60), /must be a positive multiple/);
    assert.equal(problems(360), '');
});

test('validation: an om source needs a manifest path', () => {
    assert.match(problemsWith('hrrr', { source: { kind: 'om', manifest: ' ' } }).join('\n'), /om source needs a manifest path/);
    assert.deepEqual(problemsWith('hrrr', { source: { kind: 'om', manifest: 'data_spatial/x/latest.json' } }), []);
});

test('validation: lat/lon grids', () => {
    const grid = real('gfs').grid;
    const problems = (edit) => problemsWith('gfs', { grid: { ...grid, ...edit } }).join('\n');
    assert.match(problems({ dlon: 0 }), /nx, ny, dlat, dlon must be positive/);
    assert.match(problems({ lat1: 95 }), /latitudes or first longitude are out of range/);
    assert.match(problems({ ny: 800 }), /latitudes or first longitude are out of range/, 'rows that run past the pole');
    assert.match(problems({ lon1: 360 }), /out of range/);
    assert.match(problems({ nx: 1500 }), /wrap past a full circle/);
    assert.match(problems({ scanMode: 0x50 }), /scanMode 0x50 is not 0x00 or 0x40/);
    assert.match(problems({ radiusM: 1 }), /not an earth radius/);
    assert.equal(problems({}), '');
});

test('the compiled dataset carries about, access, source and capabilities', () => {
    for (const id of MODEL_IDS) {
        const d = getDataset(id);
        assert.equal(d.about, real(id).about);
        assert.equal(d.access, real(id).access);
        assert.deepEqual(d.source, real(id).source ?? { kind: 'grib2-index', dialect: 'wgrib2' });
        assert.ok(d.capabilities.bounds.length === 4);
    }
});

// ── Profiles ──

test('profiles: the real registry offers them on exactly the models the plan names', () => {
    const withProfiles = MODEL_CONFIGS.filter((c) => c.profiles).map((c) => c.id);
    assert.deepEqual(withProfiles, ['hrrr', 'hrrr-subh', 'rrfs', 'rrfs-subh', 'gfs', 'arpege-world', 'ecmwf-ifs', 'ecmwf-aifs', 'aigfs']);
    for (const id of ['hrrr-subh', 'rrfs-subh']) assert.equal(real(id).profiles.borrowFrom.roundMinutes, 60);
});

test('validation: profile levels', () => {
    const profiles = (edit) => ({ ...real('hrrr').profiles, ...edit });
    const msg = (edit) => problemsWith('hrrr', { profiles: profiles(edit) }).join('\n');
    assert.match(msg({ levels: [850, 925, 700] }), /levels must be positive and strictly descending/);
    assert.match(msg({ levels: [850, 850, 700] }), /levels must be positive and strictly descending/);
    assert.match(msg({ levels: [850, 0] }), /levels must be positive and strictly descending/);
    assert.match(msg({ levels: [] }), /levels must be positive and strictly descending/);
    assert.match(msg({ levels: [850, 700], sectionLevels: [850, 500] }), /sectionLevels has 500 hPa, which levels lacks/);
    assert.match(msg({ sectionLevels: [500, 700] }), /sectionLevels must be positive and strictly descending/);
    assert.match(msg({ levels: undefined }), /sectionLevels needs levels/);
    assert.match(msg({ column: { kind: 'open-meteo', model: 'x', levels: [1100] } }), /column levels has 1100 hPa/);
    assert.equal(msg({}), '');
});

test('validation: profile column source', () => {
    const msg = (column) => problemsWith('hrrr', { profiles: { ...real('hrrr').profiles, column } }).join('\n');
    assert.match(msg({ kind: 'open-meteo', model: 'NCEP/HRRR' }), /column model "NCEP\/HRRR"/);
    assert.match(msg({ kind: 'open-meteo', model: 'Ncep_Hrrr' }), /lower-case/);
    assert.equal(msg({ kind: 'open-meteo', model: 'ncep_hrrr_conus' }), '');
    const origins = APPROVED_DATA_ORIGINS.filter((o) => o !== OPEN_METEO_BUCKET);
    const withdrawn = validateConfigs(MODEL_CONFIGS, { colormaps, origins }).join('\n');
    assert.match(withdrawn, /hrrr: profiles column reads https:\/\/openmeteo\.s3\.amazonaws\.com, which is not in APPROVED_DATA_ORIGINS/);
    assert.ok(APPROVED_DATA_ORIGINS.includes(OPEN_METEO_BUCKET), 'the Open-Meteo S3 origin is approved');
});

test('validation: borrowed profiles', () => {
    const msg = (id, borrowFrom, extra = {}) => problemsWith(id, { profiles: { borrowFrom, ...extra } }).join('\n');
    assert.match(msg('hrrr-subh', { dataset: 'nope', roundMinutes: 60 }), /borrow from unknown model nope/);
    assert.match(msg('hrrr-subh', { dataset: 'nbm', roundMinutes: 60 }), /nbm has no profiles of its own/);
    assert.match(msg('hrrr-subh', { dataset: 'rrfs-subh', roundMinutes: 60 }), /rrfs-subh has no profiles of its own/, 'a borrower cannot lend');
    assert.match(msg('hrrr-subh', { dataset: 'hrrr', roundMinutes: 0 }), /roundMinutes must be positive/);
    assert.match(msg('hrrr-subh', { dataset: 'hrrr', roundMinutes: 60 }, { levels: [850] }), /borrowFrom cannot be combined/);
    assert.equal(msg('hrrr-subh', { dataset: 'hrrr', roundMinutes: 60 }), '');
});

test('validation: native profile bundle', () => {
    const native = real('hrrr').profiles.native;
    const msg = (edit, profileEdit = {}) => problemsWith('hrrr', { profiles: { ...real('hrrr').profiles, ...profileEdit, native: { ...native, ...edit } } }).join('\n');
    assert.match(msg({ surface: [] }), /lists no surface components/);
    assert.match(msg({}, { levels: undefined, sectionLevels: undefined, column: undefined }), /native needs levels/);
    const lonely = { sfc: real('hrrr').objects.sfc };
    assert.match(problemsWith('hrrr', { objects: lonely, gate: ['sfc'] }).join('\n'), /native reads the prs object, which no object serves/);
    assert.equal(msg({}), '');
});
