// Snapshot of runtime export names for every public subpath.
// `node scripts/api-surface.mjs` checks, `--update` rewrites api-surface.json.
// Resolves through the package name, so it also works inside a packed install.
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const name = '@edgewarn/web-utils';
const snapshotPath = new URL(process.env.API_SURFACE_SNAPSHOT ?? '../api-surface.json', import.meta.url);
const {
    default: { exports: exportsMap },
} = await import(name + '/package.json', { with: { type: 'json' } });

const surface = {};
for (const subpath of Object.keys(exportsMap).filter((key) => key !== './package.json')) {
    const mod = await import(name + subpath.slice(1));
    surface[subpath] = Object.keys(mod).sort();
}

if (process.argv.includes('--update')) {
    writeFileSync(snapshotPath, JSON.stringify(surface, null, 2) + '\n');
    console.log('api-surface.json updated');
} else {
    const expected = JSON.parse(readFileSync(snapshotPath, 'utf8'));
    assert.deepEqual(surface, expected, 'public API changed: review, then run `npm run api:update`');
    console.log('api surface matches snapshot');
}
