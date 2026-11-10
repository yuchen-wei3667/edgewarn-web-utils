import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelFetcher } from '../dist/sources/fetcher.js';
import { ModelMessageCache } from '../dist/messageCache.js';
import { ModelCancelled } from '../dist/sources/errors.js';

const ranges = [{ url: 'https://source.test/frame', start: 0, end: 3 }, { url: 'https://source.test/frame', start: 4, end: 7 }];
const cache = () => new ModelMessageCache({ memoryBytes: 1e6, store: null });
function deferred() {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    return { promise, resolve };
}

test('simultaneous resolutions share one adjacent-range GET and count its bytes once', async () => {
    const calls = [], progress = [[], []];
    const fetcher = new ModelFetcher({ cache: cache(), fetch: async (url, init) => {
        calls.push([url, init.headers.Range]);
        return new Response(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]), { status: 206 });
    } });
    const results = await Promise.all(progress.map(events => fetcher.readRanges(ranges, undefined, (done, total) => events.push([done, total]))));
    assert.deepEqual(calls, [['https://source.test/frame', 'bytes=0-7']]);
    assert.equal(results.reduce((n, result) => n + result.fetched, 0), 8);
    assert.equal(fetcher.stats.bytesFetched, 8);
    for (const result of results) assert.deepEqual(result.bytes.map(bytes => [...bytes]), [[1, 2, 3, 4], [5, 6, 7, 8]]);
    for (const events of progress) assert.deepEqual(events.at(-1), [2, 2]);
    assert.equal((await fetcher.readRanges(ranges)).fetched, 0);
    assert.equal(calls.length, 1);
});

test('a cancelled owner cannot cancel another reader or consume its byte attribution', async () => {
    const started = deferred(), finish = deferred();
    let cancelled = false, calls = 0;
    const fetcher = new ModelFetcher({ cache: cache(), fetch: async () => {
        calls++; started.resolve(); await finish.promise;
        return new Response(new Uint8Array(8), { status: 206 });
    } });
    const owner = fetcher.readRanges(ranges, () => { if (cancelled) throw new ModelCancelled(); });
    const rejection = assert.rejects(owner, ModelCancelled);
    const other = fetcher.readRanges(ranges);
    await started.promise;
    cancelled = true;
    finish.resolve();
    await rejection;
    assert.equal((await other).fetched, 8);
    assert.equal(calls, 1);
});

test('queued shared reads start when the original owner cancels but another reader needs them', async () => {
    const occupied = deferred(), release = deferred();
    let cancelled = false, calls = 0;
    const fetcher = new ModelFetcher({ cache: cache(), concurrency: 1, fetch: async () => {
        calls++; return new Response(new Uint8Array(8), { status: 206 });
    } });
    const busy = fetcher.slot(async () => { occupied.resolve(); await release.promise; });
    await occupied.promise;
    const owner = fetcher.readRanges(ranges, () => { if (cancelled) throw new ModelCancelled(); });
    const rejection = assert.rejects(owner, ModelCancelled);
    const other = fetcher.readRanges(ranges);
    cancelled = true;
    release.resolve();
    await busy;
    await rejection;
    assert.equal((await other).fetched, 8);
    assert.equal(calls, 1);
});

test('a failed shared read rejects both callers and permits a fresh retry', async () => {
    let calls = 0;
    const fetcher = new ModelFetcher({ cache: cache(), fetch: async () => {
        calls++;
        return calls === 1 ? new Response(null, { status: 503 }) : new Response(new Uint8Array(8), { status: 206 });
    } });
    const results = await Promise.allSettled([fetcher.readRanges(ranges), fetcher.readRanges(ranges)]);
    assert.ok(results.every(result => result.status === 'rejected' && result.reason.status === 503));
    assert.equal(calls, 1);
    assert.equal((await fetcher.readRanges(ranges)).fetched, 8);
    assert.equal(calls, 2);
});

test('different objects are fetched independently', async () => {
    let calls = 0;
    const fetcher = new ModelFetcher({ cache: cache(), fetch: async () => {
        calls++; return new Response(new Uint8Array(8), { status: 206 });
    } });
    await Promise.all([fetcher.readRanges(ranges), fetcher.readRanges(ranges.map(r => ({ ...r, url: 'https://source.test/another-frame' })))]);
    assert.equal(calls, 2);
});

test('all consumers cancelling while queued prevents a network request and allows retry', async () => {
    const release = deferred();
    let cancelled = false, calls = 0;
    const fetcher = new ModelFetcher({ cache: cache(), concurrency: 1, fetch: async () => {
        calls++; return new Response(new Uint8Array(8), { status: 206 });
    } });
    const busy = fetcher.slot(() => release.promise);
    const check = () => { if (cancelled) throw new ModelCancelled(); };
    const results = Promise.allSettled([fetcher.readRanges(ranges, check), fetcher.readRanges(ranges, check)]);
    cancelled = true;
    release.resolve();
    await busy;
    assert.ok((await results).every(result => result.status === 'rejected' && result.reason instanceof ModelCancelled));
    assert.equal(calls, 0);
    cancelled = false;
    assert.equal((await fetcher.readRanges(ranges, check)).fetched, 8);
    assert.equal(calls, 1);
});

test('late consumers receive current shared progress instead of restarting at zero', async () => {
    const storedFirst = deferred(), finish = deferred();
    const memory = cache();
    let puts = 0;
    const fetcher = new ModelFetcher({ cache: { get: key => memory.get(key), put: async (key, value) => {
        if (++puts === 1) { storedFirst.resolve(); await finish.promise; }
        await memory.put(key, value);
    } }, fetch: async () => new Response(new Uint8Array(8), { status: 206 }) });
    const owner = fetcher.readRanges(ranges);
    await storedFirst.promise;
    const progress = [];
    const other = fetcher.readRanges(ranges, undefined, (done, total) => progress.push([done, total]));
    assert.deepEqual(progress, [[1, 2]]);
    finish.resolve();
    await Promise.all([owner, other]);
    assert.deepEqual(progress, [[1, 2], [2, 2]]);
});
