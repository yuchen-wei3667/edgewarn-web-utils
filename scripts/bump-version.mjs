#!/usr/bin/env node
// Bump the hand-managed CalVer prerelease counter (YYYY.MM.DD-alpha.N).
// Keeps package.json, package-lock.json, and the README version line in sync.
// Usage: npm run bump
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = join(root, 'package.json');
const lockPath = join(root, 'package-lock.json');
const readmePath = join(root, 'README.md');

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const m = /^(\d{4}\.\d{1,2}\.\d{1,2})-alpha\.(\d+)$/.exec(pkg.version);
if (!m) {
    console.error(`bump: expected version YYYY.MM.DD-alpha.N, got ${pkg.version}`);
    process.exit(1);
}
const next = `${m[1]}-alpha.${Number(m[2]) + 1}`;
pkg.version = next;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

// package-lock.json mirrors the root version in two places.
const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
lock.version = next;
if (lock.packages && lock.packages['']) lock.packages[''].version = next;
writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');

const readme = readFileSync(readmePath, 'utf8');
const updated = readme.replace(`Version \`${m[0]}\``, `Version \`${next}\``);
if (updated !== readme) writeFileSync(readmePath, updated);

console.log(`bumped ${m[0]} -> ${next}`);
console.log('next: add a CHANGELOG.md entry, commit, then tag v' + next + ' and push the tag to release');
