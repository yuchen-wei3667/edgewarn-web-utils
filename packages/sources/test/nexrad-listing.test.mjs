import test from 'node:test';
import assert from 'node:assert/strict';
import {
    parseArchiveKey, parseChunkKey, findNewestRingId, listRingIds, listArchiveDay, listChunks, archiveDayPrefix, nextRingId, previousRingId,
    mergeVolumes, fillGaps, discoverLiveVolumes, listNexradVolumes, cadenceMs, volumeFromChunks, volumeFromArchive, volumeFromLevel3, usesLevel3,
} from '@edgewarn/web-utils/nexrad/feed';

const contents = (keys) => keys.map((k) => `<Contents><Key>${k}</Key><Size>10</Size></Contents>`).join('');
const xml = (inner, extra = '') => `<?xml version="1.0"?><ListBucketResult>${inner}${extra}<IsTruncated>false</IsTruncated></ListBucketResult>`;
const prefixesXml = (site, ids) => xml(ids.map((i) => `<CommonPrefixes><Prefix>${site}/${i}/</Prefix></CommonPrefixes>`).join(''));

test('archive keys: volumes only, no _MDM, no foreign keys', () => {
    assert.deepEqual(parseArchiveKey('2026/10/12/KTLX/KTLX20261012_235813_V06'), { site: 'KTLX', timestamp: '20261012-235813' });
    assert.equal(parseArchiveKey('2026/10/12/KTLX/KTLX20261012_235813_V06_MDM'), null);
    assert.equal(parseArchiveKey('2026/10/12/KTLX/KTLX20261011_235813_V06'), null);
    assert.equal(archiveDayPrefix(new Date(Date.UTC(2026, 0, 5))), '2026/01/05/');
});

test('chunk keys', () => {
    assert.deepEqual(parseChunkKey('KTLX/186/20261013-001157-003-I'), { site: 'KTLX', id: 186, timestamp: '20261013-001157', sequence: 3, marker: 'I' });
    assert.equal(parseChunkKey('KTLX/186/garbage'), null);
});

test('ring wraps 999 to 1', () => {
    assert.equal(nextRingId(999), 1);
    assert.equal(previousRingId(1), 999);
});

const never = async () => { throw new Error('should not probe'); };

test('wrapped ring of 416 ids: newest is 186', async () => {
    const ids = [...Array.from({ length: 230 }, (_, i) => 770 + i), ...Array.from({ length: 186 }, (_, i) => i + 1)];
    assert.equal(ids.length, 416);
    assert.equal(await findNewestRingId(ids, never), 186);
});

test('non-wrapped run: newest is the highest id', async () => {
    assert.equal(await findNewestRingId([10, 11, 12, 13], never), 13);
});

test('a ring with a hole is settled by start time', async () => {
    const times = { 5: '20261013-000500', 6: '20261013-001000', 9: '20261012-230000', 10: '20261012-231000' };
    assert.equal(await findNewestRingId([5, 6, 9, 10], async (id) => times[id]), 6);
});

test('full ring of 999: binary search by start time, wrapped and not', async () => {
    const all = Array.from({ length: 999 }, (_, i) => i + 1);
    for (const newest of [1, 186, 500, 998, 999]) {
        const probes = [];
        const at = async (id) => {
            probes.push(id);
            const age = (newest - id + 999) % 999; // 0 for newest
            return `2026${String(1000000 - age * 300).padStart(7, '0')}`.slice(0, 15).replace(/^(\d{8})(\d{6})/, '$1-$2');
        };
        assert.equal(await findNewestRingId(all, at), newest, `newest ${newest}`);
        assert.ok(probes.length < 40, `${probes.length} probes`);
    }
});

function fakeFetch(routes) {
    const calls = [];
    const fetcher = async (url) => {
        calls.push(url);
        const u = new URL(url);
        for (const [match, body] of routes) {
            if (match(u)) return { ok: true, status: 200, text: async () => (typeof body === 'function' ? body(u) : body) };
        }
        return { ok: false, status: 404, text: async () => '' };
    };
    return { fetcher, calls };
}

