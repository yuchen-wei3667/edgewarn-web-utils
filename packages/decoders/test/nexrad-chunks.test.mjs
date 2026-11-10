import test from 'node:test';
import assert from 'node:assert/strict';
import { ChunkSequence, NexradDecoder } from '../dist/nexrad/index.js';
import { fixtures } from './fixtures/nexrad/core-fixtures.mjs';

const archive = Buffer.from(fixtures.archive, 'base64');

test('chunk ordering, duplicates, missing E and replay from S', () => {
    const s = new ChunkSequence(new NexradDecoder(() => {}));
    assert.throws(() => s.begin('KTLX/1/20261012-025009-002-I'), /order/);
    s.begin('KTLX/1/20261012-025009-001-S'); s.push(archive.subarray(0, 24)); s.end();
    assert.throws(() => s.begin('KTLX/1/20261012-025009-001-S'), /Duplicate/);
    assert.throws(() => s.begin('KTLX/1/20261012-025010-002-E'), /volume/);
    assert.throws(() => s.finish(), /final/);
    s.begin('KTLX/1/20261012-025009-002-E'); s.push(archive.subarray(24)); s.end(); s.finish();
    const replay = new ChunkSequence(new NexradDecoder(() => {}));
    replay.begin('KTLX/1/20261012-025009-001-S'); replay.push(archive.subarray(0, 24)); replay.end();
    replay.begin('KTLX/1/20261012-025009-002-E'); replay.push(archive.subarray(24)); replay.end(); replay.finish();
});
