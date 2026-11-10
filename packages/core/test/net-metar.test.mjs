import test from 'node:test';
import assert from 'node:assert/strict';
import {
    conusStationIds,
    latestMetarEntries,
    metarHourTimestamps,
    metarStampToIso,
} from '@edgewarn/web-utils/net';

test('hourly stamps run oldest to newest on whole UTC hours', () => {
    const stamps = metarHourTimestamps(Date.parse('2026-10-17T18:25:00Z'), 3);
    assert.deepEqual(stamps, ['20261017-160000', '20261017-170000', '20261017-180000']);
    assert.equal(metarStampToIso(stamps[2]), '2026-10-17T18:00:00Z');
    assert.equal(metarStampToIso('20261017-181500'), null);
});

test('station list keeps K stations inside CONUS only', () => {
    const csv = [
        'raw_text,station_id,observation_time,latitude,longitude',
        '"METAR KJFK 1751Z",KJFK,2026-10-17T17:51:00.000Z,40.6392,-73.7639,11',
        '"METAR CYPH 1821Z",CYPH,2026-10-17T18:21:00.000Z,58.4700,-78.0800,-1',
        '"METAR PHNL 1853Z",PHNL,2026-10-17T18:53:00.000Z,21.3,-157.9,25',
    ].join('\n');
    assert.deepEqual(conusStationIds(csv), ['KJFK']);
});

test('newest report per station at or before the hour wins', () => {
    const at = Date.parse('2026-10-17T18:00:00Z');
    const row = (icaoId, iso, extra = {}) => ({ icaoId, obsTime: Date.parse(iso) / 1000, lat: 40, lon: -73, temp: 11.1, dewp: 0.6, wdir: 340, wspd: 15, wgst: null, ...extra });
    const entries = latestMetarEntries([
        row('KLGA', '2026-10-17T17:00:00Z', { temp: 1 }),
        row('KLGA', '2026-10-17T17:51:00Z', { wgst: 20 }),
        row('KLGA', '2026-10-17T18:10:00Z', { temp: 99 }),
        { icaoId: 'KBAD' },
    ], at);
    assert.equal(entries.length, 1);
    assert.deepEqual(entries[0], {
        observation_time: '2026-10-17T17:51:00.000Z',
        station: 'KLGA',
        coordinates: [40, -73],
        wind: { direction: '340', speed: '15', gust: '20' },
        temperature: '11.1',
        dewpoint: '0.6',
    });
});

test('missing values become the strings the layer already handles', () => {
    const [entry] = latestMetarEntries([{ icaoId: 'KABC', obsTime: 1, lat: 1, lon: 2, temp: null, dewp: null, wdir: null, wspd: null }], Date.now());
    assert.equal(entry.temperature, '');
    assert.equal(entry.wind.direction, 'VRB');
    assert.equal(entry.wind.speed, '0');
    assert.equal(entry.wind.gust, null);
});