test('listRingIds reads the delimiter listing', async () => {
    const { fetcher, calls } = fakeFetch([[(u) => u.searchParams.get('delimiter') === '/', prefixesXml('KTLX', [770, 5, 999])]]);
    assert.deepEqual(await listRingIds('KTLX', { fetcher }), [5, 770, 999]);
    assert.match(calls[0], /prefix=KTLX%2F/);
});

test('listArchiveDay follows continuation tokens and drops _MDM', async () => {
    const page1 = `<ListBucketResult>${contents(['2026/10/12/KTLX/KTLX20261012_000000_V06', '2026/10/12/KTLX/KTLX20261012_000000_V06_MDM'])}<IsTruncated>true</IsTruncated><NextContinuationToken>abc</NextContinuationToken></ListBucketResult>`;
    const page2 = xml(contents(['2026/10/12/KTLX/KTLX20261012_000500_V06']));
    const { fetcher } = fakeFetch([[(u) => u.searchParams.get('continuation-token') === 'abc', page2], [() => true, page1]]);
    const out = await listArchiveDay('KTLX', new Date(Date.UTC(2026, 9, 12)), { fetcher });
    assert.deepEqual(out.map((o) => o.timestamp), ['20261012-000000', '20261012-000500']);
});

const chunkKeys = (id, ts, n, ended) => Array.from({ length: n }, (_, i) => `KTLX/${id}/${ts}-${String(i + 1).padStart(3, '0')}-${i === 0 ? 'S' : ended && i === n - 1 ? 'E' : 'I'}`);

test('listChunks sorts by sequence and passes start-after', async () => {
    const { fetcher, calls } = fakeFetch([[() => true, xml(contents(chunkKeys(186, '20261013-001157', 3, false).reverse()))]]);
    const out = await listChunks('KTLX', 186, { fetcher }, 'KTLX/186/20261013-001157-002-I');
    assert.deepEqual(out.map((c) => c.sequence), [1, 2, 3]);
    assert.match(calls[0], /start-after=/);
});

test('live discovery keeps the first finished chunk volume that is already published, and stops there', async () => {
    const ring = [...Array.from({ length: 230 }, (_, i) => 770 + i), ...Array.from({ length: 186 }, (_, i) => i + 1)];
    const times = { 186: '20261013-001157', 185: '20261013-000700', 184: '20261012-235813' };
    const { fetcher, calls } = fakeFetch([
        [(u) => u.searchParams.get('delimiter') === '/', prefixesXml('KTLX', ring)],
        [(u) => /KTLX\/(\d+)\//.test(u.searchParams.get('prefix')), (u) => {
            const id = u.searchParams.get('prefix').split('/')[1];
            return xml(contents(chunkKeys(id, times[id], id === '186' ? 4 : 6, id !== '186')));
        }],
    ]);
    // Level III already has 185, so the walk ends there: 184 is never listed. 186 is still arriving and is kept either way.
    const live = await discoverLiveVolumes('KTLX', new Set(['20261013-000700', '20261013-001157']), { fetcher });
    assert.equal(live.newestId, 186);
    assert.deepEqual(live.volumes.map((v) => [v.id, v.chunkId, v.complete]), [['20261013-000700', 185, true], ['20261013-001157', 186, false]]);
    assert.ok(calls.length <= 5, `${calls.length} calls`);
    // Nothing published yet: the walk continues through every finished volume up to the limit.
    const all = await discoverLiveVolumes('KTLX', new Set(), { fetcher });
    assert.deepEqual(all.volumes.map((v) => v.chunkId), [184, 185, 186]);
});

const vol = (id) => ({ id, source: 'archive', complete: true });
const at = (min) => `20261013-${String(Math.floor(min / 60)).padStart(2, '0')}${String(min % 60).padStart(2, '0')}00`;

test('merge prefers archive and dedupes by start time', () => {
    const merged = mergeVolumes([vol('20261013-000000')], [{ id: '20261013-000000', source: 'chunks', complete: true }, { id: '20261013-000500', source: 'chunks', complete: false }]);
    assert.deepEqual(merged.map((v) => [v.id, v.source]), [['20261013-000000', 'archive'], ['20261013-000500', 'chunks']]);
});

