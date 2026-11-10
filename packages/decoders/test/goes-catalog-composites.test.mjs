import test from 'node:test';
import assert from 'node:assert/strict';
import {
    GOES_BANDS, GOES_COMPOSITES, GOES_PRODUCTS, GOES_PRODUCT_LABELS, GOES_RGB_PRODUCTS, COMPOSITE_TOP_LEVEL, bandLevelOffset, channelOf, compositeBands,
    getGoesBand, getGoesComposite, goesFrameKey, isGoesBandId, isGoesCompositeId, subsolarPoint, topLevel,
} from '../dist/goes/index.js';

test('the six requested composites exist, each with 2-4 known bands', () => {
    assert.deepEqual(GOES_COMPOSITES.map((c) => c.label), ['True Color', 'Airmass RGB', 'Day Cloud Phase', 'Sandwich RGB', 'NT Microphysics', 'Simple WV']);
    assert.deepEqual(GOES_COMPOSITES.map((c) => c.id), [...GOES_RGB_PRODUCTS]);
    for (const c of GOES_COMPOSITES) {
        const bands = compositeBands(c);
        assert.ok(bands.length >= 2 && bands.length <= 4, c.id);
        assert.ok(bands.every(Boolean), `${c.id} names an unknown band`);
        assert.ok(isGoesCompositeId(c.id));
    }
    assert.equal(isGoesCompositeId('GOES_ABI_C13_BrightnessTemp'), false);
});

test('component levels line up: composite level L reads each band where a texel is the same size', () => {
    for (const band of compositeBands(getGoesComposite('GOES_RGB_TrueColor'))) {
        const offset = bandLevelOffset(band);
        assert.equal(band.nativeKm * 2 ** offset, 2, band.id);
        assert.equal(COMPOSITE_TOP_LEVEL + offset, topLevel(band), 'top levels match the band pyramid');
    }
});

test('sub-solar point: June solstice noon UTC sits near 23.4N, 0E; December near 23.4S', () => {
    const deg = (r) => (r * 180) / Math.PI;
    const june = subsolarPoint(new Date(Date.UTC(2026, 5, 21, 12, 0, 0)));
    assert.ok(Math.abs(deg(june.lat) - 23.43) < 0.1, `lat ${deg(june.lat)}`);
    assert.ok(Math.abs(deg(june.lon)) < 1, `lon ${deg(june.lon)}`); // equation of time is ~-1.7 min here
    const dec = subsolarPoint(new Date(Date.UTC(2026, 11, 21, 18, 0, 0)));
    assert.ok(Math.abs(deg(dec.lat) + 23.43) < 0.1);
    assert.ok(Math.abs(deg(dec.lon) + 90) < 1.5, `lon ${deg(dec.lon)}`);
});

test('the band table follows the product list: 16 bands, labelled, with the right units and pixel size', () => {
    assert.equal(GOES_BANDS.length, 16);
    assert.deepEqual(GOES_BANDS.map((b) => b.id), [...GOES_PRODUCTS]);
    for (const band of GOES_BANDS) {
        assert.ok(GOES_PRODUCT_LABELS[band.id], band.id);
        assert.equal(band.kind, band.band <= 6 ? 'reflectance' : 'brightnessTemp');
        assert.equal(channelOf(band), `C${String(band.band).padStart(2, '0')}`);
        assert.ok(isGoesBandId(band.id));
    }
    assert.equal(getGoesBand('GOES_ABI_C02_Reflectance').nativeKm, 0.5);
    assert.equal(getGoesBand('GOES_ABI_C13_BrightnessTemp').colormap, 'GOES_IR');
    assert.equal(getGoesBand('GOES_ABI_C01_Reflectance').colormap, 'GOES_RGB_Raw');
    assert.equal(getGoesBand('GOES_ABI_C08_BrightnessTemp').colormap, 'GOES_ABI_C08');
    assert.equal(getGoesBand('nope'), undefined);
    assert.equal(topLevel(getGoesBand('GOES_ABI_C02_Reflectance')), 6);
    assert.equal(goesFrameKey('GOES_ABI_C13_BrightnessTemp', 'M1'), 'GOES_ABI_C13_BrightnessTemp@M1');
});
