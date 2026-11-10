import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODEL_CONFIGS } from '../dist/configs/index.js';
import { APPROVED_DATA_ORIGINS } from '../dist/configs/shared.js';
import { validateConfigs } from '../dist/registry/validate.js';
import { compileDataset } from '../dist/registry/compile.js';
import { findIdxEntry, findIdxWindowEntries, inputsFor, resolveVariable } from '../dist/catalog.js';
import { getDataset } from '../dist/datasets.js';
import { gridMismatch } from '../dist/gridMatch.js';
import { BUILT_IN_PACKINGS, CCSDS_TEMPLATE, JPEG2000_TEMPLATE } from '@edgewarn/web-utils/grib2';
import { parseInventory } from './fixtures/parse-inventory.mjs';
import { projectionFor } from '../dist/projection/index.js';
import { extractColormaps } from '@edgewarn/web-utils/colormap';

/**
 * One contract every registered model must meet, run over MODEL_CONFIGS so a new model is held to it without
 * a new test: config validity, derived capabilities, the projection, the declared grid against a measured
 * one, the packings the decoder reads, the field coverage of a real inventory, and the URLs.
 */

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(ROOT, 'fixtures');
const colormaps = new Set(extractColormaps(JSON.parse(readFileSync(path.join(ROOT, 'fixtures', 'colormaps.json'), 'utf8'))).map((c) => c.name));
const inventories = JSON.parse(readFileSync(path.join(FIX, 'inventories.json'), 'utf8'));
/** Packings the decoder reads: simple, complex, complex with spatial differencing; and, with the ECMWF addon, CCSDS. */
const SUPPORTED_DRT = { wgrib2: new Set(BUILT_IN_PACKINGS), ecmwf: new Set([...BUILT_IN_PACKINGS, CCSDS_TEMPLATE]) };

/** Deterministic pseudo-random numbers, so a failure reproduces. */
function seeded(seed) {
    let s = seed >>> 0;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
}

