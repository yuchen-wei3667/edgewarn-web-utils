import test from 'node:test';
import assert from 'node:assert/strict';
import { GoesBandCache, GoesHttpError, fetchRange } from '@edgewarn/web-utils/goes/feed';
import { FakeResponseStore, seededBytes } from './helpers/fakes.mjs';

const bytes = (n, seed = 1) => seededBytes(n, seed);

test('a put fills memory and the store; a fresh cache over the same store reads it back', async () => {
    const store = new FakeResponseStore();
    const one = new GoesBandCache({ store, memoryBytes: 1e6 });
    const run = bytes(500);
    await one.put('C13/b0', run, 0);
    assert.equal(one.stats.puts, 1);
    assert.deepEqual(await one.get('C13/b0'), run);
    assert.equal(one.stats.memoryHits, 1);
    const two = new GoesBandCache({ store, memoryBytes: 1e6 });
    assert.deepEqual(await two.get('C13/b0'), run);
    assert.equal(two.stats.hits, 1);
    assert.equal(await two.get('missing'), null);
    assert.equal(two.stats.misses, 1);
    assert.equal(two.totalBytes, 500);
});

test('memory keeps the newest runs under its byte budget and skips runs larger than it', async () => {
    const cache = new GoesBandCache({ memoryBytes: 1000 });
    await cache.put('a', bytes(400, 1), 0);
    await cache.put('b', bytes(400, 2), 0);
    await cache.get('a'); // a is now newer than b
    await cache.put('c', bytes(400, 3), 0);
    assert.ok(await cache.get('a'));
    assert.equal(await cache.get('b'), null, 'the least recently used run is evicted');
    await cache.put('big', bytes(2000), 0);
    assert.equal(await cache.get('big'), null, 'a run over the budget is not held in memory');
    assert.equal(cache.disabled, true, 'no store means memory only');
});

test('memory entries expire after the retention period, measured from when they were stored', async () => {
    let t = 0;
    const cache = new GoesBandCache({ memoryBytes: 1e6, now: () => t, retentionMs: 1000 });
    await cache.put('a', bytes(10), 0);
    t = 999;
    assert.ok(await cache.get('a'));
    t = 1000;
    assert.equal(await cache.get('a'), null);
});

test('a store hit keeps the store time, so memory does not outlive the stored copy', async () => {
    let t = 10_000;
    const store = new FakeResponseStore();
    await new GoesBandCache({ store, memoryBytes: 1e6 }).put('a', bytes(10), 0);
    store.entries.get('https://goes-bands.invalid/a').storedAt = 10_000 - 900; // stored 900 ms ago, retention 1000 ms
    const reader = new GoesBandCache({ store, memoryBytes: 1e6, now: () => t, retentionMs: 1000 });
    assert.ok(await reader.get('a'));
    assert.equal(reader.stats.hits, 1);
    t += 99;
    assert.ok(await reader.get('a'));
    assert.equal(reader.stats.memoryHits, 1);
    t += 2; // 101 ms after the read: the 100 ms left of the stored copy have run out
    assert.ok(await reader.get('a'), 'the store still has it');
    assert.equal(reader.stats.hits, 2, 'but memory no longer does, so it came from the store');
});

test('a store response without a stored-at header is retained in memory', async () => {
    let t = 10_000;
    const store = new FakeResponseStore();
    store.get = async () => new Response(bytes(10));
    const cache = new GoesBandCache({ store, memoryBytes: 100, now: () => t, retentionMs: 1000 });
    await cache.get('a');
    t += 999;
    await cache.get('a');
    assert.equal(cache.stats.memoryHits, 1);
    t++;
    await cache.get('a');
    assert.equal(cache.stats.hits, 2);
});

test('configure forwards the budget to the store and trims memory', async () => {
    const store = new FakeResponseStore();
    const cache = new GoesBandCache({ store, memoryBytes: 1000 });
    await cache.put('a', bytes(400), 0);
    await cache.put('b', bytes(400, 2), 0);
    cache.configure(5, 6, 400);
    assert.deepEqual(store.configured, { maxBytes: 5, maxAgeMs: 6 });
    await cache.get('a'); // a is no longer in memory (b is newer), so this is a store hit
    assert.equal(cache.stats.memoryHits, 0);
    assert.equal(cache.stats.hits, 1);
});

test('a failing store is counted, never thrown', async () => {
    const store = new FakeResponseStore();
    store.put = async () => { throw new Error('quota'); };
    const cache = new GoesBandCache({ store, memoryBytes: 1e6 });
    await cache.put('a', bytes(10), 0);
    assert.equal(cache.stats.putFailures, 1);
    assert.ok(await cache.get('a'), 'memory still has it');
});

test('fetchRange reads one range whole and copes with servers that ignore Range', async () => {
    const file = bytes(100);
    const ranged = async (_u, init) => {
        const [, a, b] = /bytes=(\d+)-(\d+)/.exec(init.headers.Range);
        return new Response(file.slice(+a, +b + 1), { status: 206 });
    };
    const whole = async () => new Response(file.slice(), { status: 200 });
    for (const fetcher of [ranged, whole]) assert.deepEqual(await fetchRange('u', 10, 30, fetcher), file.subarray(10, 30));
    await assert.rejects(fetchRange('u', 10, 30, async () => new Response('', { status: 404 })), (e) => e instanceof GoesHttpError && e.status === 404);
    await assert.rejects(fetchRange('u', 90, 120, ranged), /came back with 10 bytes/);
});
