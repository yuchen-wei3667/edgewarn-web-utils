import test from 'node:test';
import assert from 'node:assert/strict';

test('the models entry exposes the engine by plan bullet and no private paths', async () => {
    const models = await import('@edgewarn/web-utils/models');
    const bullets = {
        projection: ['projectionFor', 'snapToCell', 'lambertForward', 'lambertInverse', 'gridRotation', 'lambertGridProjection', 'latLonGridProjection', 'mercatorGridProjection', 'polarStereoGridProjection', 'rotatedLatLonGridProjection', 'LAMBERT_GLSL', 'LATLON_GLSL', 'MERCATOR_GLSL', 'POLAR_STEREO_GLSL', 'ROTATED_LATLON_GLSL'],
        fieldMath: ['rotateToEarth', 'speedAndDirection', 'gradient', 'gridMetrics', 'integrateTrajectory', 'buildIsobarSet', 'findPressureCenters', 'combineInputs', 'combineDiagnostic', 'levelLayout', 'cutTile'],
        sources: ['ModelFetcher', 'grib2IndexAdapter', 'loadSourceAdapter', 'ModelHttpError', 'ModelMessageCache', 'netcdfGridAdapter', 'RangeSource'],
        registry: ['findNewestRun', 'listRecentRuns', 'modelFileUrl', 'MODEL_FIELDS', 'getDataset', 'compileDataset', 'validateConfigs', 'memberIds', 'MODEL_CONFIGS'],
        compare: ['parseExpr', 'evaluate', 'checkExpr', 'regridLevel', 'alignSteps', 'runComparison', 'diffSpec', 'blendSpec'],
        tracks: ['listHafsStorms', 'fetchStormTrack', 'parseHafsStats', 'intensityCategory', 'positionAt'],
    };
    for (const [bullet, names] of Object.entries(bullets)) for (const name of names) assert.ok(name in models, `${bullet}: ${name}`);
    // URL state and tooltips are the website's, the OM reader is GPL-2.0, and the job runner is worker glue.
    for (const name of ['serializeComparison', 'parseComparison', 'storm', 'stormPopup', 'omGridAdapter', 'ModelJobRunner', 'modelFrameId', 'clearModelCaches', 'ExpiringMap', 'TtlMap'])
        assert.ok(!(name in models), name);
    for (const path of ['models/projection', 'models/sources', 'models/compare', 'models/configs', 'models/om', 'models/dist/index.js', 'models/internal/ttl-map'])
        await assert.rejects(import(`@edgewarn/web-utils/${path}`), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' }, path);
});

test('grid projections stay pure and hold no state between calls', async () => {
    const { projectionFor, getDataset } = await import('@edgewarn/web-utils/models');
    const grid = getDataset('hrrr').grid;
    const a = projectionFor(grid), b = projectionFor(grid);
    assert.notEqual(a, b);
    assert.equal(a.key, b.key);
    assert.deepEqual(a.forward(...a.inverse(100, 200)).map(Math.round), [100, 200]);
});
