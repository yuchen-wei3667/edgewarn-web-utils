import test from 'node:test';
import assert from 'node:assert/strict';
import { GzCache, MrmsHttpError } from '@edgewarn/web-utils/mrms';
import { FakeResponseStore, makeFetch, seededBytes, until } from './helpers/fakes.mjs';

const A = 'https://x/a.grib2.gz';
const read = async (stream) => { const out = []; for await (const c of stream) out.push(...c); return Uint8Array.from(out); };

test('a miss goes to the network and fills the store; the next open is served from it', async () => {
    const store = new FakeResponseStore();
    const file = seededBytes(20000);
    const { fetcher, calls } = makeFetch(new Map([[A, file]]));
    const cache = new GzCache({ store });
    const first = await cache.open(A, { fetcher });
    assert.equal(first.fromCache, false);
    assert.deepEqual(await read(first.body), file);
    await until(() => cache.stats.puts === 1);
    const second = await cache.open(A, { fetcher });
    assert.equal(second.fromCache, true);
    assert.deepEqual(await read(second.body), file);
    assert.equal(calls.length, 1);
    assert.equal(cache.stats.hits, 1);
    assert.equal(cache.totalBytes, 20000);
});

test('the store keeps downloading after the decoder stops reading early', async () => {
    const store = new FakeResponseStore();
    const file = seededBytes(60000, 3);
    const { fetcher } = makeFetch(new Map([[A, file]]), { chunk: 1000 });
    const cache = new GzCache({ store });
    const reader = (await cache.open(A, { fetcher })).body.getReader();
    await reader.read();
    await reader.cancel();
    await until(() => cache.stats.puts === 1);
    const again = await cache.open(A, { fetcher });
    assert.equal(again.fromCache, true);
    assert.deepEqual(await read(again.body), file);
});

test('a store write failure falls back to network-only for that file', async () => {
    const store = new FakeResponseStore();
    store.failPut = true;
    const cache = new GzCache({ store });
    const { fetcher, calls } = makeFetch(new Map([[A, seededBytes(3000)]]));
    assert.equal((await read((await cache.open(A, { fetcher })).body)).length, 3000);
    await until(() => cache.stats.putFailures === 1);
    const next = await cache.open(A, { fetcher });
    assert.equal(next.fromCache, false);
    await read(next.body);
    assert.equal(calls.length, 2);
});

test('a store whose put rejects counts as a failure instead of an unhandled rejection', async () => {
    const store = new FakeResponseStore();
    store.put = async () => { throw new Error('boom'); };
    const cache = new GzCache({ store });
    const { fetcher } = makeFetch(new Map([[A, seededBytes(100)]]));
    await read((await cache.open(A, { fetcher })).body);
    await until(() => cache.stats.putFailures === 1);
});

test('no store, or a disabled one, means network-only and never a failure', async () => {
    const file = seededBytes(2000);
    const disabled = new FakeResponseStore();
    disabled.disabled = true;
    for (const store of [undefined, null, disabled]) {
        const { fetcher, calls } = makeFetch(new Map([[A, file]]));
        const cache = new GzCache({ store });
        for (let i = 0; i < 2; i++) {
            const opened = await cache.open(A, { fetcher });
            assert.equal(opened.fromCache, false);
            assert.deepEqual(await read(opened.body), file);
        }
        assert.equal(calls.length, 2);
        assert.equal(cache.disabled, true);
    }
    assert.equal(new GzCache().totalBytes, 0);
});

test('configure is forwarded to the store', () => {
    const store = new FakeResponseStore();
    new GzCache({ store }).configure(10, 20);
    assert.deepEqual(store.configured, { maxBytes: 10, maxAgeMs: 20 });
    new GzCache().configure(1, 2);
});

test('HTTP errors reject with the status and are not cached', async () => {
    const store = new FakeResponseStore();
    const cache = new GzCache({ store });
    await assert.rejects(cache.open(A, { fetcher: makeFetch(new Map()).fetcher }), (e) => e instanceof MrmsHttpError && e.status === 404);
    assert.equal(store.entries.size, 0);
});

test('an aborted download is never stored as a partial file', async () => {
    const store = new FakeResponseStore();
    const cache = new GzCache({ store });
    const { fetcher } = makeFetch(new Map([[A, seededBytes(50000)]]), { chunk: 500 });
    const ac = new AbortController();
    const reader = (await cache.open(A, { fetcher, signal: ac.signal })).body.getReader();
    await reader.read();
    ac.abort();
    await reader.read().catch(() => {});
    await until(() => cache.stats.putFailures === 1);
    assert.ok(!store.entries.has(A));
});
