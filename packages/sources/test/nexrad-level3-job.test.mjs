import test from 'node:test';
import assert from 'node:assert/strict';
import { level3Key, listLevel3Day, parseLevel3Key, readLevel3Vcp, runLevel3Job } from '@edgewarn/web-utils/nexrad/feed';

// Tiny products built to the ICD layout. VEL: product 154 with a WMO header and a bzip2-compressed symbology
// block, elevation cut 2 at 0.9 degrees, VCP 212, 4 radials x 6 bins. ZDR: product 159 with float scale and offset,
// no WMO header, no compression, 3 radials x 5 bins (odd, so each radial is padded) starting at bin 8.
const VEL = Uint8Array.from(Buffer.from(
    'U0RVUzU0IEtPVU4gMjAwMDA5DQ0KTjBHVExYDQ0KAJpRCwAAAogAAADoAAAAAAAD//8AAIoF//6EAgT9AJoAAADUAAAAAFELAAACPwAAAAAAAAAAAAAAAgAJ/YUABQD+AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAATgAAAAAAPAAAAAAAAAAAQlpoOTFBWSZTWZhLx5MAACdtFf8H4fgAAQABBAAABABAAIAAH6AAVFamEwEwmhkzIQmJPUPU0aGnqNGhdAG+REEDdzrBpvLmIdMWNTMZaEE8CEF1XbeNKLx79fDAB3HWdCQhHwti7kinChITCXjyYA==',
    'base64'));
const ZDR = Uint8Array.from(Buffer.from(
    'AJ9RCwAAAogAAAC6AAAAAAAD//8AAIoF//6EAgT9AJ8AAAAjAAAAAFELAAACPwAAAAAAAAAAAAAAAQAFQYAAAEMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQgAAAAAAPAAAAAAAAAAA//8AAQAAAEIAAf//AAAAMgAQAAgABQAAAAAD5wADAAUAAABkAAECAwQAAAUAZABkCgsMDQ4AAAUAyABkFBUWFxgA',
    'base64'));

test('level 3 keys: site without the region letter, tilt product, volume start', () => {
    assert.deepEqual(parseLevel3Key('TLX_N3B_2026_10_20_00_09_35'), { site: 'TLX', product: 'N3B', timestamp: '20261020-000935' });
    assert.equal(parseLevel3Key('TLX_N0B_2026_10_20_00_09_35_extra'), null);
    assert.equal(parseLevel3Key('TLX_DAA_2026_10_20_00_09_35'), null);
    assert.equal(level3Key('KTLX', 'N1G', '20261020-000935'), 'TLX_N1G_2026_10_20_00_09_35');
    assert.equal(level3Key('PHKI', 'N0B', '20261020-000935'), 'HKI_N0B_2026_10_20_00_09_35');
});

test('level 3 day listing reads the index product, volume starts only', async () => {
    const calls = [];
    const keys = ['TLX_N3B_2026_10_20_00_16_38', 'TLX_N3B_2026_10_20_00_09_35', 'TLX_N3B_2026_10_20_00_09_35_x', 'TLX_N0B_2026_10_20_00_06_04'];
    const body = `<ListBucketResult>${keys.map((k) => `<Contents><Key>${k}</Key><Size>10</Size></Contents>`).join('')}<IsTruncated>false</IsTruncated></ListBucketResult>`;
    const fetcher = async (url) => { calls.push(url); return new Response(body, { status: 200 }); };
    const out = await listLevel3Day('KTLX', new Date(Date.UTC(2026, 9, 20)), { fetcher });
    assert.deepEqual(out.map((o) => o.timestamp), ['20261020-000935', '20261020-001638']);
    assert.match(calls[0], /unidata-nexrad-level3/);
    assert.match(calls[0], /prefix=TLX_N3B_2026_10_20_/);
});

