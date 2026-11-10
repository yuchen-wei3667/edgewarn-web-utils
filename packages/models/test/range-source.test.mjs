import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as turn } from 'node:timers/promises';
import { RangeSource } from '../dist/sources/rangeSource.js';

const data = Uint8Array.from({ length: 32_768 }, (_, i) => i % 251);
const stats = () => ({ requests: 0, bytesFetched: 0, reads: [] });
const response = range => {
    const explicit = /^bytes=(\d+)-(\d+)$/.exec(range);
    const start = explicit ? Number(explicit[1]) : Math.max(0, data.length - Number(range.slice(7)));
    const end = explicit ? Number(explicit[2]) : data.length - 1;
    return new Response(data.slice(start, end + 1), { status: 206,
        headers: { 'content-range': `bytes ${start}-${end}/${data.length}` } });
};
const backend = (source, signal = new AbortController().signal, url = 'https://example.com/a.om', bytes = 64, version = 'v1', cost = stats()) =>
    source.backend(url, version, cost, signal, bytes);

test('RangeSource merges nearby ranges, returns exact slices, and reuses contained ranges', async () => {
    const log = [], cost = stats();
    const source = new RangeSource({ maxBytes: 1024, fetch: async (_url, init) => {
        log.push(init.headers.Range);
        return response(init.headers.Range);
    } });
    const reader = backend(source, undefined, undefined, 64, 'v1', cost);
    await reader.count();
    const [a, b] = await Promise.all([reader.getBytes(100, 16), reader.getBytes(130, 16)]);
    assert.deepEqual(a, data.slice(100, 116));
    assert.deepEqual(b, data.slice(130, 146));
    assert.deepEqual(log, ['bytes=-64', 'bytes=100-145']);
    assert.deepEqual(await reader.getBytes(108, 4), data.slice(108, 112));
    assert.equal(log.length, 2);
    assert.equal(cost.bytesFetched, 110);
    assert.equal(source.cacheInfo.bytes, 110);
});

test('RangeSource shared opens survive one subscriber abort and deduplicate network bytes', async () => {
    let finish, networkSignal, count = 0;
    const source = new RangeSource({ maxBytes: 1024, fetch: (_url, init) => {
        count++;
        networkSignal = init.signal;
        return new Promise(resolve => { finish = () => resolve(response(init.headers.Range)); });
    } });
    const first = new AbortController(), second = new AbortController();
    const a = backend(source, first.signal).count(), b = backend(source, second.signal).count();
    await turn();
    first.abort();
    await assert.rejects(a, { name: 'AbortError' });
    assert.equal(networkSignal.aborted, false);
    finish();
    assert.equal(await b, data.length);
    assert.equal(count, 1);
    assert.equal(source.cacheInfo.bytes, 64);
});

test('RangeSource last subscriber abort cancels I/O and a new request starts cleanly', async () => {
    let networkSignal, calls = 0;
    const source = new RangeSource({ maxBytes: 1024, fetch: (_url, init) => {
        calls++;
        if (calls > 1) return Promise.resolve(response(init.headers.Range));
        networkSignal = init.signal;
        return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
    } });
    const controller = new AbortController();
    const cancelled = backend(source, controller.signal).count();
    await turn();
    controller.abort();
    await assert.rejects(cancelled, { name: 'AbortError' });
    const fresh = backend(source).count();
    assert.equal(await fresh, data.length);
    assert.equal(networkSignal.aborted, true);
    assert.equal(calls, 2);
    assert.equal(source.cacheInfo.bytes, 64);
});

test('RangeSource merged reads preserve another interval when one caller aborts', async () => {
    let finish, networkSignal;
    const source = new RangeSource({ maxBytes: 1024, fetch: (_url, init) => {
        if (init.headers.Range.startsWith('bytes=-')) return Promise.resolve(response(init.headers.Range));
        networkSignal = init.signal;
        return new Promise(resolve => { finish = () => resolve(response(init.headers.Range)); });
    } });
    const first = new AbortController();
    const a = backend(source, first.signal), b = backend(source);
    await Promise.all([a.count(), b.count()]);
    const one = a.getBytes(100, 4), two = b.getBytes(110, 4);
    await turn();
    first.abort();
    await assert.rejects(one, { name: 'AbortError' });
    assert.equal(networkSignal.aborted, false);
    finish();
    assert.deepEqual(await two, data.slice(110, 114));
});

