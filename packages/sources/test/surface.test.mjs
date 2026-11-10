import test from 'node:test';
import assert from 'node:assert/strict';

test('the MRMS entry exposes only documented names and no private paths', async () => {
    const mrms = await import('@edgewarn/web-utils/mrms');
    for (const name of ['listDay', 'listProducts', 'MRMS_PRODUCTS', 'reconcileCatalog', 'sampleLightning', 'clampLine', 'sampleProfile', 'GzCache', 'MrmsHttpError'])
        assert.ok(name in mrms, name);
    // Geometry that lives in /geo is not re-exported here.
    for (const name of ['haversineM', 'destination', 'distanceBetween', 'pointAlong']) assert.ok(!(name in mrms), name);
    for (const path of ['mrms/listing', 'mrms/gz-cache', 'mrms/volume/geometry', 'mrms/catalog', 'sources', 'sources/dist/mrms/index.js'])
        await assert.rejects(import(`@edgewarn/web-utils/${path}`), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' }, path);
});

test('the GOES feed entry exposes only documented names and no private paths', async () => {
    const feed = await import('@edgewarn/web-utils/goes/feed');
    for (const name of ['fetchGoesTimeline', 'listScans', 'ReadAheadSource', 'streamAbi', 'GoesBandCache', 'fetchRange', 'buildMesh', 'viewportTiles', 'planDraws'])
        assert.ok(name in feed, name);
    // The projection is pure and lives in /goes.
    const goes = await import('@edgewarn/web-utils/goes');
    for (const name of ['lonLatToPixel', 'pixelToLonLat', 'zenithDeg', 'pyramidFromWire']) {
        assert.ok(name in goes, name);
        assert.ok(!(name in feed), name);
    }
    for (const path of ['goes/feed/listing', 'goes/feed/tiles', 'goes/tiles', 'goes/listing', 'sources/dist/goes/index.js'])
        await assert.rejects(import(`@edgewarn/web-utils/${path}`), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' }, path);
});

test('the NEXRAD feed entry exposes only documented names and no private paths', async () => {
    const feed = await import('@edgewarn/web-utils/nexrad/feed');
    for (const name of ['listArchiveDay', 'listLevel3Day', 'listChunks', 'parseArchiveKey', 'findNewestRingId', 'listNexradVolumes', 'pollLiveVolumes', 'receivingState', 'runLevel3Job', 'CacheStoragePrefixStore', 'parseTgftpListing'])
        assert.ok(name in feed, name);
    // UI copy stays out, and the pure tables live in /nexrad.
    assert.ok(!('receivingAnnouncement' in feed));
    const nexrad = await import('@edgewarn/web-utils/nexrad');
    for (const name of ['NEXRAD_SITES', 'buildElevations', 'groupTilts', 'beamHeightMeters', 'buildSweeps']) {
        assert.ok(name in nexrad, name);
        assert.ok(!(name in feed), name);
    }
    for (const path of ['nexrad/feed/listing', 'nexrad/feed/volumes', 'nexrad/listing', 'nexrad/geometry', 'nexrad/sites'])
        await assert.rejects(import(`@edgewarn/web-utils/${path}`), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' }, path);
});
