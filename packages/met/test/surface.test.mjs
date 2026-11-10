import test from 'node:test';
import assert from 'node:assert/strict';

test('the science entry has no plot geometry and the plot entry has no science, transport or private paths', async () => {
    const met = await import('@edgewarn/web-utils/met');
    const plot = await import('@edgewarn/web-utils/met/plot');
    for (const name of ['createSkewT', 'skewTBackground', 'columnTrace', 'parcelTrace', 'windBarbs', 'createHodograph', 'hodographSegments', 'buildTimeHeight', 'barbSymbol']) {
        assert.ok(name in plot, name);
        assert.ok(!(name in met), name);
    }
    for (const name of ['windFromComponents', 'stormSlinky', 'thetaEProfile', 'dendriticGrowthZone', 'precipitationPanel', 'soundingCsv', 'buildColumn', 'rotateWind', 'fetchRaobStations', 'fetchRaobColumn', 'nearestRaobStations', 'parseRaobColumn', 'recentRaobLaunches']) {
        assert.ok(name in met, name);
        assert.ok(!(name in plot), name);
    }
    // The site links stay with the website.
    for (const name of ['raobSoundingHref', 'parseRaobSoundingParams']) assert.ok(!(name in met), name);
});
