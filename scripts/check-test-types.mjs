#!/usr/bin/env node
/**
 * Type-level health check for the .mjs test suite.
 *
 * Runs `tsc -p tsconfig.check.json` (allowJs + checkJs over every test file
 * against the built package types) and fails on module-resolution errors:
 * TS2307 (cannot find module) and TS2305 (module has no such export). These
 * are the errors that mean a test imports something that no longer exists —
 * the main way a JS-only suite rots silently.
 *
 * Structural errors (TS2322/TS2345/..., ~500 lines) are triaged, not gated:
 * fixtures deliberately build partial shapes that the runtime accepts, and
 * gating on them would force test-only type gymnastics. They are reported in
 * the summary so the debt stays visible; full structural checkJs remains a
 * known follow-up (see TESTING.md).
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tsc = resolve(root, 'node_modules/typescript/bin/tsc');

// Build first so `@edgewarn/web-utils/*` specifiers resolve to dist types.
const build = spawnSync(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '-b'], {
    cwd: root,
    stdio: 'inherit',
});
if (build.status !== 0) process.exit(build.status ?? 1);

const result = spawnSync(
    process.execPath,
    [tsc, '-p', resolve(root, 'tsconfig.check.json'), '--pretty', 'false'],
    {
        cwd: root,
        encoding: 'utf8',
    },
);
const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
const errors = output.split('\n').filter((line) => /error TS\d+/.test(line));
const gating = errors.filter((line) => /error TS2307|error TS2305/.test(line));

if (gating.length) {
    console.error('test type-check failed (module resolution):');
    for (const line of gating) console.error('  ' + line);
    process.exit(1);
}
console.log(
    `test:types OK — all test imports resolve against the built types ` +
        `(${errors.length} structural fixture findings triaged, see TESTING.md).`,
);
