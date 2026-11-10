import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AbiFile } from '@edgewarn/web-utils/goes';
import { GoesHttpError, ReadAheadSource, streamAbi } from '@edgewarn/web-utils/goes/feed';

// Built by the decoders package's make-abi-fixture.py: Rad is 60x90 int16 in 13-row shuffle+deflate chunks.
const FIXTURE = new Uint8Array(readFileSync(new URL('../../decoders/test/fixtures/goes/abi-mini.nc', import.meta.url)));
const H = 60, W = 90, FILL = 4095;
const code = (r, c) => ((r === 0 && c === 0) || (r === H - 1 && c === W - 1) ? FILL : (r * 37 + c * 11) % 4095);

/** Fake S3: honours Range like the real bucket, or ignores it and sends the whole object. */
/** Serve a `bandRange` result from the fixture, in pieces of `step` bytes (Infinity: whole range). */
/** Collects rows from readRows into a full image, checking they arrive in ascending order. */
function fakeFetch(bytes, { honourRange = true } = {}) {
    const calls = [];
    const fetcher = async (_url, init) => {
        const [, a, b] = /bytes=(\d+)-(\d*)/.exec(init.headers.Range);
        const last = b === '' ? bytes.length - 1 : Number(b);
        calls.push([Number(a), last]);
        const body = honourRange ? bytes.slice(Number(a), Math.min(bytes.length, last + 1)) : bytes.slice();
        // Deliver in small pieces so chunks straddle stream reads.
        const stream = new ReadableStream({
            start(c) { for (let i = 0; i < body.length; i += 97) c.enqueue(body.subarray(i, i + 97)); c.close(); },
        });
        return new Response(stream, { status: honourRange ? 206 : 200 });
    };
    return { fetcher, calls };
}


/** Serve a `bandRange` result from the fixture, in pieces of `step` bytes (Infinity: whole range). */
const servePieces = (bytes, step) => (range) => (async function* () {
    for (let p = range.start; p < range.end; p += step) yield bytes.subarray(p, Math.min(range.end, p + step));
})();

/** Collects rows from readRows into a full image, checking they arrive in ascending order. */
function rowCollector(width, height) {
    const image = new Uint16Array(width * height).fill(0xffff);
    const views = new Set();
    let next = -1;
    return {
        image, views,
        rows(y0, codes, w, count) {
            assert.equal(w, width);
            assert.ok(y0 > next, `rows arrive in order (${y0} after ${next})`);
            next = y0 + count - 1;
            views.add(codes.buffer);
            image.set(codes.subarray(0, w * count), y0 * w);
        },
    };
}


test('ReadAheadSource streams ranged GETs and copes with servers that ignore Range', async () => {
    for (const honourRange of [true, false]) {
        // A 1 KiB head pushes metadata reads to the network too, so both read paths are exercised.
        for (const headBytes of [1024, undefined]) {
            const { fetcher, calls } = fakeFetch(FIXTURE, { honourRange });
            const file = await AbiFile.open(new ReadAheadSource('https://example.invalid/abi.nc', { fetcher, headBytes }));
            const g = await file.read({ rows: [20, 40] });
            for (let j = 0; j < g.height; j++) for (let i = 0; i < W; i += 9) assert.equal(g.data[j * W + i], code(20 + j, i));
            assert.deepEqual(calls[0], [0, (headBytes ?? 256 * 1024) - 1], 'first request is the head block');
            // With the default head every metadata read is served locally: one head GET plus one streamed batch.
            if (headBytes === undefined) assert.equal(calls.length, 2);
        }
    }
});

