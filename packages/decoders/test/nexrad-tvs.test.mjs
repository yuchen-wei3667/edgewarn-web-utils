import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { destinationPoint, parseTgftpListing, parseTvsProduct, tgftpStationId, volumeIndexForScan } from '../dist/nexrad/level3/tvs.js';

const fixture = (name) => new Uint8Array(readFileSync(new URL(`./fixtures/nexrad/${name}`, import.meta.url)));

test('reads the detection in a real KEMX NTV file', () => {
    const product = parseTvsProduct(fixture('tvs-kemx.bin'));
    assert.ok(product);
    assert.equal(product.radarLat, 31.894);
    assert.equal(product.radarLon, -110.63);
    assert.equal(product.detections.length, 1);
    const [d] = product.detections;
    assert.equal(d.kind, 'TVS');
    assert.equal(d.stormId, 'B2');
    assert.equal(d.azimuthDeg, 320);
    assert.equal(d.rangeNm, 36);
    assert.deepEqual([d.avgDvKt, d.lowLevelDvKt, d.maxDvKt, d.maxDvHeightKft], [35, 51, 51, 2.7]);
    assert.deepEqual([d.depthKft, d.baseKft, d.topKft], [5.3, 2.7, 8]);
    assert.deepEqual([d.maxShearE3PerS, d.maxShearHeightKft], [22, 2.7]);
    // 36 nm along 320 degrees from the station is north-west of it.
    assert.ok(d.lat > product.radarLat && d.lon < product.radarLon);
    assert.ok(Math.abs(d.lat - 32.35) < 0.02 && Math.abs(d.lon - -111.09) < 0.02);
});

test('a file with no TVS has no detections', () => {
    const product = parseTvsProduct(fixture('tvs-none-ktlx.bin'));
    assert.ok(product);
    assert.deepEqual(product.detections, []);
});

test('bytes that are not a TVS product give null', () => {
    assert.equal(parseTvsProduct(new TextEncoder().encode('<html>403</html>')), null);
    assert.equal(parseTvsProduct(new Uint8Array(0)), null);
});

test('the scan time comes from the product text', () => {
    const product = parseTvsProduct(fixture('tvs-kemx.bin'));
    assert.equal(product.scanMs, Date.UTC(2026, 9, 21, 0, 22, 53));
    assert.equal(product.detections[0].scanMs, product.scanMs);
});

test('a scan belongs to the latest volume that started by then', () => {
    const t = (m) => Date.UTC(2026, 9, 21, 0, m, 0);
    const starts = [t(10), t(15), t(20)];
    assert.equal(volumeIndexForScan(starts, t(17)), 1);
    assert.equal(volumeIndexForScan(starts, t(20) - 30_000), 2, 'a scan stamped just before the volume start is within the grace');
    assert.equal(volumeIndexForScan(starts, t(5)), -1);
    assert.equal(volumeIndexForScan(starts, t(40)), 2);
});

test('reads the product names and stamps from a TGFTP directory page', () => {
    const html = '<tr><td><a href="sn.0001">sn.0001</a></td><td align="right">20-Oct-2026 16:18  </td><td align="right">2.1K</td></tr>'
        + '<tr><td><a href="sn.last">sn.last</a></td><td align="right">21-Oct-2026 01:04  </td><td align="right">2.1K</td></tr>'
        + '<tr><td><a href="?C=N;O=D">Name</a></td></tr>';
    assert.deepEqual(parseTgftpListing(html), [
        { name: 'sn.0001', stamp: '20-Oct-2026 16:18' },
        { name: 'sn.last', stamp: '21-Oct-2026 01:04' },
    ]);
});

test('destinationPoint goes the right way and distance', () => {
    const north = destinationPoint(35, -97, 0, 111_195);
    assert.ok(Math.abs(north.lat - 36) < 0.01 && Math.abs(north.lon - -97) < 0.01);
    assert.equal(tgftpStationId('KTLX'), 'ktlx');
});