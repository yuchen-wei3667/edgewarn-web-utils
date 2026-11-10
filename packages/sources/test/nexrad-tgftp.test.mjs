import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTgftpListing, tgftpStationId, volumeIndexForScan, TVS_VOLUME_GRACE_MS } from '@edgewarn/web-utils/nexrad/feed';

test('a scan belongs to the latest volume that started by then', () => {
    const t = (m) => Date.UTC(2026, 9, 21, 0, m, 0);
    const starts = [t(10), t(15), t(20)];
    assert.equal(volumeIndexForScan(starts, t(17)), 1);
    assert.equal(volumeIndexForScan(starts, t(20) - 30_000), 2, 'a scan stamped just before the volume start is within the grace');
    assert.equal(volumeIndexForScan(starts, t(5)), -1);
    assert.equal(volumeIndexForScan(starts, t(40)), 2);
    assert.equal(volumeIndexForScan([], t(20)), -1);
    assert.equal(volumeIndexForScan(starts, t(20) - TVS_VOLUME_GRACE_MS), 2);
    assert.equal(volumeIndexForScan(starts, t(20) - TVS_VOLUME_GRACE_MS - 1), 1);
});

test('reads the product names and stamps from a TGFTP directory page', () => {
    const html = '<tr><td><a href="sn.0001">sn.0001</a></td><td align="right">20-Oct-2026 16:18  </td><td align="right">2.1K</td></tr>'
        + '<tr><td><a href="sn.last">sn.last</a></td><td align="right">21-Oct-2026 01:04  </td><td align="right">2.1K</td></tr>'
        + '<tr><td><a href="?C=N;O=D">Name</a></td></tr>';
    const expected = [
        { name: 'sn.0001', stamp: '20-Oct-2026 16:18' },
        { name: 'sn.last', stamp: '21-Oct-2026 01:04' },
    ];
    assert.deepEqual(parseTgftpListing(html), expected);
    assert.deepEqual(parseTgftpListing(html), expected, 'repeated parses do not retain regex state');
    assert.deepEqual(parseTgftpListing(''), []);
});

test('TGFTP station ids are lowercase', () => {
    assert.equal(tgftpStationId('KTLX'), 'ktlx');
});
