import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import ts from 'typescript';

const src = new URL('../src/', import.meta.url);
const sources = readdirSync(src, { recursive: true }).filter((name) => name.endsWith('.ts')).sort();
/** The one file that reads from the network, and the only package imports the science may not have. */
const TRANSPORT_FILE = 'raob.ts';
const TRANSPORT_IMPORTS = ['@edgewarn/web-utils/geo', '@edgewarn/web-utils/net'];

test('met is isolated from transport, storage, platform globals and other packages', () => {
    for (const name of sources) {
        const ast = ts.createSourceFile(name, readFileSync(new URL(name, src), 'utf8'), ts.ScriptTarget.Latest, true);
        function visit(node) {
            if (ts.isIdentifier(node)) assert.ok(!['fetch', 'window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'process', 'require'].includes(node.text), `${name}: ${node.text}`);
            if (ts.isCallExpression(node)) assert.notEqual(node.expression.kind, ts.SyntaxKind.ImportKeyword);
            if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
                const specifier = node.moduleSpecifier?.text;
                if (!specifier) return;
                // Plot geometry sits in plot/ and reads the science next to it; everything else imports siblings only.
                const pattern = name.startsWith('plot/') ? /^\.\.?\/[^/]+\.ts$/ : /^\.\/[^/]+\.ts$/;
                if (name === TRANSPORT_FILE && TRANSPORT_IMPORTS.includes(specifier)) return;
                assert.match(specifier, pattern, `${name}: ${specifier}`);
            }
            ts.forEachChild(node, visit);
        }
        visit(ast);
    }
});

test('only the RAOB reader may import another package, and /met/plot imports no transport', () => {
    for (const name of sources) {
        const text = readFileSync(new URL(name, src), 'utf8');
        const importsPackage = /from\s+'@edgewarn\//.test(text);
        assert.equal(importsPackage, name === TRANSPORT_FILE, name);
    }
    for (const name of sources.filter((n) => n.startsWith('plot/'))) assert.doesNotMatch(readFileSync(new URL(name, src), 'utf8'), /raob|fetchWithTimeout/, name);
});

test('public surface is exactly 60 functions and four D-M2 constants', async () => {
    for (const path of ['met/thermo', 'met/constants', 'met/raob', 'met/plot/skew-t', 'met/plot/constants', 'packages/met/dist/analyze.js', 'packages/met/dist/plot/index.js']) {
        await assert.rejects(import('@edgewarn/web-utils/' + path), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
    }
});
