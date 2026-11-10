import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeSounding, componentsFromWind, windFromComponents } from '@edgewarn/web-utils/met';
import {
    barbSymbol, buoyancyAreas, clipPolyline, columnTrace, createHodograph, createSkewT, helicityArea, heightTicks, hodographLayerIndex,
    hodographMarkers, hodographPointAtPressure, hodographRings, hodographSegments, levelReadout, parcelMarkers, parcelTrace, pointOfStormMotion,
    skewTBackground, stormMotionAtPoint, windBarbs,
} from '@edgewarn/web-utils/met/plot';
import { LEVELS, HEIGHT_OF, mkCol, straightWinds, unstableColumn } from './helpers.mjs';

/** Skew-T and hodograph geometry: closed-form mappings and the shapes they must keep, with no DOM. */

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);
const inside = (skewT, pt) => pt.x >= -1e-6 && pt.x <= skewT.width + 1e-6 && pt.y >= -1e-6 && pt.y <= skewT.height + 1e-6;

test('wind: components and direction round trip, a wind from the west blows toward +u', () => {
    near(componentsFromWind(270, 10).u, 10);
    near(componentsFromWind(180, 10).v, 10);
    for (const [dir, speed] of [[10, 5], [90, 20], [200, 7.5], [359, 1]]) {
        const { u, v } = componentsFromWind(dir, speed);
        const back = windFromComponents(u, v);
        near(back.dirDeg, dir, 1e-6);
        near(back.speedMs, speed);
    }
    assert.deepEqual(windFromComponents(0, 0), { speedMs: 0, dirDeg: 0 });
});

test('barbs: speeds in knots make pennants, full and half barbs', () => {
    const ms = (kt) => kt / 1.943844;
    const sym = (kt) => { const b = barbSymbol(ms(kt)); return [b.pennants, b.full, b.half, b.calm]; };
    assert.deepEqual(sym(0), [0, 0, false, true]);
    assert.deepEqual(sym(5), [0, 0, true, false]);
    assert.deepEqual(sym(65), [1, 1, true, false]);
    assert.deepEqual(sym(100), [2, 0, false, false]);
});

test('skew-T: a point maps back through the inverse, the frame corners land on the stated limits, and isotherms lean right going up', () => {
    const s = createSkewT();
    for (const [t, p] of [[20, 1000], [-30, 500], [0, 850]]) {
        const back = s.invert(s.x(t, p), s.y(p));
        near(back.tC, t, 1e-9);
        near(back.pHpa, p, 1e-9);
    }
    near(s.y(s.pTopHpa), 0);
    near(s.y(s.pBottomHpa), s.height);
    near(s.x(-40, s.pBottomHpa), 0);
    assert.ok(s.x(0, 500) > s.x(0, 900), 'the same temperature is further right higher up');
    near(s.y(250) - s.y(500), s.y(500) - s.y(1000), 1e-9); // equal pressure ratios are equal distances
});

test('clipping: a line leaving the frame ends on its edge, and one wholly outside is dropped', () => {
    const runs = clipPolyline([{ x: -50, y: 50 }, { x: 150, y: 50 }, { x: 150, y: 400 }], 100, 100);
    assert.equal(runs.length, 1);
    assert.deepEqual(runs[0], [{ x: 0, y: 50 }, { x: 100, y: 50 }]);
    assert.deepEqual(clipPolyline([{ x: 200, y: 0 }, { x: 300, y: 50 }], 100, 100), []);
    assert.deepEqual(clipPolyline([{ x: 10, y: 10 }, { x: Number.NaN, y: 20 }], 100, 100), []);
});

test('skew-T background: every line is inside the frame, isobars are on the log axis, adiabats follow their definitions', () => {
    const s = createSkewT();
    const bg = skewTBackground(s);
    for (const family of [bg.isotherms, bg.dryAdiabats, bg.moistAdiabats, bg.mixingRatios]) {
        assert.ok(family.length > 0);
        for (const line of family) for (const run of line.lines) for (const pt of run) assert.ok(inside(s, pt), `${line.value}: ${pt.x},${pt.y}`);
    }
    for (const iso of bg.isobars) near(iso.y, s.y(iso.pHpa));
    const zero = bg.isotherms.find((l) => l.value === 0);
    near(zero.lines[0][0].y, s.height, 1e-6);
    // The dry adiabat of theta 30 C passes 1000 hPa at 30 C and 500 hPa at 303.15 * 0.5^0.2857 - 273.15.
    const theta30 = bg.dryAdiabats.find((l) => l.value === 30).lines[0];
    const at500 = theta30.find((pt) => Math.abs(pt.y - s.y(500)) < 1e-6);
    near(s.invert(at500.x, at500.y).tC, 303.15 * 0.5 ** 0.28571426 - 273.15, 1e-6);
    // A moist adiabat is warmer than the dry one through the same point at 1000 hPa, higher up.
    const moist = bg.moistAdiabats.find((l) => l.value === 20).lines[0];
    const dry = bg.dryAdiabats.find((l) => l.value === 20).lines[0];
    const xAt = (run, p) => run.find((pt) => Math.abs(pt.y - s.y(p)) < 1e-6).x;
    assert.ok(xAt(moist, 500) > xAt(dry, 500));
});

