import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDataset, MODEL_IDS } from '../dist/datasets.js';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** Files allowed to name a model: the config itself, and prose written for people. */
const ALLOWED = [
    `${path.sep}configs${path.sep}`,
];

function* sources(dir) {
    for (const name of readdirSync(dir)) {
        const file = path.join(dir, name);
        if (statSync(file).isDirectory()) yield* sources(file);
        else if (/\.(ts|tsx)$/.test(name)) yield file;
    }
}

/** Source without comments, so a note explaining what HRRR does is not a hardcoded model. */
const withoutComments = (text) => text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

/** The family name of every registered model: the first word of its label ("HRRR 15-min" is HRRR). */
const familyNames = () => [...new Set(MODEL_IDS.map((id) => getDataset(id).label.split(' ')[0]))];

test('the family names searched for are derived from the registry and cover every model', () => {
    const names = new RegExp(`\\b(${familyNames().join('|')})\\b`);
    for (const id of MODEL_IDS) assert.match(getDataset(id).label, names, id);
    assert.ok(familyNames().length >= 5);
});

test('no model is hardcoded outside the config: not by id, not by name', () => {
    const ids = MODEL_IDS.map((id) => id.replace(/[-]/g, '\\-')).join('|');
    const quotedId = new RegExp(`['"\`](${ids})['"\`]`);
    // The family names that appear in labels, whichever models are registered.
    const names = new RegExp(`\\b(${familyNames().join('|')})\\b`);
    const found = [];
    for (const file of sources(SRC)) {
        if (ALLOWED.some((a) => file.includes(a))) continue;
        withoutComments(readFileSync(file, 'utf8')).split('\n').forEach((line, i) => {
            if (quotedId.test(line) || names.test(line)) found.push(`${path.relative(SRC, file)}:${i + 1}: ${line.trim().slice(0, 100)}`);
        });
    }
    assert.deepEqual(found, [], 'a model named in code outside src/configs/ cannot be added or removed by config alone');
});
