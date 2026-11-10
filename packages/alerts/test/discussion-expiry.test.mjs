import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import {
    isExpired,
    spcExpiryMs,
    wpcExpiryMs,
    activeDiscussionFeatures,
    createExpiryWatch,
    discussionFeatureExpiryMs,
} from '@edgewarn/web-utils/alerts';

const at = (iso) => Date.parse(iso);

test('a WPC MPD is expired once its DDHHMM end time has passed', () => {
    const now = at('2026-11-07T14:00:00Z');
    assert.equal(isExpired(wpcExpiryMs('071330', now), now), true);
    assert.equal(isExpired(wpcExpiryMs('071500', now), now), false);
    assert.equal(wpcExpiryMs('071330', now), at('2026-11-07T13:30:00Z'));
});

test('a WPC end time across a month boundary resolves to the nearest month', () => {
    const now = at('2026-11-30T23:50:00Z');
    assert.equal(wpcExpiryMs('010130', now), at('2026-12-01T01:30:00Z'));
    assert.equal(isExpired(wpcExpiryMs('010130', now), now), false);
});

test('an unreadable end time keeps the discussion', () => {
    const now = at('2026-11-07T14:00:00Z');
    assert.equal(wpcExpiryMs(null, now), null);
    assert.equal(wpcExpiryMs('319999', now), null);
    assert.equal(spcExpiryMs('Mesoscale Discussion', now), null);
    assert.equal(spcExpiryMs(null, now), null);
    assert.equal(isExpired(null, now), false);
});

test('an SPC MCD reads its end from the Valid range, which carries the day', () => {
    const now = at('2026-11-07T01:00:00Z');
    const text = 'Mesoscale Discussion 1802 Valid 062115Z - 070015Z';
    assert.equal(spcExpiryMs(text, now), at('2026-11-07T00:15:00Z'));
    assert.equal(isExpired(spcExpiryMs(text, now), now), true);
    assert.equal(isExpired(spcExpiryMs(text, at('2026-11-06T23:00:00Z')), at('2026-11-06T23:00:00Z')), false);
});

test('an SPC MCD with only "Active Till HHMM" takes the nearest such time, across midnight too', () => {
    assert.equal(isExpired(spcExpiryMs('Active Till 0015Z', at('2026-11-07T01:00:00Z')), at('2026-11-07T01:00:00Z')), true);
    assert.equal(isExpired(spcExpiryMs('Active Till 0015Z', at('2026-11-06T23:00:00Z')), at('2026-11-06T23:00:00Z')), false);
    assert.equal(isExpired(spcExpiryMs('Active Till 2330Z', at('2026-11-06T20:00:00Z')), at('2026-11-06T20:00:00Z')), false);
});

const feature = (properties) => ({ type: 'Feature', geometry: null, properties });

test('activeDiscussionFeatures drops expired SPC and WPC features and returns the same collection when none expired', () => {
    const now = at('2026-11-07T14:00:00Z');
    const collection = {
        type: 'FeatureCollection',
        features: [
            feature({ name: 'MD 1', folderpath: 'Valid 071200Z - 071330Z' }),
            feature({ name: 'MD 2', folderpath: 'Valid 071200Z - 071500Z' }),
            feature({ mpdNumber: '0001', validEnd: '071330' }),
            feature({ mpdNumber: '0002', validEnd: '071600' }),
        ],
    };
    assert.deepEqual(
        activeDiscussionFeatures(collection, now).features.map((f) => f.properties.name ?? f.properties.mpdNumber),
        ['MD 2', '0002'],
    );
    const live = { type: 'FeatureCollection', features: [feature({ validEnd: '071600' })] };
    assert.equal(activeDiscussionFeatures(live, now), live);
    assert.equal(discussionFeatureExpiryMs(feature({ validEnd: '071600' }), now), at('2026-11-07T16:00:00Z'));
});

function fakeClock(now) {
    const timers = new Map();
    let id = 0;
    return {
        timers,
        clock: {
            now: () => now,
            setTimeout: (callback, delayMs) => {
                const handle = ++id;
                timers.set(handle, {
                    delayMs,
                    callback: () => {
                        timers.delete(handle);
                        callback();
                    },
                });
                return handle;
            },
            clearTimeout: (handle) => timers.delete(handle),
        },
    };
}

test('the expiry watch arms one timer just after the earliest end time ahead, using the injected clock', () => {
    const now = at('2026-11-07T14:00:00Z');
    const { timers, clock } = fakeClock(now);
    let fired = 0;
    const watch = createExpiryWatch(() => { fired += 1; }, clock);
    watch.arm([at('2026-11-07T15:00:00Z'), at('2026-11-07T14:30:00Z'), null, undefined, at('2026-11-07T13:00:00Z')]);
    assert.deepEqual([...timers.values()].map((t) => t.delayMs), [30 * 60_000 + 1000]);
    watch.arm([at('2026-11-07T14:10:00Z')]);
    assert.equal(timers.size, 1, 'arm replaces the earlier timer');
    assert.equal([...timers.values()][0].delayMs, 10 * 60_000 + 1000);
    [...timers.values()][0].callback();
    assert.equal(fired, 1);
    assert.equal(timers.size, 0, 'a fired timer is released');
    watch.arm([at('2026-11-07T14:20:00Z')]);
    watch.clear();
    assert.equal(timers.size, 0);
    watch.arm([at('2026-11-07T13:00:00Z'), null]);
    assert.equal(timers.size, 0, 'no end time ahead arms nothing');
});

test('the expiry watch caps the delay at the 32-bit timer limit', () => {
    const now = at('2026-11-07T14:00:00Z');
    const { timers, clock } = fakeClock(now);
    createExpiryWatch(() => {}, clock).arm([now + 90 * 24 * 60 * 60_000]);
    assert.equal([...timers.values()][0].delayMs, 2 ** 31 - 1);
});

test('the expiry watch defaults to the global timers and Date.now', () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'], now: at('2026-11-07T14:00:00Z') });
    try {
        let fired = 0;
        const watch = createExpiryWatch(() => { fired += 1; });
        watch.arm([at('2026-11-07T14:30:00Z')]);
        mock.timers.tick(30 * 60_000);
        assert.equal(fired, 0);
        mock.timers.tick(1000);
        assert.equal(fired, 1);
        watch.arm([at('2026-11-07T14:40:00Z')]);
        watch.clear();
        mock.timers.tick(60 * 60_000);
        assert.equal(fired, 1);
    } finally {
        mock.timers.reset();
    }
});
