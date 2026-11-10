import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODEL_CONFIGS } from '../dist/configs/index.js';
import { validateConfigs } from '../dist/registry/validate.js';
import { compileDataset, compileFields } from '../dist/registry/compile.js';
import { findIdxEntry, getModelField, inputsFor, MODEL_FIELDS } from '../dist/catalog.js';
import { getDataset } from '../dist/datasets.js';
import { parseIdx } from '@edgewarn/web-utils/grib2';
import { extractColormaps } from '@edgewarn/web-utils/colormap';

/**
 * The acceptance test for "adding a model is config only": an in-memory copy of `nbm` under another id,
 * dropped into a copy of the registry array, is accepted by every consumer of the registry with no other
 * change. The consumers read the registry through the same functions the app does, only handed the
 * longer array (the module-level registry itself is built once from `MODEL_CONFIGS`).
 */

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(ROOT, 'fixtures');
const colormaps = new Set(extractColormaps(JSON.parse(readFileSync(path.join(ROOT, 'fixtures', 'colormaps.json'), 'utf8'))).map((c) => c.name));

const nbm = MODEL_CONFIGS.find((c) => c.id === 'nbm');
const CLONE_ID = 'nbm-clone';
const clone = { ...nbm, id: CLONE_ID, label: 'NBM clone' };
const registry = [...MODEL_CONFIGS, clone];

test('a copy of nbm under another id passes validation', () => {
    assert.deepEqual(validateConfigs(registry, { colormaps }), []);
    assert.match(validateConfigs([...MODEL_CONFIGS, nbm], { colormaps }).join('\n'), /id is used by another model/, 'the same id twice still fails');
});

test('the copy compiles to the dataset the engine reads', () => {
    const real = getDataset('nbm');
    const copy = compileDataset(clone);
    assert.equal(copy.id, CLONE_ID);
    assert.equal(copy.label, 'NBM clone');
    assert.deepEqual(copy.grid, real.grid);
    assert.deepEqual([...copy.factors], [...real.factors]);
    assert.equal(copy.bucket, real.bucket);
    assert.equal(copy.defaultField, real.defaultField);
    for (const minutes of [60, 720, 3060, 11880]) assert.equal(copy.fileIndexOf(minutes), real.fileIndexOf(minutes), `file index at ${minutes} min`);
    assert.equal(copy.url('20261012', 12, 'core', 12), real.url('20261012', 12, 'core', 12));
});

test('a copy of hrrr with its profiles block is accepted and keeps the capability, with no engine change', () => {
    const hrrr = MODEL_CONFIGS.find((c) => c.id === 'hrrr');
    const copy = { ...hrrr, id: 'hrrr-clone', label: 'HRRR clone' };
    assert.ok(copy.profiles?.column, 'hrrr declares a column source');
    assert.deepEqual(validateConfigs([...MODEL_CONFIGS, copy], { colormaps }), []);
    assert.equal(compileDataset(copy).capabilities.profiles, 'column');
    const stripped = { ...copy, profiles: undefined };
    assert.equal(compileDataset(stripped).capabilities.profiles, null, 'without the block the clone has none');
});

test('the copy is offered exactly the fields nbm is', () => {
    const fields = compileFields(registry);
    const offeredBy = (model) => fields.filter((f) => !f.overlay && f.models.includes(model)).map((f) => f.id);
    assert.ok(offeredBy('nbm').length > 0);
    assert.deepEqual(offeredBy(CLONE_ID), offeredBy('nbm'));
    assert.deepEqual(fields.map((f) => f.id), MODEL_FIELDS.map((f) => f.id), 'no field is added or reordered by a second model that lists the same ones');
});

test('every field the copy lists is in the measured nbm inventory', () => {
    const inventories = JSON.parse(readFileSync(path.join(FIX, 'inventories.json'), 'utf8'));
    const set = inventories.nbm;
    const entries = parseIdx(readFileSync(path.join(FIX, set.files.core), 'utf8'));
    const copy = compileDataset(clone);
    const fields = compileFields(registry).filter((f) => f.models.includes(CLONE_ID));
    assert.ok(fields.length > 0);
    for (const def of fields) {
        assert.ok(getModelField(def.id), def.id);
        for (const sel of inputsFor(def, CLONE_ID)) {
            assert.ok(findIdxEntry(entries, sel, set.step, copy, set.product) !== null, `${def.id} on ${CLONE_ID}: component missing`);
        }
    }
});
