import test from 'node:test';
import assert from 'node:assert/strict';
import { pollLiveVolumes, receivingState, volumeFromChunks } from '@edgewarn/web-utils/nexrad/feed';

const contents = (keys) => keys.map((k) => `<Contents><Key>${k}</Key><Size>1</Size></Contents>`).join('');
const xml = (inner) => `<ListBucketResult>${inner}<IsTruncated>false</IsTruncated></ListBucketResult>`;
const chunk = (id, ts, n, marker = 'I') => ({ key: `KTLX/${id}/${ts}-${String(n).padStart(3, '0')}-${n === 1 ? 'S' : marker}`, size: 1, site: 'KTLX', id, timestamp: ts, sequence: n, marker: n === 1 ? 'S' : marker });
const keysOf = (id, ts, from, to, ended) => Array.from({ length: to - from + 1 }, (_, i) => chunk(id, ts, from + i, ended && from + i === to ? 'E' : 'I').key);

function fakeFetch(handler) {
    const calls = [];
    return { calls, fetcher: async (url) => { calls.push(url); const u = new URL(url); return { ok: true, status: 200, text: async () => xml(contents(handler(u))) }; } };
}

test('live poll appends chunks to the arriving volume and marks it complete at E', async () => {
    const ts = '20261013-001157';
    const volume = volumeFromChunks([chunk(186, ts, 1), chunk(186, ts, 2)]);
    const { fetcher, calls } = fakeFetch((u) => {
        assert.equal(u.searchParams.get('start-after'), `KTLX/186/${ts}-002-I`);
        return keysOf(186, ts, 3, 5, true);
    });
    const poll = await pollLiveVolumes('KTLX', [volume], 186, 30, { fetcher });
    assert.equal(poll.changed, true);
    assert.equal(poll.volumes[0].chunks.length, 5);
    assert.equal(poll.volumes[0].complete, true);
    assert.equal(calls.length, 1);
});

test('after E the poll looks for the next ring id, wrapping 999 to 1, and only accepts a newer volume', async () => {
    const volume = { ...volumeFromChunks([chunk(999, '20261013-001157', 1), chunk(999, '20261013-001157', 2, 'E')]) };
    assert.equal(volume.complete, true);
    const empty = fakeFetch(() => []);
    const none = await pollLiveVolumes('KTLX', [volume], 999, 30, { fetcher: empty.fetcher });
    assert.equal(none.changed, false);
    assert.match(empty.calls[0], /prefix=KTLX%2F1%2F/);
    const next = fakeFetch(() => [chunk(1, '20261013-001644', 1).key]);
    const found = await pollLiveVolumes('KTLX', [volume], 999, 30, { fetcher: next.fetcher });
    assert.equal(found.changed, true);
    assert.equal(found.newestChunkId, 1);
    assert.deepEqual(found.volumes.map((v) => v.id), ['20261013-001157', '20261013-001644']);
    assert.equal(found.volumes[1].complete, false);
    // an older volume at that id (the ring has not wrapped yet) is ignored
    const stale = fakeFetch(() => [chunk(1, '20261012-001644', 1).key]);
    assert.equal((await pollLiveVolumes('KTLX', [volume], 999, 30, { fetcher: stale.fetcher })).changed, false);
});

test('a new volume after a long gap gets missing placeholders', async () => {
    const mk = (min) => ({ id: `20261013-${String(Math.floor(min / 60)).padStart(2, '0')}${String(min % 60).padStart(2, '0')}00`, source: 'archive', complete: true });
    const volumes = [0, 5, 10, 15, 20, 25, 30].map(mk);
    const next = fakeFetch(() => [chunk(7, '20261013-005000', 1).key]);
    const poll = await pollLiveVolumes('KTLX', volumes, 6, 30, { fetcher: next.fetcher });
    assert.ok(poll.volumes.filter((v) => v.source === 'missing').length >= 2);
    assert.equal(poll.volumes[poll.volumes.length - 1].source, 'chunks');
});

test('receiving card states', () => {
    const now = Date.UTC(2026, 9, 13, 0, 20, 0);
    const complete = (min) => ({ id: `20261013-00${String(min).padStart(2, '0')}00`, source: 'archive', complete: true });
    const done = [complete(0), complete(5), complete(10), complete(15)];
    const live = { id: '20261013-001900', source: 'chunks', complete: false, chunkId: 3, chunks: [] };
    const state = (volumes, receiving = null, unreachable = false, at = now) => receivingState({ now: at, volumes, receiving, unreachable });
    assert.equal(state([...done, live], { volumeId: live.id, angle: 1.27, fraction: 0.4 }).text, 'Receiving 1.3°');
    assert.equal(state([...done, live], { volumeId: live.id, angle: 1.27, fraction: 0.4 }).fraction, 0.4);
    assert.equal(state([...done, live]).text, 'Receiving');
    // a report about an older volume is not the newest's
    assert.equal(state([...done, live], { volumeId: done[3].id, angle: 0.5, fraction: 1 }).text, 'Receiving');
    assert.equal(state(done, null, false, Date.UTC(2026, 9, 13, 0, 16, 0)).text, 'Up to date');
    assert.equal(state(done, null, false, Date.UTC(2026, 9, 13, 0, 24, 0)).text, 'Waiting for next scan');
    assert.equal(state(done, null, false, Date.UTC(2026, 9, 13, 3, 0, 0)).text, 'Station offline');
    assert.equal(state(done, null, true).text, "Can't reach NOAA");
    assert.equal(state([], null).text, 'Up to date');
});

