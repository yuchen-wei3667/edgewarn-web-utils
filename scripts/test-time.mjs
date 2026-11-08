#!/usr/bin/env node
/**
 * Time-sensitive tests across multiple time zones.
 *
 * Test files are discovered by glob (every test file whose name contains
 * "time") plus the alert-format test (it formats local times), and run
 * once per time zone below, including environments that exercise DST and a
 * non-US zone. Keep the zone list in this one file.
 */
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const TIME_ZONES = ['UTC', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo'];
const EXTRA_TIME_TESTS = ['packages/alerts/test/alert-format.test.mjs'];

function discoverTimeTests() {
    const found = [];
    for (const dir of [
        'packages/core/test',
        'packages/alerts/test',
        'packages/met/test',
        'packages/decoders/test',
    ]) {
        for (const name of readdirSync(dir)) {
            if (name.includes('time') && name.endsWith('.test.mjs')) found.push(`${dir}/${name}`);
        }
    }
    return [...found, ...EXTRA_TIME_TESTS.filter((f) => !found.includes(f))];
}

const files = discoverTimeTests();
if (!files.length) {
    console.error('test:time: no time-sensitive test files discovered');
    process.exit(1);
}

for (const tz of TIME_ZONES) {
    const run = spawnSync(process.execPath, ['--test', ...files], {
        env: { ...process.env, TZ: tz },
        stdio: 'inherit',
    });
    if (run.status !== 0) {
        console.error(`test:time: failed under TZ=${tz}`);
        process.exit(run.status ?? 1);
    }
}
console.log(`test:time OK — ${files.length} files × ${TIME_ZONES.length} zones (${TIME_ZONES.join(', ')})`);