test('gap rule follows the local cadence: 4.5 min and 10 min modes', () => {
    // storm cadence ~4.5 min (use 4.5 -> alternate 4/5), one 14 min hole
    let t = 0;
    const storm = [];
    for (let i = 0; i < 8; i++) { storm.push(vol(at(t))); t += i % 2 ? 5 : 4; }
    t += 10; // hole
    storm.push(vol(at(t)));
    const filled = fillGaps(storm);
    const missing = filled.filter((v) => v.source === 'missing');
    assert.equal(missing.length, 2);
    assert.equal(filled.length, storm.length + 2);
    // clear air: 10 min cadence is not a gap, 25 min is
    const clear = [0, 10, 20, 30, 40, 50, 75].map((m) => vol(at(m)));
    assert.equal(fillGaps(clear).filter((v) => v.source === 'missing').length, 2);
    const steady = [0, 10, 20, 30, 40, 50, 60].map((m) => vol(at(m)));
    assert.equal(fillGaps(steady).length, 7);
    assert.equal(Math.round(cadenceMs(steady) / 60000), 10);
});

test('listNexradVolumes merges both buckets and caps the count', async () => {
    const archiveKeys = [0, 5, 10, 15].map((m) => `2026/10/13/KTLX/KTLX20261013_${String(Math.floor(m / 60)).padStart(2, '0')}${String(m % 60).padStart(2, '0')}00_V06`);
    const { fetcher } = fakeFetch([
        [(u) => u.searchParams.get('delimiter') === '/', prefixesXml('KTLX', [3, 4])],
        [(u) => u.searchParams.get('max-keys') === '1', (u) => xml(contents([`KTLX/${u.searchParams.get('prefix').split('/')[1]}/${u.searchParams.get('prefix').includes('/4/') ? '20261013-002000' : '20261013-001500'}-001-S`]))],
        [(u) => /^KTLX\/4\//.test(u.searchParams.get('prefix') ?? ''), xml(contents(chunkKeys(4, '20261013-002000', 3, false)))],
        [(u) => /^KTLX\/3\//.test(u.searchParams.get('prefix') ?? ''), xml(contents(chunkKeys(3, '20261013-001500', 5, true)))],
        [(u) => (u.searchParams.get('prefix') ?? '').startsWith('2026/10/13/'), xml(contents(archiveKeys))],
        [() => true, xml('')],
    ]);
    const out = await listNexradVolumes('KTLX', new Date(Date.UTC(2026, 9, 13, 0, 21)), 4, { fetcher });
    assert.equal(out.newestChunkId, 4);
    assert.deepEqual(out.volumes.map((v) => [v.id.slice(9, 13), v.source]), [['0005', 'archive'], ['0010', 'archive'], ['0015', 'archive'], ['0020', 'chunks']]);
    assert.equal(out.volumes[3].complete, false);
    assert.ok(volumeFromArchive && volumeFromChunks);
});

const l3 = (id) => volumeFromLevel3({ site: 'KTLX', key: `TLX_N3B_${id}`, size: 1, timestamp: id });
const chunkVol = (id, complete, chunkId = 1) => ({ id, source: 'chunks', chunkId, chunks: [], complete });
const fileVol = (id) => ({ id, source: 'archive', archiveKey: `k/${id}`, size: 5, complete: true });

test('merge: Level III for finished volumes, chunks while receiving, archive when Level III lacks it', () => {
    const merged = mergeVolumes(
        [fileVol('20261013-000000'), fileVol('20261013-000500'), fileVol('20261013-001000')],
        [chunkVol('20261013-000500', true, 7), chunkVol('20261013-001000', true, 8), chunkVol('20261013-001500', false, 9)],
        [l3('20261013-000000'), l3('20261013-000500'), l3('20261013-001500')],
    );
    assert.deepEqual(merged.map((v) => [v.id.slice(9, 13), v.source, v.complete]), [
        ['0000', 'level3', true], ['0005', 'level3', true], ['0010', 'archive', true], ['0015', 'chunks', false],
    ]);
    // A Level III volume keeps the Level II file and chunks it is known by, for the 3D tools and the moments Level III lacks.
    assert.deepEqual([merged[0].archiveKey, merged[0].chunkId], ['k/20261013-000000', undefined]);
    assert.deepEqual([merged[1].archiveKey, merged[1].chunkId], ['k/20261013-000500', 7]);
    // A finished volume only the chunks know stays on them.
    assert.equal(mergeVolumes([], [chunkVol('20261013-002000', true)], [])[0].source, 'chunks');
});

test('Level III frames are keyed apart, for the moments Level III carries only', () => {
    assert.equal(usesLevel3(l3('20261013-000000'), 'VEL'), true);
    assert.equal(usesLevel3(l3('20261013-000000'), 'SW'), false);
    assert.equal(usesLevel3(l3('20261013-000000'), 'PHI'), false);
    assert.equal(usesLevel3(fileVol('20261013-000000'), 'VEL'), false);
    assert.equal(usesLevel3(chunkVol('20261013-000000', true), 'REF'), false);
});

test('listNexradVolumes: Level III where published, the archive and chunks around it', async () => {
    const level3Keys = [0, 5].map((m) => `TLX_N3B_2026_10_13_00_${String(m).padStart(2, '0')}_00`);
    const archiveKeys = [0, 5, 10].map((m) => `2026/10/13/KTLX/KTLX20261013_00${String(m).padStart(2, '0')}00_V06`);
    const { fetcher, calls } = fakeFetch([
        [(u) => u.searchParams.get('delimiter') === '/', prefixesXml('KTLX', [3, 4])],
        [(u) => u.searchParams.get('max-keys') === '1', (u) => xml(contents([`KTLX/${u.searchParams.get('prefix').split('/')[1]}/${u.searchParams.get('prefix').includes('/4/') ? '20261013-001500' : '20261013-001000'}-001-S`]))],
        [(u) => /^KTLX\/4\//.test(u.searchParams.get('prefix') ?? ''), xml(contents(chunkKeys(4, '20261013-001500', 3, false)))],
        [(u) => /^KTLX\/3\//.test(u.searchParams.get('prefix') ?? ''), xml(contents(chunkKeys(3, '20261013-001000', 5, true)))],
        [(u) => (u.searchParams.get('prefix') ?? '').startsWith('TLX_N3B_2026_10_13_'), xml(contents(level3Keys))],
        [(u) => (u.searchParams.get('prefix') ?? '').startsWith('2026/10/13/'), xml(contents(archiveKeys))],
        [() => true, xml('')],
    ]);
    const out = await listNexradVolumes('KTLX', new Date(Date.UTC(2026, 9, 13, 0, 16)), 4, { fetcher });
    assert.deepEqual(out.volumes.map((v) => [v.id.slice(9, 13), v.source]), [['0000', 'level3'], ['0005', 'level3'], ['0010', 'archive'], ['0015', 'chunks']]);
    assert.ok(calls.some((u) => u.includes('unidata-nexrad-level3')));
    assert.equal(out.volumes[3].complete, false);
});

test('listNexradVolumes: one finished listing failing leaves the other; both failing is an error', async () => {
    const onlyArchive = fakeFetch([
        [(u) => u.hostname.includes('level3'), () => { throw new Error('offline'); }],
        [(u) => u.searchParams.get('delimiter') === '/', prefixesXml('KTLX', [])],
        [(u) => (u.searchParams.get('prefix') ?? '').startsWith('2026/10/13/'), xml(contents(['2026/10/13/KTLX/KTLX20261013_000000_V06']))],
        [() => true, xml('')],
    ]);
    const out = await listNexradVolumes('KTLX', new Date(Date.UTC(2026, 9, 13, 0, 16)), 4, { fetcher: onlyArchive.fetcher });
    assert.deepEqual(out.volumes.map((v) => v.source), ['archive']);
    const down = async () => { throw new Error('offline'); };
    await assert.rejects(listNexradVolumes('KTLX', new Date(Date.UTC(2026, 9, 13, 0, 16)), 4, { fetcher: down }), /offline/);
});
