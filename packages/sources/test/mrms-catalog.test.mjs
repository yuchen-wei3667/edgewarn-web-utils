import test from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_MRMS_PRODUCT, MRMS_GROUP_ORDER, MRMS_PRODUCTS, familyProducts, getMrmsProduct, isMrmsProductId, reconcileCatalog, resolveMrmsId,
} from '@edgewarn/web-utils/mrms';

const live = MRMS_PRODUCTS.filter((p) => p.available);

test('the catalog covers the 243 CONUS directories, 241 of them publishing', () => {
    assert.equal(MRMS_PRODUCTS.length, 243);
    assert.equal(live.length, 241);
    assert.deepEqual(MRMS_PRODUCTS.filter((p) => !p.available).map((p) => p.id).sort(), ['ANC_ConvectiveLikelihood_00.00', 'ANC_FinalForecast_00.00']);
    assert.equal(new Set(MRMS_PRODUCTS.map((p) => p.id)).size, 243);
});

test('every available product has a label, group, units and a colormap type', () => {
    for (const p of live) {
        assert.ok(p.label && p.label !== p.id, `${p.id} needs a label`);
        assert.notEqual(p.group, 'other', `${p.id} is not grouped`);
        assert.ok(p.units, `${p.id} needs units`);
        assert.ok(p.colormap, `${p.id} needs a colormap type`);
        assert.ok(['max', 'nearest', 'maxAbs'].includes(p.pool));
        assert.ok(p.sentinels.length > 0);
        assert.equal(p.domain, 'CONUS');
    }
});

test('group sizes match the selector plan (plan section 7)', () => {
    const counts = Object.fromEntries(MRMS_GROUP_ORDER.map((g) => [g.id, live.filter((p) => p.group === g.id).length]));
    assert.deepEqual(counts, {
        reflectivity: 16, isothermal: 5, reflectivity3d: 33, dualpol3d: 66, echotops: 5, hail: 13, rotation: 14,
        vil: 6, precip: 6, qpe: 23, flash: 19, lightning: 8, environment: 5, quality: 22, other: 0,
    });
    assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), 241);
});

test('labels are unique so the selector never shows two identical rows', () => {
    const seen = new Map();
    for (const p of live) {
        assert.ok(!seen.has(p.label), `${p.id} and ${seen.get(p.label)} share the label "${p.label}"`);
        seen.set(p.label, p.id);
    }
});

test('legacy IDs are unique and resolve to the Phase 0 verified S3 products', () => {
    const expected = {
        MRMS_MergedReflectivityQC: 'MergedReflectivityQCComposite_00.50',
        MRMS_ReflectivityAtLowestAltitude: 'MergedReflectivityAtLowestAltitude_00.50',
        MRMS_ReflectivityAt0C: 'Reflectivity_0C_00.50',
        MRMS_ReflectivityAtM5C: 'Reflectivity_-5C_00.50',
        MRMS_ReflectivityAtM15C: 'Reflectivity_-15C_00.50',
        MRMS_EchoTop18: 'EchoTop_18_00.50',
        MRMS_EchoTop30: 'EchoTop_30_00.50',
        MRMS_PrecipRate: 'PrecipRate_00.00',
        MRMS_QPE: 'RadarOnly_QPE_01H_00.00',
        MRMS_VIL: 'VIL_00.50',
        MRMS_VII: 'VII_00.50',
        MRMS_MESH: 'MESH_00.50',
        MRMS_VILDensity: 'VIL_Density_00.50',
        MRMS_NLDN_CG_001min_AvgDensity: 'NLDN_CG_001min_AvgDensity_00.00',
        'MRMS_MergedAzShear_0-2kmAGL': 'MergedAzShear_0-2kmAGL_00.50',
        'MRMS_MergedAzShear_3-6kmAGL': 'MergedAzShear_3-6kmAGL_00.50',
    };
    const all = MRMS_PRODUCTS.flatMap((p) => p.legacyIds ?? []);
    assert.equal(new Set(all).size, all.length);
    assert.equal(all.length, 16);
    for (const [legacy, id] of Object.entries(expected)) {
        assert.equal(resolveMrmsId(legacy), id, legacy);
        assert.ok(isMrmsProductId(legacy));
        assert.equal(getMrmsProduct(id).legacyIds.includes(legacy), true);
    }
    assert.equal(resolveMrmsId('GOES_ABI_C13_BrightnessTemp'), null);
    assert.equal(isMrmsProductId('RAP_Something'), false);
    assert.equal(resolveMrmsId(DEFAULT_MRMS_PRODUCT), DEFAULT_MRMS_PRODUCT);
});

test('3D families have contiguous, ordered levels', () => {
    const levels = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
    for (const family of ['MergedReflectivityQC', 'MergedZdr', 'MergedRhoHV']) {
        const products = familyProducts(family);
        assert.deepEqual(products.map((p) => p.family.levelKm), levels, family);
        assert.ok(products.every((p) => p.id === `${family}_${p.family.levelKm.toFixed(2).padStart(5, '0')}`), `${family} ids`);
        assert.equal(new Set(products.map((p) => p.group)).size, 1);
    }
});

test('sentinels: -3 stays real data for shear, Zdr and temperatures; categorical products use nearest sampling', () => {
    for (const id of ['MergedAzShear_0-2kmAGL_00.50', 'MergedZdr_01.00', 'Model_SurfaceTemp_00.50']) {
        assert.ok(!getMrmsProduct(id).sentinels.includes(-3), id);
        assert.ok(getMrmsProduct(id).sentinels.includes(-999), id);
    }
    assert.ok(getMrmsProduct('PrecipRate_00.00').sentinels.includes(-3));
    assert.ok(getMrmsProduct('FLASH_CREST_MAXSTREAMFLOW_00.00').sentinels.includes(-9999));
    for (const id of ['PrecipFlag_00.00', 'SyntheticPrecipRateID_00.00']) {
        assert.equal(getMrmsProduct(id).interpolate, false);
        assert.equal(getMrmsProduct(id).pool, 'nearest');
    }
    assert.equal(getMrmsProduct('MergedAzShear_0-2kmAGL_00.50').pool, 'maxAbs');
    assert.equal(getMrmsProduct('MESH_00.50').pool, 'max');
});

test('heavy products are the ones over 5 MB', () => {
    const heavy = live.filter((p) => p.heavy);
    assert.ok(heavy.length >= 10 && heavy.length <= 25, `${heavy.length} heavy products`);
    assert.ok(heavy.every((p) => p.sizeKB > 5 * 1024));
    assert.ok(live.filter((p) => !p.heavy).every((p) => p.sizeKB <= 5 * 1024));
    assert.ok(getMrmsProduct('BrightBandTopHeight_00.00').heavy);
    assert.ok(!getMrmsProduct('MergedReflectivityQCComposite_00.50').heavy);
});

test('reconcile hides missing products and shows unknown directories under Other', () => {
    const listed = MRMS_PRODUCTS.map((p) => p.id).filter((id) => id !== 'MESH_00.50');
    listed.push('BrandNewProduct_00.00');
    const result = reconcileCatalog(listed);
    assert.ok(!result.some((p) => p.id === 'MESH_00.50'), 'missing product hidden');
    assert.ok(!result.some((p) => p.id.startsWith('ANC_')), 'dead products stay hidden even when listed');
    const fresh = result.find((p) => p.id === 'BrandNewProduct_00.00');
    assert.equal(fresh.group, 'other');
    assert.ok(fresh.colormap);
    assert.equal(reconcileCatalog(null).length, 241, 'a failed listing trusts the checked-in availability');
});