const ID = '20261020-000935';
/** Serves products by key; every other key is a 404. */
function level3Fetch(products, calls = []) {
    return async (url, init = {}) => {
        const key = new URL(url).pathname.slice(1);
        calls.push({ key, range: init.headers?.Range });
        const bytes = products[key];
        if (!bytes) return new Response('', { status: 404 });
        return new Response(init.headers?.Range ? bytes.slice(0, 256) : bytes, { status: init.headers?.Range ? 206 : 200 });
    };
}
const job = (moments, angle = 0.5) => ({ jobId: 1, site: 'KTLX', volumeId: ID, moments, elevation: { angle } });
const products = { TLX_N0G_2026_10_20_00_09_35: VEL, TLX_N1X_2026_10_20_00_09_35: ZDR };
const deps = (fetcher, messages, extra = {}) => ({ fetcher, signal: new AbortController().signal, post: (m, transfer) => messages.push({ ...m, transfer }), ...extra });

test('level 3 job: reads headers, picks the nearest tilt carrying the moment, posts vcp then revision', async () => {
    const calls = [], messages = [], state = { bytesRead: 0 };
    await runLevel3Job(job(['VEL'], 0.5), deps(level3Fetch(products, calls), messages), state);
    assert.deepEqual(messages.map((m) => m.type), ['vcp', 'revision']);
    const vcp = messages[0];
    // ZDR at 0.5 degrees comes first, velocity at 0.9 second.
    assert.deepEqual(vcp.elevations.map((e) => [e.id, e.nominalAngle, e.moments, e.cuts]), [[0, 0.5, ['ZDR'], [1]], [1, 0.9, ['VEL'], [2]]]);
    assert.deepEqual([vcp.vcp, vcp.selected], [212, 1]);
    const revision = messages[1];
    assert.deepEqual([revision.elevationId, revision.moment, revision.provisional, revision.field.rows], [1, 'VEL', false, 4]);
    assert.equal(revision.transfer.length, 3, 'the field buffers are offered for transfer');
    assert.equal(state.bytesRead, VEL.length);
    // Sixteen header probes (four moments, four tilts) with a range, then the one product in full.
    assert.equal(calls.filter((c) => c.range).length, 16);
    assert.deepEqual(calls.filter((c) => !c.range).map((c) => c.key), ['TLX_N0G_2026_10_20_00_09_35']);
});

test('level 3 job: an injected header cache saves the probes of the next job and is never given a missing product', async () => {
    const headerCache = new Map();
    const first = [];
    await runLevel3Job(job(['VEL']), deps(level3Fetch(products, first), [], { headerCache }), { bytesRead: 0 });
    assert.deepEqual([...headerCache.keys()].sort(), ['TLX_N0G_2026_10_20_00_09_35', 'TLX_N1X_2026_10_20_00_09_35']);
    const second = [];
    await runLevel3Job(job(['VEL']), deps(level3Fetch(products, second), [], { headerCache }), { bytesRead: 0 });
    assert.equal(first.filter((c) => c.range).length, 16);
    assert.equal(second.filter((c) => c.range).length, 14, 'only the 14 products the volume lacks are probed again');
});

test('level 3 job: a moment the volume lacks rejects before any download', async () => {
    const calls = [];
    await assert.rejects(runLevel3Job(job(['REF']), deps(level3Fetch(products, calls), []), { bytesRead: 0 }), /Level III has no REF/);
    await assert.rejects(runLevel3Job(job(['SW']), deps(level3Fetch(products), []), { bytesRead: 0 }), /Level III has no SW/);
    assert.ok(calls.every((c) => c.range), 'only headers were read');
});

test('level 3 job: a server error on a header is an error, a missing product is not', async () => {
    const failing = async () => new Response('', { status: 503 });
    await assert.rejects(runLevel3Job(job(['VEL']), deps(failing, []), { bytesRead: 0 }), { message: 'HTTP 503' });
});

test('level 3 vcp read posts the elevations and no frame, and fails on a volume without products', async () => {
    const messages = [];
    await readLevel3Vcp(job([]), deps(level3Fetch(products), messages));
    assert.deepEqual(messages.map((m) => m.type), ['vcp']);
    assert.equal(messages[0].selected, null);
    await assert.rejects(readLevel3Vcp(job([]), deps(level3Fetch({}), [])), /no products for this volume/);
});
