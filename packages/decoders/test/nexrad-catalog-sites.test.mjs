import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVEL3_PRODUCT_LETTER, NEXRAD_MOMENT_OF, NEXRAD_SITES, NEXRAD_SITE_BY_ID, codeToValue, formatAngle, hasLevel3Moment } from '../dist/nexrad/index.js';

test('product ids map to Level II moments, and Level III carries four of them', () => {
    assert.deepEqual(Object.values(NEXRAD_MOMENT_OF), ['REF', 'VEL', 'SW', 'PHI', 'RHO', 'ZDR']);
    assert.deepEqual(Object.keys(LEVEL3_PRODUCT_LETTER), ['REF', 'VEL', 'ZDR', 'RHO']);
    assert.equal(hasLevel3Moment('VEL'), true);
    assert.equal(hasLevel3Moment('SW'), false);
});

test('codes 0 and 1 are not values; the rest follow (code - offset) / scale', () => {
    assert.equal(codeToValue(0, 2, 66), null);
    assert.equal(codeToValue(1, 2, 66), null);
    assert.equal(codeToValue(100, 2, 66), 17);
    assert.equal(formatAngle(0.48), '0.5°');
});

test('the site table is sorted, unique and indexed by id', () => {
    const ids = NEXRAD_SITES.map((s) => s.id);
    assert.deepEqual(ids, [...ids].sort());
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(NEXRAD_SITE_BY_ID.size, ids.length);
    const ktlx = NEXRAD_SITE_BY_ID.get('KTLX');
    assert.ok(ktlx && Math.abs(ktlx.lat - 35.333) < 0.01 && Math.abs(ktlx.lon + 97.278) < 0.01);
    for (const s of NEXRAD_SITES) assert.ok(Number.isFinite(s.lat) && Number.isFinite(s.lon) && s.stationType === 'WSR-88D', s.id);
});
