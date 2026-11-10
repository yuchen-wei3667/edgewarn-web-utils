import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelMessageCache } from '../dist/messageCache.js';
import { TtlMap, CACHE_RETENTION_MS } from '../dist/internal/ttl-map.js';
import { FakeResponseStore } from './helpers/fake-store.mjs';

const bytes = (n, fill = 1) => new Uint8Array(n).fill(fill);

test('without a store the cache is memory only and never persists', async () => {
    const cache = new ModelMessageCache({ memoryBytes: 100 });
    assert.equal(cache.disabled, true);
    assert.equal(await cache.get('a'), null);
    await cache.put('a', bytes(10));
    assert.deepEqual(await cache.get('a'), bytes(10));
    assert.deepEqual(cache.stats, { memoryHits: 1, diskHits: 0, misses: 1, puts: 0, putFailures: 0 });
    assert.equal(cache.diskBytes, 0);
});

test('a message goes to the injected store and comes back from it once memory has let go', async () => {
    const store = new FakeResponseStore();
    const writer = new ModelMessageCache({ store, memoryBytes: 100 });
    await writer.put('a', bytes(10, 7));
    assert.equal(writer.stats.puts, 1);
    assert.equal(writer.diskBytes, 10);
    const reader = new ModelMessageCache({ store, memoryBytes: 100 });
    assert.deepEqual(await reader.get('a'), bytes(10, 7));
    assert.deepEqual(reader.stats, { memoryHits: 0, diskHits: 1, misses: 0, puts: 0, putFailures: 0 });
    assert.deepEqual(await reader.get('a'), bytes(10, 7));
    assert.equal(reader.stats.memoryHits, 1);
});

test('a refused or failing store write is counted and the message still serves from memory', async () => {
    const store = new FakeResponseStore();
    store.failPut = true;
    const cache = new ModelMessageCache({ store, memoryBytes: 100 });
    await cache.put('a', bytes(10));
    assert.equal(cache.stats.putFailures, 1);
    assert.deepEqual(await cache.get('a'), bytes(10));
    store.disabled = true;
    await cache.put('b', bytes(10));
    assert.equal(cache.stats.putFailures, 1, 'a disabled store is skipped, not a failure');
});

test('memory holds at most its budget, dropping the least recently used message first', async () => {
    const cache = new ModelMessageCache({ memoryBytes: 25 });
    await cache.put('a', bytes(10));
    await cache.put('b', bytes(10));
    await cache.get('a');
    await cache.put('c', bytes(10));
    assert.equal(await cache.get('b'), null);
    assert.ok(await cache.get('a') && await cache.get('c'));
    await cache.put('huge', bytes(26));
    assert.equal(await cache.get('huge'), null, 'a message over the budget is never held in memory');
});

test('memory entries expire on the cache clock, and the store takes the new budget', async () => {
    let now = 1_000;
    const store = new FakeResponseStore();
    const cache = new ModelMessageCache({ store, memoryBytes: 100, now: () => now });
    await cache.put('a', bytes(10));
    store.entries.clear();
    now += CACHE_RETENTION_MS + 1;
    assert.equal(await cache.get('a'), null);
    cache.configure(50, 1000, 2000);
    assert.deepEqual(store.configured, { maxBytes: 1000, maxAgeMs: 2000 });
});

test('TtlMap drops entries after their deadline without any timer, and touch keeps the deadline', () => {
    let now = 0;
    const expired = [];
    const map = new TtlMap({ now: () => now, ttlMs: 100, onExpire: (value, key) => expired.push([key, value]) });
    map.set('a', 1);
    now = 50;
    map.set('b', 2);
    map.touch('a');
    assert.deepEqual([...map.keys()], ['b', 'a'], 'touch moves an entry to the newest position');
    now = 100;
    assert.equal(map.get('a'), undefined, 'touching did not extend the deadline');
    assert.equal(map.get('b'), 2);
    assert.deepEqual(expired, [['a', 1]]);
    now = 1e12;
    map.set('c', 3, 10 * CACHE_RETENTION_MS);
    now += CACHE_RETENTION_MS + 1;
    assert.equal(map.has('c'), false, 'no entry outlives the retention cap');
});
