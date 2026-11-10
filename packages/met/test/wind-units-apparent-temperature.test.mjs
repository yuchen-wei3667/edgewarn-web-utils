import test from 'node:test';
import assert from 'node:assert/strict';
import {
    convertKnots,
    convertMetersPerSecond,
    convertMilesPerHour,
    formatWindSpeed,
    steadmanApparentTemperature,
} from '@edgewarn/web-utils/met';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('wind conversions use the fixed factors and pass through the source unit', () => {
    assert.equal(convertKnots(10, 'kts'), 10);
    near(convertKnots(10, 'mph'), 11.50779448);
    near(convertKnots(10, 'km/h'), 18.52);
    near(convertMetersPerSecond(10, 'kts'), 19.43844492);
    near(convertMetersPerSecond(10, 'km/h'), 36);
    near(convertMetersPerSecond(10, 'mph'), 22.36936292);
    assert.equal(convertMilesPerHour(10, 'mph'), 10);
    near(convertMilesPerHour(10, 'kts'), 8.68976242);
    near(convertMilesPerHour(10, 'km/h'), 16.09344);
    assert.equal(convertKnots(0, 'mph'), 0);
});

test('formatWindSpeed rounds and appends the unit', () => {
    assert.equal(formatWindSpeed(12.5, 'mph'), '13mph');
    assert.equal(formatWindSpeed(12.4, 'kts'), '12kts');
    assert.equal(formatWindSpeed(0, 'km/h'), '0km/h');
});

test('Steadman apparent temperature: hot humid air feels hotter, wind cools, missing inputs return the air temperature', () => {
    // 86 F (30 C), 70 % RH, calm: vapour pressure 29.6 hPa gives 35.8 C apparent.
    near(steadmanApparentTemperature(86, 70, 0), 96.38, 0.01);
    assert.ok(steadmanApparentTemperature(86, 70, 15) < steadmanApparentTemperature(86, 70, 0));
    assert.ok(steadmanApparentTemperature(86, 90, 5) > steadmanApparentTemperature(86, 30, 5));
    assert.equal(steadmanApparentTemperature(75, null, 5), 75);
    assert.equal(steadmanApparentTemperature(75, 50, null), 75);
    assert.equal(steadmanApparentTemperature(null, 50, 5), null);
    assert.equal(steadmanApparentTemperature(70, 150, 0), steadmanApparentTemperature(70, 100, 0), 'humidity clamps to 0-100');
});