test('traces and ticks: a trace has a point per level and breaks where dewpoint is missing; height ticks follow the heights', () => {
    const s = createSkewT();
    const col = unstableColumn();
    const t = columnTrace(s, col, 't');
    assert.equal(t.length, 1);
    assert.equal(t[0].length, col.p.length);
    near(t[0][0].y, s.y(1000));
    const td = Float32Array.from(col.td);
    td[5] = Number.NaN;
    assert.equal(columnTrace(s, { ...col, td }, 'td').length, 2);
    // Virtual temperature is warmer than temperature in a moist column.
    assert.ok(columnTrace(s, col, 'tv')[0][0].x > t[0][0].x);
    const ticks = heightTicks(s, col);
    const km1 = ticks.find((k) => k.km === 1);
    near(km1.pHpa, 900, 1e-3); // 10 m per hPa in the fixture, surface at 1000 hPa
    assert.ok(ticks.every((k) => k.pHpa >= s.pTopHpa));
});

test('barbs are thinned along the pressure axis and carry the wind', () => {
    const s = createSkewT();
    const [u, v] = straightWinds();
    const col = mkCol(LEVELS, LEVELS.map((p) => 25 - 0.006 * HEIGHT_OF(p)), LEVELS.map(() => -20), u, v);
    const all = windBarbs(s, col, 0);
    const thin = windBarbs(s, col, 40);
    assert.equal(all.length, LEVELS.length);
    assert.ok(thin.length < all.length && thin.length > 3);
    for (let k = 1; k < thin.length; k++) assert.ok(thin[k - 1].y - thin[k].y >= 40);
    near(thin[0].speedMs, 0); // straight winds start calm at the surface
    assert.ok(thin[0].calm);
    const upper = thin[thin.length - 1];
    near(upper.u, 0.005 * HEIGHT_OF(upper.pHpa), 1e-4);
});

test('readout: interpolates between levels, and is null outside the profile', () => {
    const col = unstableColumn();
    const r = levelReadout(col, 837.5);
    near(r.tC, (col.t[col.p.indexOf(850)] + col.t[col.p.indexOf(825)]) / 2, 0.2);
    near(r.zAglM, (1000 - 837.5) * 10, 1);
    assert.equal(levelReadout(col, 50), null);
});

test('CAPE and CIN areas: shaded between the LFC and EL, polygons in the frame, CIN under a cap', () => {
    const s = createSkewT();
    const col = unstableColumn();
    const parcel = analyzeSounding(col).parcels.sb;
    assert.ok(parcel.cape > 0 && parcel.lfcP !== null && parcel.elP !== null);
    const areas = buoyancyAreas(s, col, parcel);
    assert.ok(areas.cape.length >= 1);
    for (const polygon of areas.cape) {
        assert.ok(polygon.length >= 4);
        for (const pt of polygon) assert.ok(inside(s, pt));
        const ps = polygon.map((pt) => s.invert(pt.x, pt.y).pHpa);
        // The fixture's parcel is warmer than its surroundings from the surface, so the area reaches below the LFC.
        assert.ok(Math.max(...ps) >= parcel.lfcP && Math.abs(Math.min(...ps) - parcel.elP) < 6, 'ends at the EL');
    }
    const trace = parcelTrace(s, parcel);
    assert.equal(trace.length, parcel.trace.length);
    assert.deepEqual(parcelMarkers(s, parcel).map((m) => m.kind), ['lcl', 'lfc', 'el']);
    for (const m of parcelMarkers(s, parcel)) near(m.y, s.y(m.pHpa));
    assert.deepEqual(buoyancyAreas(s, col, { ...parcel, trace: [] }), { cape: [], cin: [] });

    // A warm layer at 800-900 hPa caps the parcel: the negative buoyancy there is CIN, shaded between the cap's own levels.
    const capped = mkCol(Array.from(col.p), Array.from(col.t, (t, k) => (col.p[k] <= 900 && col.p[k] >= 800 ? t + 16 : t)), Array.from(col.td), null, null);
    const cap = analyzeSounding(capped).parcels.sb;
    assert.ok(cap.cin < 0);
    const capAreas = buoyancyAreas(s, capped, cap);
    assert.ok(capAreas.cin.length >= 1);
    for (const polygon of capAreas.cin) for (const pt of polygon) assert.ok(s.invert(pt.x, pt.y).pHpa > 780 && s.invert(pt.x, pt.y).pHpa < 920);
});

