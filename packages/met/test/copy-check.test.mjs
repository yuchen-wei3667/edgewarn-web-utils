import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('validation metadata', root), 'utf8'));
const hash = value => createHash('sha256').update(value).digest('hex');

// Includes nested functions and arrow bodies; import paths and type exports cannot affect this lock.
export function bodyHashes(source) {
    const ast = ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true);
    const bodies = [];
    function visit(node) {
        if (ts.isFunctionLike(node) && node.body) bodies.push(hash(node.body.getText(ast)));
        ts.forEachChild(node, visit);
    }
    visit(ast);
    return bodies;
}

test('all science function bodies match the pinned Website source', () => {
    assert.match(manifest.commit, /^[a-f0-9]{40}$/);
    for (const [path, expected] of Object.entries(manifest.unchangedBodyHashes)) {
        assert.deepEqual(bodyHashes(readFileSync(new URL(path, root), 'utf8')), expected, path);
    }
    for (const [path, expected] of Object.entries(manifest.adaptedFileHashes)) {
        assert.equal(hash(readFileSync(new URL(path, root))), expected, path);
    }
});