for (const config of MODEL_CONFIGS) {
    const id = config.id;
    const dataset = getDataset(id);

    test(`${id}: the config passes validation`, () => {
        const problems = validateConfigs(MODEL_CONFIGS, { colormaps }).filter((p) => p.startsWith(`${id}:`));
        assert.deepEqual(problems, []);
    });

    test(`${id}: the derived capabilities agree with the config`, () => {
        const c = dataset.capabilities;
        const longest = Math.max(...dataset.cycleHours.map((h) => dataset.runSteps(h)));
        assert.equal(c.maxLeadHours, longest);
        assert.equal(c.isobars, config.isobars !== null);
        assert.equal(c.barbs, config.fields.some((f) => !f.overlay && ['vector', 'speed-direction'].includes(f.overrides?.[id]?.recipe ?? f.recipe)));
        assert.ok(c.panes.length > 0);
        assert.equal(c.discovery, dataset.source.kind === 'om' ? 'manifest' : 'probe');
        assert.equal(c.projection, dataset.grid.projection);
        assert.equal(c.subHourly, dataset.stepMinutes < 60);
        assert.deepEqual([...c.products], [...dataset.ensembles]);
        const [w, s, e, n] = c.bounds;
        assert.ok(s >= -90 && n <= 90 && s < n && w < e, `bounds ${c.bounds}`);
    });

    test(`${id}: the projection round-trips cells and its bounds hold the grid`, () => {
        const proj = projectionFor(dataset.grid);
        const { nx, ny } = dataset.grid;
        assert.equal(proj.nx, nx);
        assert.equal(proj.ny, ny);
        const rand = seeded(7);
        const cells = [[0, 0], [nx - 1, 0], [0, ny - 1], [nx - 1, ny - 1], [(nx - 1) / 2, (ny - 1) / 2]];
        for (let k = 0; k < 50; k++) cells.push([Math.floor(rand() * nx), Math.floor(rand() * ny)]);
        const boxes = proj.rectBounds(-0.5, -0.5, nx - 0.5, ny - 0.5);
        const inside = (lat, lon) => boxes.some(([w, s, e, n]) => lat >= s - 1e-6 && lat <= n + 1e-6 && lon >= w - 1e-6 && lon <= e + 1e-6);
        for (const [i, j] of cells) {
            const [lat, lon] = proj.inverse(i, j);
            const [i2, j2] = proj.forward(lat, lon);
            assert.ok(Math.hypot(i2 - i, j2 - j) < 1e-6, `(${i}, ${j}) came back as (${i2}, ${j2})`);
            assert.ok(inside(lat, lon), `(${i}, ${j}) at ${lat}, ${lon} is outside the bounds`);
        }
        const target = config.levelTargetsKm[0] * 1000;
        // The first level is the native grid: a cell is no coarser than its target, and not so much finer that a level would be wasted.
        const ratio = proj.cellMetres(0) / target;
        assert.ok(ratio <= 1.1 && ratio >= 0.5, `a cell is ${proj.cellMetres(0)} m against a ${target} m first level`);
    });

    test(`${id}: the declared grid is the one in its measured fixture`, () => {
        const file = path.join(FIX, id, 'grid.json');
        assert.ok(existsSync(file), `tests/fixtures/models/${id}/grid.json is required (read-grid.mjs --json)`);
        const measured = JSON.parse(readFileSync(file, 'utf8'));
        // A moving grid (a storm nest) declares its shape only: its corner is different in every file, so the corner is not compared.
        assert.equal(gridMismatch(dataset.grid, measured.grid, { shapeOnly: !!dataset.movingGrid }), null);
    });

    test(`${id}: every packing it uses is one the decoder reads`, () => {
        if (dataset.source.kind !== 'grib2-index') return;
        const { drt } = JSON.parse(readFileSync(path.join(FIX, id, 'grid.json'), 'utf8'));
        assert.ok(Array.isArray(drt) && drt.length > 0, 'grid.json lists the data representation templates seen');
        const supported = new Set(SUPPORTED_DRT[dataset.source.dialect]);
        if (dataset.source.jpeg2000) supported.add(JPEG2000_TEMPLATE);
        for (const t of drt) assert.ok(supported.has(t), `DRT 5.${t} is not decodable`);
    });

    test(`${id}: every field of the default product is in a real inventory`, () => {
        if (dataset.source.kind === 'netcdf') {
            // One file per variable per step: the names a run lists, at the hours each cycle publishes.
            const listed = JSON.parse(readFileSync(path.join(FIX, id, 'files.json'), 'utf8'));
            for (const def of config.fields) for (const sel of inputsFor(def, id)) {
                const alias = dataset.components?.[`${sel.variable}|${sel.level}`];
                assert.ok(alias, `${def.id}: no component alias for ${sel.variable}|${sel.level}`);
                assert.ok(listed.names.includes(alias.variable), `${def.id}: ${alias.variable} is not a published file`);
                if (alias.level) {
                    // A level of a third-axis file: hPa in a pressure-level file, metres in the height-level one.
                    const levels = alias.variable.endsWith('on_pressure_levels') ? (listed.pressureLevelsPa[alias.variable] ?? listed.pressureLevelsPa.default).map((pa) => pa / 100) : listed.heightsM;
                    assert.ok(levels.includes(Number(alias.level)), `${def.id}: ${alias.level} is not a published level of ${alias.variable}`);
                }
                const expand = (ranges) => new Set(ranges.flatMap(({ from, to, every }) => Array.from({ length: Math.floor((to - from) / every) + 1 }, (_, k) => (from + k * every) * 60)));
                const own = listed.restricted[alias.variable] ?? (alias.variable.includes('{window}') ? listed.restricted.windowed : null);
                for (const [cycle, run] of Object.entries(listed.runs)) {
                    const published = expand(own?.[cycle] ?? run.steps);
                    for (const minutes of dataset.fieldSteps(def.id, Number(cycle)) ?? dataset.stepsFor(Number(cycle))) {
                        if (listed.knownMissingMinutes[alias.variable]?.[cycle]?.includes(minutes)) continue;
                        assert.ok(published.has(minutes), `${def.id}: +${minutes} min is not published at ${cycle} UTC`);
                    }
                }
            }
            return;
        }
        if (dataset.source.kind === 'om') {
            const sets = JSON.parse(readFileSync(path.join(FIX, id, 'manifests.json'), 'utf8'));
            for (const def of config.fields) for (const sel of inputsFor(def, id)) {
                const manifest = sets[dataset.fileOf(sel.file, dataset.ensembles[0])];
                assert.ok(manifest.variables.includes(resolveVariable(dataset, sel.variable, sel.exact, sel.level)), `${def.id}: OM variable is missing`);
                for (const minutes of dataset.fieldSteps(def.id, 12) ?? dataset.stepsFor(12)) {
                    assert.ok(manifest.valid_times.includes(new Date(Date.parse(manifest.reference_time) + minutes * 60_000).toISOString().slice(0, 16) + 'Z'), `${def.id}: +${minutes} min is missing`);
                }
            }
            return;
        }
        const sets = Object.values(inventories).filter((s) => s.model === id && !s.report);
        assert.ok(sets.length > 0, `inventories.json has no entry for ${id}`);
        // A product that reads the same object as another (normalized spread reads the spread files) is covered by that product's inventory.
        const objectOf = (product) => config.products?.find((p) => p.id === product)?.object;
        const inventoryFor = (product) => sets.find((s) => s.product === product) ?? sets.find((s) => objectOf(s.product) !== undefined && objectOf(s.product) === objectOf(product));
        for (const product of dataset.ensembles) {
            assert.ok(inventoryFor(product), `inventories.json has no ${id} entry for product ${product}`);
        }
        const set = inventoryFor(dataset.ensembles[0]);
        const product = dataset.ensembles[0];
        const entriesOf = Object.fromEntries(Object.entries(set.files).map(([k, f]) => [k, parseInventory(dataset, readFileSync(path.join(FIX, f), 'utf8'))]));
        for (const def of config.fields) {
            if (def.product !== undefined && def.product !== product) continue;
            for (const sel of inputsFor({ ...def, overrides: def.overrides }, id)) {
                const entries = entriesOf[dataset.fileOf(sel.file, product)];
                assert.ok(entries, `${def.id}: no inventory for its ${sel.file} object`);
                const minutes = sel.timing === 'sum-window' ? Math.ceil(set.step / 60) * 60 : set.step;
                const found = sel.timing === 'sum-window'
                    ? findIdxWindowEntries(entries, sel, minutes, dataset, product).length === (sel.sumCount ?? 1)
                    : findIdxEntry(entries, sel, minutes, dataset, product) !== null;
                assert.ok(found, `${def.id} on ${id}: ${sel.variable}:${sel.level} is missing at +${minutes} min`);
            }
        }
    });

    test(`${id}: its native profile bundle is in a real inventory at every profile level`, () => {
        const native = config.profiles?.native;
        if (!native) return;
        const set = Object.values(inventories).find((s) => s.model === id && s.product === dataset.ensembles[0] && !s.report);
        const entries = parseInventory(dataset, readFileSync(path.join(FIX, set.files[dataset.fileOf(native.file, set.product)]), 'utf8'));
        const has = (variable, level, file = native.file) => findIdxEntry(entries, { file, variable, level, timing: 'instant' }, set.step, dataset, set.product) !== null;
        for (const mb of config.profiles.levels) {
            for (const variable of ['HGT', 'TMP', 'UGRD', 'VGRD', native.moisture, ...(native.omega ? [native.omega] : [])]) {
                assert.ok(has(variable, `${mb} mb`), `${variable}:${mb} mb is missing`);
            }
        }
        const surfaceEntries = parseInventory(dataset, readFileSync(path.join(FIX, set.files[dataset.fileOf('sfc', set.product)]), 'utf8'));
        for (const s of native.surface) {
            assert.ok(findIdxEntry(surfaceEntries, s, set.step, dataset, set.product) !== null, `surface ${s.variable}:${s.level} is missing`);
        }
    });

    test(`${id}: object URLs are https, on an approved origin and differ by step`, () => {
        for (const date of ['20261012', '20270102']) {
            for (const cycle of dataset.cycleHours) {
                for (const file of dataset.files) {
                    const urls = [0, 1, 2, 12].map((step) => dataset.url(date, cycle, file, step));
                    for (const url of urls) {
                        assert.match(url, /^https:\/\//);
                        assert.ok(APPROVED_DATA_ORIGINS.some((origin) => url.startsWith(`${origin}/`)), url);
                        assert.ok(!url.includes('..') && !/undefined|NaN/.test(url), url);
                    }
                    assert.equal(new Set(urls).size, urls.length, `${file} gives the same URL for different steps`);
                }
            }
        }
    });

    test(`${id}: a clone under another id validates and compiles to the same capabilities`, () => {
        const clone = { ...config, id: `${id}-clone`, label: `${config.label} clone` };
        assert.deepEqual(validateConfigs([...MODEL_CONFIGS, clone], { colormaps }), []);
        const compiled = compileDataset(clone);
        assert.deepEqual(compiled.capabilities, dataset.capabilities);
        assert.deepEqual(compiled.grid, dataset.grid);
    });
}
