import test from 'node:test';
import assert from 'node:assert/strict';
import {
    dayOfYear,
    declinationDeg,
    oppositeAltitude,
    pathFraction,
    solarPosition,
    distanceMeters,
    distanceMiles,
    calculateDestination,
} from '@edgewarn/web-utils/geo';

test('the sun is near 73 degrees at Boulder solar noon on the June solstice', () => {
    const position = solarPosition(40, -105, new Date('2026-06-21T19:00:00Z'));
    assert.ok(Math.abs(position.altitudeDeg - 73.4) < 1, `altitude ${position.altitudeDeg}`);
    assert.ok(Math.abs(position.azimuthDeg - 180) < 3, `azimuth ${position.azimuthDeg}`);
});

test('the sun is below the horizon at local midnight, and the picture moon is opposite it', () => {
    const sun = solarPosition(40, -105, new Date('2026-06-22T07:00:00Z'));
    assert.ok(sun.altitudeDeg < -20);
    assert.equal(oppositeAltitude(sun), -sun.altitudeDeg);
});

test('day of the year follows the calendar at the target longitude', () => {
    assert.equal(dayOfYear(new Date('2026-01-01T12:00:00Z'), -97), 1);
    assert.equal(dayOfYear(new Date('2026-06-21T19:00:00Z'), -105), 172);
    // 03:00 UTC on 22 June is still the evening of 21 June in Dallas.
    assert.equal(dayOfYear(new Date('2026-06-22T03:00:00Z'), -97), 172);
});

test('declination swings with the season', () => {
    assert.ok(Math.abs(declinationDeg(172) - 23.44) < 0.5);
    assert.ok(Math.abs(declinationDeg(355) + 23.44) < 0.5);
    assert.ok(Math.abs(declinationDeg(80)) < 1);
});

test('day length depends on latitude and season', () => {
    const length = (lat, iso) => {
        const p = solarPosition(lat, 0, new Date(iso));
        return p.sunsetHour - p.sunriseHour;
    };
    assert.ok(Math.abs(length(0, '2026-03-20T12:00:00Z') - 12) < 0.2);
    assert.ok(length(40, '2026-06-21T12:00:00Z') > 14.5);
    assert.ok(length(40, '2026-12-21T12:00:00Z') < 9.5);
    assert.ok(length(40, '2026-12-21T12:00:00Z') > 8.5);
});

test('far north in midsummer the sun does not set, and in midwinter it does not rise', () => {
    const summer = solarPosition(75, 0, new Date('2026-06-21T12:00:00Z'));
    assert.equal(summer.sunriseHour, null);
    assert.ok(summer.altitudeDeg > 0);
    const winter = solarPosition(75, 0, new Date('2026-12-21T12:00:00Z'));
    assert.equal(winter.sunsetHour, null);
    assert.ok(winter.altitudeDeg < 0);
});

test('the noon sun is lower in winter than in summer at the same latitude', () => {
    const summer = solarPosition(32.8, -96.8, new Date('2026-06-21T18:00:00Z'));
    const winter = solarPosition(32.8, -96.8, new Date('2026-12-21T18:00:00Z'));
    assert.ok(summer.noonAltitudeDeg - winter.noonAltitudeDeg > 40);
});

test('pathFraction runs 0 to 1 across the day arc, across the night arc, and falls back to the clock in polar regions', () => {
    const base = { solarHour: 12, sunriseHour: 6, sunsetHour: 18 };
    assert.equal(pathFraction(base, true), 0.5);
    assert.equal(pathFraction({ ...base, solarHour: 6 }, true), 0);
    assert.equal(pathFraction({ ...base, solarHour: 18 }, false), 0);
    assert.equal(pathFraction({ ...base, solarHour: 0 }, false), 0.5);
    assert.equal(pathFraction({ solarHour: 6, sunriseHour: null, sunsetHour: null }, true), 0.25);
});

test('distanceMeters is haversine metres on the 6371008.8 m sphere', () => {
    assert.equal(distanceMeters(10, 20, 10, 20), 0);
    assert.ok(Math.abs(distanceMeters(0, 0, 0, 1) - 111195.08) < 0.01);
    assert.equal(distanceMeters(30, -90, 31, -89), distanceMeters(31, -89, 30, -90));
    // Antipodes stay finite: rounding can push the haversine term past 1.
    assert.ok(Number.isFinite(distanceMeters(0, 0, 0, 180)));
    assert.ok(Math.abs(distanceMeters(0, 0, 0, 180) - Math.PI * 6371008.8) < 1e-3);
    // It agrees with distanceMiles to within their different Earth radii.
    assert.ok(Math.abs(distanceMeters(35, -97, 36, -96) / 1609.344 / distanceMiles(35, -97, 36, -96) - 1) < 1e-4);
});

test('calculateDestination takes metres and bearing degrees like the MRMS destination, up to the radius difference', () => {
    // MRMS destination: R = 6371008.8, longitude wrapped to [-180, 180).
    const R = 6371008.8;
    const rad = (d) => (d * Math.PI) / 180;
    const deg = (r) => (r * 180) / Math.PI;
    const mrms = (lat0, lng0, distanceM, bearing) => {
        const brg = rad(bearing), lat = rad(lat0), ang = distanceM / R;
        const lat2 = Math.asin(Math.sin(lat) * Math.cos(ang) + Math.cos(lat) * Math.sin(ang) * Math.cos(brg));
        const lng2 = rad(lng0) + Math.atan2(Math.sin(brg) * Math.sin(ang) * Math.cos(lat), Math.cos(ang) - Math.sin(lat) * Math.sin(lat2));
        return [deg(lat2), ((deg(lng2) + 540) % 360) - 180];
    };
    for (const [lat, lon, distance, bearing] of [[35, -97, 250_000, 0], [35, -97, 250_000, 90], [35, -97, 250_000, 180], [35, -97, 250_000, 270], [40, -105, 1_000_000, 45]]) {
        const [a, b] = calculateDestination(lat, lon, distance, bearing);
        const [c, d] = mrms(lat, lon, distance, bearing);
        assert.ok(Math.abs(a - c) < 1e-4 && Math.abs(b - d) < 1e-4, `${bearing}: ${a},${b} vs ${c},${d}`);
    }
});