test('RangeSource tails share the total byte budget, evictions use known-size explicit ranges, and versions are isolated', async () => {
    const log = [];
    const source = new RangeSource({ maxBytes: 128, fetch: async (url, init) => {
        log.push([url, init.headers.Range]);
        return response(init.headers.Range);
    } });
    const url = name => `https://example.com/${name}.om`;
    await backend(source, undefined, url('a')).count();
    await backend(source, undefined, url('b')).count();
    await backend(source, undefined, url('a')).count(); // Touch A so B is evicted next.
    await backend(source, undefined, url('c')).count();
    assert.deepEqual(source.cacheInfo, { bytes: 128, entries: 2, pending: 0, activeRequests: 0 });
    await backend(source, undefined, url('a')).count();
    assert.equal(log.length, 3);
    await backend(source, undefined, url('b')).count();
    assert.deepEqual(log.at(-1), [url('b'), 'bytes=32704-32767']);
    await backend(source, undefined, url('b'), 64, 'v2').count();
    assert.equal(log.length, 5, 'A new content version cannot reuse old bytes');
    assert.equal(source.cacheInfo.bytes, 128);
});

test('RangeSource caps aggregate HTTP concurrency across independent files', async () => {
    let active = 0, peak = 0;
    const source = new RangeSource({ maxBytes: 4096, fetch: async (_url, init) => {
        peak = Math.max(peak, ++active);
        await turn();
        active--;
        return response(init.headers.Range);
    } });
    await Promise.all(Array.from({ length: 20 }, (_, i) => backend(source, undefined, `https://example.com/${i}.om`).count()));
    assert.equal(peak, 6);
    assert.equal(source.cacheInfo.activeRequests, 0);
});

test('RangeSource a cancelled queue entry never starts HTTP and releases its place for live work', async () => {
    const release = [], urls = [];
    const source = new RangeSource({ maxBytes: 4096, fetch: (url, init) => {
        urls.push(url);
        return new Promise(resolve => release.push(() => resolve(response(init.headers.Range))));
    } });
    const active = Array.from({ length: 6 }, (_, i) => backend(source, undefined, `https://example.com/${i}.om`).count());
    const cancel = new AbortController();
    const cancelled = backend(source, cancel.signal, 'https://example.com/cancel.om').count();
    const live = backend(source, undefined, 'https://example.com/live.om').count();
    await turn();
    cancel.abort();
    await assert.rejects(cancelled, { name: 'AbortError' });
    release[0]();
    await turn();
    assert.equal(urls.length, 7);
    assert.ok(!urls.some(url => url.includes('cancel.om')));
    for (const finish of release.slice(1)) finish();
    await Promise.all([...active, live]);
    assert.equal(source.cacheInfo.activeRequests, 0);
});

test('RangeSource validates intervals and body lengths, rejects whole files, and retries only transient failures', async () => {
    for (const [status, header, body, expected] of [
        [206, 'bytes 0-63/32768', data.slice(0, 64), /Content-Range/],
        [206, 'bytes 32704-32767/32768', data.slice(0, 63), /Truncated/],
        [200, null, '', /HTTP 200/], [404, null, '', /HTTP 404/],
    ]) {
        let calls = 0;
        const source = new RangeSource({ maxBytes: 1024, fetch: async () => {
            calls++;
            return new Response(body, { status, headers: header ? { 'content-range': header } : {} });
        } });
        await assert.rejects(backend(source).count(), expected);
        assert.equal(calls, 1);
    }
    let calls = 0;
    const cost = stats();
    const source = new RangeSource({ maxBytes: 1024, fetch: async (_url, init) => {
        if (++calls === 1) return new Response('', { status: 503 });
        return response(init.headers.Range);
    } });
    await backend(source, undefined, undefined, 64, 'v1', cost).count();
    assert.equal(calls, 2);
    assert.equal(cost.requests, 2);
});