test('streamAbi decodes while the file streams in, across stream boundaries', async () => {
    const cases = [
        // 36 KB in 4 streams: chunks straddle stream boundaries; a 1 KiB head forces side-fetched metadata.
        { opts: { size: FIXTURE.length, bytesPerStream: 6000, headBytes: 1024 }, streams: 4 },
        { opts: { size: FIXTURE.length }, streams: 1 },
        { opts: {}, streams: 1 },
        { opts: {}, streams: 1, honourRange: false },
    ];
    for (const { opts, streams, honourRange = true } of cases) {
        const { fetcher, calls } = fakeFetch(FIXTURE, { honourRange });
        const g = await streamAbi('https://example.invalid/abi.nc', { ...opts, fetcher });
        for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) assert.equal(g.data[r * W + c], code(r, c), `(${r}, ${c})`);
        assert.equal(g.time, '2026-10-11T12:02:37.500Z');
        assert.equal(calls.filter(([a]) => a === 0).length, 1, 'one stream starts at byte 0');
        assert.ok(calls.length >= streams);
    }
});

test('ReadAheadSource answers metadata misses with aligned blocks, and release() drops them', async () => {
    const { fetcher, calls } = fakeFetch(FIXTURE);
    const src = new ReadAheadSource('https://example.invalid/abi.nc', { fetcher, headBytes: 1024, blockBytes: 4096, maxBlocks: 2 });
    const file = await AbiFile.open(src);
    const info = await file.gridInfo('Rad');
    assert.deepEqual([info.width, info.height, info.chunkRows, info.fill], [W, H, 13, FILL]);
    assert.ok(Math.abs(info.x.step - 5.6e-5) < 1e-9);
    assert.equal(info.projection.longitudeOfProjectionOrigin, -75);
    const ranges = await file.bandRange('Rad', [0, H]);
    // Every metadata request after the head is block-aligned and block-sized.
    for (const [a, b] of calls.slice(1)) {
        assert.equal(a % 4096, 0);
        assert.equal(b - a + 1, 4096);
    }
    assert.ok(src.bufferedBlocks <= 3, 'at most the head plus maxBlocks are kept');

    file.release();
    assert.equal(src.bufferedBlocks, 0);
    // Parsed metadata survives release: decoding needs no further metadata reads.
    const before = src.requests;
    const sink = rowCollector(W, H);
    await file.readRows('Rad', [0, H], sink, servePieces(FIXTURE, 300), { ranges });
    assert.equal(src.requests, before);
    assert.equal(sink.image[W + 1], code(1, 1));
});

test('stored fetchers are called plainly, as browsers require for the global fetch', async () => {
    const { fetcher } = fakeFetch(FIXTURE);
    // Browsers throw "Illegal invocation" when fetch runs with `this` bound to another object.
    const strict = function (url, init) { if (this !== undefined) throw new TypeError('Illegal invocation'); return fetcher(url, init); };
    for (const src of [new ReadAheadSource('https://example.invalid/a.nc', { fetcher: strict, headBytes: 1024 })]) {
        const file = await AbiFile.open(src);
        assert.equal((await file.gridInfo('Rad')).width, W);
    }
    const g = await streamAbi('https://example.invalid/a.nc', { fetcher: strict, headBytes: 1024 });
    assert.equal(g.width, W);
});

test('a failed head fetch is retried, and failures carry the HTTP status', async () => {
    const { fetcher } = fakeFetch(FIXTURE);
    let fail = 1;
    const flaky = async (url, init) => (fail-- > 0 ? new Response('', { status: 503 }) : fetcher(url, init));
    const src = new ReadAheadSource('https://example.invalid/abi.nc', { fetcher: flaky });
    await assert.rejects(src.read(0, 8), (e) => e instanceof GoesHttpError && e.status === 503);
    assert.equal((await src.read(0, 8)).length, 8, 'the next read refetches the head');

    const abort = new AbortController();
    abort.abort();
    const honouring = (url, init) => (init.signal?.aborted ? Promise.reject(init.signal.reason) : fetcher(url, init));
    const src2 = new ReadAheadSource('https://example.invalid/abi.nc', { fetcher: honouring });
    await assert.rejects(src2.read(0, 8, abort.signal));
    assert.equal((await src2.read(0, 8)).length, 8, 'an aborted first read does not poison later ones');
});
