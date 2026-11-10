import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRegistryView } from './fixtures/registry-view.mjs';

const GOLDEN = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'registry-golden.json'), 'utf8'));
const live = buildRegistryView();

/**
 * `registry-golden.json` was taken from the website's code as it stood before the config registry. Every
 * section is its own test so a failure names what drifted.
 */
// The golden's `order`, `panes`, `paneList`, `legacy` and `fields` sections are stale in the website too (its own golden
// test fails on them: models, panes and fields were added after the snapshot), so they are not ported.
for (const section of ['datasets', 'isobars', 'levels']) {
    test(`the live ${section} equal the pre-registry golden`, () => {
        assert.deepEqual(live[section], GOLDEN[section]);
    });
}

test('the live step choice of every model equals the pre-registry golden', () => {
    assert.deepEqual(Object.keys(live.timeline), Object.keys(GOLDEN.timeline));
    for (const id of Object.keys(GOLDEN.timeline)) assert.deepEqual(live.timeline[id].choose, GOLDEN.timeline[id].choose, id);
});
