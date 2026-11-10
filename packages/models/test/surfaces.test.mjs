import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODEL_CONFIGS } from '../dist/configs/index.js';
import { validateConfigs } from '../dist/registry/validate.js';
import { compileDataset } from '../dist/registry/compile.js';
import { getDataset, isMapModelId, MAP_MODEL_IDS, MODEL_IDS, VIEWER_MODEL_IDS } from '../dist/datasets.js';
import { extractColormaps } from '@edgewarn/web-utils/colormap';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const colormaps = new Set(extractColormaps(JSON.parse(readFileSync(path.join(ROOT, 'fixtures', 'colormaps.json'), 'utf8'))).map((c) => c.name));

/** The interactive map keeps the six models it has always had; GFS (and ICON) are the viewer's alone (D2). */
test('the map offers exactly the six original models', () => {
    assert.deepEqual([...MAP_MODEL_IDS], ['hrrr', 'hrrr-subh', 'rrfs', 'rrfs-subh', 'refs', 'nbm']);
    assert.ok(!MAP_MODEL_IDS.includes('gfs'));
    assert.ok(isMapModelId('hrrr') && !isMapModelId('gfs') && !isMapModelId('nope'));
});

test('the viewer offers every registered model, and MODEL_IDS stays the full list', () => {
    assert.deepEqual([...VIEWER_MODEL_IDS], [...MODEL_IDS]);
    assert.ok(MODEL_IDS.includes('gfs'));
});

test('a clone declaring only the viewer validates and compiles viewer-only', () => {
    const hrrr = MODEL_CONFIGS.find((c) => c.id === 'hrrr');
    const clone = { ...hrrr, id: 'hrrr-viewer-only', label: 'HRRR viewer', surfaces: ['viewer'] };
    assert.deepEqual(validateConfigs([...MODEL_CONFIGS, clone], { colormaps }), []);
    assert.deepEqual([...compileDataset(clone).surfaces], ['viewer']);
});

test('validation rejects empty, unknown and repeated surfaces', () => {
    const hrrr = MODEL_CONFIGS.find((c) => c.id === 'hrrr');
    const problems = (surfaces) => validateConfigs(MODEL_CONFIGS.map((c) => (c === hrrr ? { ...hrrr, surfaces } : c)), { colormaps }).join('\n');
    assert.match(problems([]), /surfaces is empty/);
    assert.match(problems(['phone']), /unknown page "phone"/);
    assert.match(problems(['map', 'map']), /repeats a page/);
    assert.equal(problems(['viewer']), '');
});

test('GFS is a viewer-only model with the surfaces the config says', () => {
    assert.deepEqual([...getDataset('gfs').surfaces], ['viewer']);
    for (const id of MAP_MODEL_IDS) assert.ok(getDataset(id).surfaces.includes('map'), id);
});