test('hodograph: components map with north up, the inverse returns them, rings are evenly spaced', () => {
    const h = createHodograph();
    const pt = h.point(10, 20);
    assert.ok(pt.x > h.size / 2 && pt.y < h.size / 2);
    const back = h.invert(pt.x, pt.y);
    near(back.u, 10);
    near(back.v, 20);
    const rings = hodographRings(h);
    assert.equal(rings[0].speedMs, h.ringStepMs);
    near(rings[rings.length - 1].r, h.size / 2);
    near(rings[1].r - rings[0].r, rings[0].r);
});

test('hodograph layers: bounds belong to the layer above, and the top bound and below ground belong to none', () => {
    assert.equal(hodographLayerIndex(0), 0);
    assert.equal(hodographLayerIndex(999.9), 0);
    assert.equal(hodographLayerIndex(1000), 1);
    assert.equal(hodographLayerIndex(5999), 2);
    assert.equal(hodographLayerIndex(6000), 3);
    assert.equal(hodographLayerIndex(12000), null);
    assert.equal(hodographLayerIndex(-1), null);
});

test('hodograph trace: coloured pieces join end to end and each ends on a layer boundary', () => {
    const h = createHodograph();
    const [u, v] = straightWinds();
    const col = mkCol(LEVELS, LEVELS.map(() => 10), LEVELS.map(() => -10), u, v);
    const segments = hodographSegments(h, col);
    assert.deepEqual(segments.map((s) => s.layer), [0, 1, 2, 3], 'the fixture reaches 8 km: 0-1, 1-3, 3-6 and 6-9 km');
    assert.equal(segments[3].toM, 8000);
    for (let k = 1; k < segments.length; k++) {
        assert.equal(segments[k].fromM, segments[k - 1].toM);
        assert.deepEqual(segments[k].points[0], segments[k - 1].points[segments[k - 1].points.length - 1]);
    }
    assert.equal(segments[0].toM, 1000);
    assert.equal(segments[1].toM, 3000);
    // The fixture's straight hodograph runs 5 m/s per km along +u, so the end of the first layer is at u = 5.
    near(segments[0].points[segments[0].points.length - 1].x, h.point(5, 0).x, 1e-3);
    const near1 = hodographPointAtPressure(h, col, 900);
    near(near1.x, h.point(5, 0).x, 1e-3);
    assert.equal(hodographPointAtPressure(h, col, 50), null);
});

test('hodograph markers and storm motion: a straight hodograph has movers either side of the mean wind, and a dragged motion round trips', () => {
    const h = createHodograph();
    const [u, v] = straightWinds();
    const col = unstableColumn(u, v);
    const analysis = analyzeSounding(col);
    const markers = hodographMarkers(h, analysis);
    assert.deepEqual(markers.map((m) => m.kind), ['right-mover', 'left-mover', 'mean-wind', 'storm']);
    const rm = markers[0];
    const lm = markers[1];
    assert.ok(rm.y > lm.y, 'north is up: the southern mover is lower on the page');
    assert.ok(rm.v < 0 && lm.v > 0, 'a westerly-shear hodograph has its right mover to the south');
    near(Math.hypot(rm.u - lm.u, rm.v - lm.v), 15, 1e-3); // the movers deviate 7.5 m/s either side of the same mean
    const dragged = stormMotionAtPoint(h, ...Object.values(pointOfStormMotion(h, { kind: 'user', dirDeg: 240, speedMs: 12.5 })));
    near(dragged.dirDeg, 240, 1e-6);
    near(dragged.speedMs, 12.5, 1e-6);
});

test('helicity area: starts at the storm motion and follows the trace across the layer', () => {
    const h = createHodograph();
    const [u, v] = straightWinds();
    const col = mkCol(LEVELS, LEVELS.map(() => 10), LEVELS.map(() => -10), u, v);
    const storm = { u: 5, v: -5 };
    const area = helicityArea(h, col, storm, 0, 3000);
    assert.deepEqual(area[0], h.point(5, -5));
    assert.deepEqual(area[1], h.point(0, 0));
    assert.deepEqual(area[area.length - 1], h.point(15, 0));
    assert.deepEqual(helicityArea(h, col, storm, 0, 90000), [], 'a layer above the profile has no area');
});
