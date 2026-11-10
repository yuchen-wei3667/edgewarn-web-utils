import test from 'node:test';
import assert from 'node:assert/strict';
import { getGoesBand, lonLatToPixel, pixelToLonLat, pyramidFromWire, topLevel, zenithDeg } from '@edgewarn/web-utils/goes';
import {
    ancestorMap, buildMesh, footprintIntersectsView, gridFootprint, levelForView, meshCellForLevel, mercatorX, mercatorY, planDraws,
    texelToPixel, tileCounts, tileOffDisk, viewportTiles,
} from '@edgewarn/web-utils/goes/feed';

// Grids read from GOES-19 files of 2026-284 12:01Z.
const PROJ = { perspectivePointHeight: 35786023, semiMajorAxis: 6378137, semiMinorAxis: 6356752.31414, lon0: -75, scale: 1, offset: 0, fill: 65535 };
const C13 = { ...PROJ, x0: -0.10133200138807297, y0: 0.12821200489997864, dx: 0.000056000000768108293, dy: -0.000056000000768108293, width: 2500, height: 1500 };
const C02 = { ...PROJ, x0: -0.1013529971241951, y0: 0.12823300063610077, dx: 0.000014000000192027073, dy: -0.000014000000192027073, width: 10000, height: 6000 };
// Full Disk grids from GOES-19 2026-286 12:00Z: C13 is 5424 square, C02 is 21696 square.
const FD13 = { ...PROJ, x0: -0.15184399485588074, y0: 0.15184399485588074, dx: 0.000056000000768108293, dy: -0.000056000000768108293, width: 5424, height: 5424 };
const FD02 = { ...PROJ, x0: -0.151858, y0: 0.151858, dx: 0.000014000000192027073, dy: -0.000014000000192027073, width: 21696, height: 21696 };
const M1 = { ...PROJ, x0: -0.01397200021892786, y0: 0.1198119968175888, dx: 0.000056000000768108293, dy: -0.000056000000768108293, width: 500, height: 500 };

/** Interpolated texel coordinate at a mercator point inside one mesh triangle (what the rasteriser does). */
function interpolateTc(v, a, b, c, px, py) {
    const ax = v[a * 4], ay = v[a * 4 + 1], bx = v[b * 4], by = v[b * 4 + 1], cx = v[c * 4], cy = v[c * 4 + 1];
    const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    const wa = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / d;
    const wb = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / d;
    const wc = 1 - wa - wb;
    if (wa < -1e-9 || wb < -1e-9 || wc < -1e-9) return null;
    return [wa * v[a * 4 + 2] + wb * v[b * 4 + 2] + wc * v[c * 4 + 2], wa * v[a * 4 + 3] + wb * v[b * 4 + 3] + wc * v[c * 4 + 3]];
}

test('the warp mesh stays within the error budget at every level (<= 0.12 texel under 75 deg, <= 0.25 under 80)', () => {
    assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((l) => meshCellForLevel(l)), [8, 8, 8, 4, 4, 2, 2]);
    const g = pyramidFromWire(C02);
    const worst = { 75: 0, 80: 0 };
    const cities = [[-80.19, 25.76], [-71.06, 42.36], [-117.16, 32.72], [-122.33, 47.61], [-97.5, 35.5]];
    for (let level = 0; level <= 6; level++) {
        const span = 512 * 2 ** level;
        const keys = new Map();
        for (const [lon, lat] of [...cities, [-110, 60], [-95, 62], [-60, 55]]) {
            const p = lonLatToPixel(g, lon, lat);
            if (!p || p.col < 0 || p.row < 0 || p.col >= g.width || p.row >= g.height) continue;
            const key = { level, tx: Math.floor((p.col + 0.5) / span), ty: Math.floor((p.row + 0.5) / span) };
            keys.set(`${key.tx}/${key.ty}`, key);
        }
        for (const key of keys.values()) {
            const mesh = buildMesh(g, key);
            const v = mesh.vertices, idx = mesh.indices;
            // Probe a quarter of the triangles at interior points between texel centres.
            for (let t = 0; t < idx.length; t += 3 * 4) {
                const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
                for (const [fa, fb] of [[0.6, 0.3], [0.34, 0.33], [0.2, 0.7]]) {
                    const tcx = fa * v[a * 4 + 2] + fb * v[b * 4 + 2] + (1 - fa - fb) * v[c * 4 + 2];
                    const tcy = fa * v[a * 4 + 3] + fb * v[b * 4 + 3] + (1 - fa - fb) * v[c * 4 + 3];
                    // Exact position of that texel coordinate, then what the mesh samples there.
                    const ll = pixelToLonLat(g, texelToPixel(tcx + key.tx * 512, level), texelToPixel(tcy + key.ty * 512, level));
                    if (!ll) continue;
                    const got = interpolateTc(v, a, b, c, mercatorX(ll.lon), mercatorY(ll.lat))
                        ?? interpolateTc(v, idx[t + 3], idx[t + 4], idx[t + 5], mercatorX(ll.lon), mercatorY(ll.lat));
                    if (!got) continue;
                    const err = Math.hypot(got[0] - tcx, got[1] - tcy);
                    const zen = zenithDeg(g, ll.lon, ll.lat);
                    if (zen < 75) worst[75] = Math.max(worst[75], err);
                    else if (zen < 80) worst[80] = Math.max(worst[80], err);
                }
            }
        }
    }
    assert.ok(worst[75] <= 0.12, `worst error under 75 deg: ${worst[75]} texel`);
    assert.ok(worst[80] <= 0.25, `worst error 75-80 deg: ${worst[80]} texel`);
});

test('neighbouring tiles share edge vertices bit for bit', () => {
    const g = pyramidFromWire(C02);
    const level = 1;
    const left = buildMesh(g, { level, tx: 3, ty: 2 }), right = buildMesh(g, { level, tx: 4, ty: 2 });
    const top = buildMesh(g, { level, tx: 3, ty: 2 }), below = buildMesh(g, { level, tx: 3, ty: 3 });
    const nx = 65;
    for (let j = 0; j < 65; j++) {
        for (const k of [0, 1]) assert.equal(left.vertices[(j * nx + 64) * 4 + k], right.vertices[(j * nx) * 4 + k], `row ${j}`);
    }
    for (let i = 0; i < 65; i++) {
        for (const k of [0, 1]) assert.equal(top.vertices[(64 * nx + i) * 4 + k], below.vertices[i * 4 + k], `col ${i}`);
    }
    // A full interior tile keeps every one of its 64 x 64 cells.
    assert.equal(left.indices.length, 64 * 64 * 6);
    assert.ok(left.indices instanceof Uint16Array);
});

test('full-disk meshes keep triangle indices within their lattice cells', () => {
    const g = pyramidFromWire(FD02);
    for (const [level, grid] of [[5, g], [6, { ...g, width: g.width * 2, height: g.height * 2, dx: g.dx / 2, dy: g.dy / 2 }]]) {
        const mesh = buildMesh(grid, { level, tx: 0, ty: 0 });
        assert.equal(mesh.vertices.length / 4, 257 * 257);
        assert.ok(mesh.indices instanceof Uint32Array);
        assert.ok(mesh.indices.some(index => index >= 65536));
        for (let i = 0; i < mesh.indices.length; i += 3) {
            const [a, b, c] = mesh.indices.subarray(i, i + 3);
            assert.ok(Math.max(a, b, c) - Math.min(a, b, c) <= 258);
        }
    }
});

test('an off-earth tile has an empty mesh, and edge tiles stop at the grid edge', () => {
    const g = pyramidFromWire(C02);
    assert.equal(buildMesh(g, { level: 0, tx: 0, ty: 0 }).indices.length, 0);
    const { cols, rows } = tileCounts(g, 0);
    const corner = buildMesh(g, { level: 0, tx: cols - 1, ty: rows - 1 });
    const tcs = [];
    for (let i = 0; i < corner.vertices.length; i += 4) tcs.push(corner.vertices[i + 2]);
    assert.equal(Math.max(...tcs), (10000 - 1) - (cols - 1) * 512 + 0.5, 'right edge is the last pixel edge');
});

test('level of detail follows zoom, with hysteresis, and is clamped to the pyramid', () => {
    const g = pyramidFromWire(C02);
    const band = getGoesBand('GOES_ABI_C02_Reflectance');
    const top = topLevel(band);
    const view = (zoom) => {
        const span = 360 / 2 ** zoom;
        return { west: -97 - span / 2, east: -97 + span / 2, south: 35 - span / 4, north: 35 + span / 4 };
    };
    const at = (zoom, previous = null) => levelForView(zoom, view(zoom), g, top, { previous });
    assert.equal(at(12), 0, 'zoomed in: native pixels');
    assert.equal(at(1), top, 'zoomed out: the coarsest level');
    // At zoom 3 a CSS pixel is ~8 km over Oklahoma: 16 native 0.5 km pixels, so level 4.
    assert.equal(at(3), 4);
    const levels = [3, 4, 5, 6, 7, 8, 9, 10].map((z) => at(z));
    for (let i = 1; i < levels.length; i++) assert.ok(levels[i] <= levels[i - 1], 'levels never get coarser as you zoom in');
    // Inside the hysteresis band the previous level is kept.
    const l7 = at(7);
    assert.equal(levelForView(7.2, view(7.2), g, top, { previous: l7 }), l7);
    assert.equal(top, 6);
    assert.equal(levelForView(5, { west: 100, east: 110, south: 0, north: 10 }, g, top), null, 'no answer for a view off the disk');
});

test('full-disk tiles wholly in space are never requested', () => {
    const g = pyramidFromWire(FD13);
    const { cols, rows } = tileCounts(g, 0);
    assert.deepEqual([cols, rows], [11, 11]);
    let onDisk = 0;
    for (let ty = 0; ty < rows; ty++) for (let tx = 0; tx < cols; tx++) if (!tileOffDisk(g, { level: 0, tx, ty })) onDisk++;
    assert.equal(onDisk, 104, 'the four grid corners are space');
    assert.equal(tileOffDisk(g, { level: 0, tx: 0, ty: 0 }), true);
    assert.equal(tileOffDisk(g, { level: 0, tx: 5, ty: 5 }), false);
    assert.equal(tileOffDisk(g, { level: 0, tx: 5, ty: 0 }), false, 'the north limb edge is on the disk');
    const world = { west: -180, east: 180, south: -85, north: 85 };
    assert.equal(viewportTiles(world, 0, g, 0).length, 104);
    // A CONUS grid sits wholly on the earth, so nothing is culled.
    const conus = pyramidFromWire(C13);
    const { cols: cc, rows: cr } = tileCounts(conus, 0);
    assert.equal(viewportTiles(world, 0, conus, 0).length, cc * cr);
    assert.ok(gridFootprint(pyramidFromWire(FD02)).length > 60, 'the footprint of a full disk is its limb');
});

test('visible tiles cover the view, nearest the centre first', () => {
    const g = pyramidFromWire(C02);
    const bounds = { west: -100, east: -94, south: 33, north: 37 };
    const tiles = viewportTiles(bounds, 1, g, 0);
    assert.ok(tiles.length > 0);
    const centre = lonLatToPixel(g, -97, 35);
    const span = 1024;
    assert.deepEqual(tiles[0], { level: 1, tx: Math.floor((centre.col + 0.5) / span), ty: Math.floor((centre.row + 0.5) / span) });
    for (const [lon, lat] of [[-100, 33], [-94, 37], [-100, 37], [-94, 33]]) {
        const p = lonLatToPixel(g, lon, lat);
        const key = { tx: Math.floor((p.col + 0.5) / span), ty: Math.floor((p.row + 0.5) / span) };
        assert.ok(tiles.some((t) => t.tx === key.tx && t.ty === key.ty), `corner ${lon},${lat} covered`);
    }
    assert.ok(viewportTiles(bounds, 1, g, 1).length > tiles.length, 'the ring adds tiles');
    assert.deepEqual(viewportTiles({ west: 10, east: 20, south: 40, north: 50 }, 0, pyramidFromWire(M1)), [], 'a view off the box wants nothing');
});

test('planDraws falls back to ancestors through the slot mesh and to descendants when zooming out', () => {
    const g = pyramidFromWire(C02);
    const ready = new Set(['2/3/2', '0/12/9', '0/13/9']);
    const isReady = (k) => ready.has(`${k.level}/${k.tx}/${k.ty}`);
    const draws = planDraws([{ level: 0, tx: 14, ty: 9 }, { level: 1, tx: 6, ty: 4 }, { level: 2, tx: 3, ty: 2 }], isReady, g, 6);
    const byslot = (l, x, y) => draws.filter((d) => d.slot.level === l && d.slot.tx === x && d.slot.ty === y);
    // Slot 0/14/9 is drawn from its level-2 ancestor 2/3/2.
    const [fromAncestor] = byslot(0, 14, 9);
    assert.deepEqual(fromAncestor.tile, { level: 2, tx: 3, ty: 2 });
    // Slot 1/6/4 is not ready and has no ready ancestor below level 2 except 2/3/2.
    assert.deepEqual(byslot(1, 6, 4)[0].tile, { level: 2, tx: 3, ty: 2 });
    assert.deepEqual(byslot(2, 3, 2)[0].map, { scale: 1, ox: 0, oy: 0 });

    // With no ancestor, a zoomed-out slot is drawn from its ready children.
    const down = planDraws([{ level: 1, tx: 6, ty: 4 }], isReady, g, 1);
    assert.deepEqual(down.map((d) => `${d.tile.level}/${d.tile.tx}/${d.tile.ty}`).sort(), ['0/12/9', '0/13/9']);
});

test('the ancestor map hits the same native pixel centre', () => {
    const slot = { level: 1, tx: 14, ty: 9 }, ancestor = { level: 4, tx: 1, ty: 1 };
    const m = ancestorMap(slot, ancestor);
    for (const i of [-0.5, 0, 17, 300.25, 511.5]) {
        const native = texelToPixel(slot.tx * 512 + i, slot.level);
        const viaAncestor = texelToPixel(ancestor.tx * 512 + i * m.scale + m.ox, ancestor.level);
        assert.ok(Math.abs(native - viaAncestor) < 1e-9, `texel ${i}`);
    }
});

test('footprints and the off-screen test', () => {
    const ring = gridFootprint(pyramidFromWire(M1));
    assert.ok(ring.length > 100);
    assert.deepEqual(ring[0], ring.at(-1));
    // The 12:01Z M1 box sits over the mid-Atlantic coast.
    const lons = ring.map((p) => p.lon), lats = ring.map((p) => p.lat);
    assert.ok(Math.min(...lons) > -85 && Math.max(...lons) < -66, `lon ${Math.min(...lons)}..${Math.max(...lons)}`);
    assert.ok(Math.min(...lats) > 30 && Math.max(...lats) < 48, `lat ${Math.min(...lats)}..${Math.max(...lats)}`);
    assert.equal(footprintIntersectsView(ring, { west: -128, east: -62, south: 16, north: 56 }), true, 'national view');
    assert.equal(footprintIntersectsView(ring, { west: -110, east: -88, south: 24, north: 40 }), false, 'Southern Plains view');
    assert.equal(footprintIntersectsView(ring, { west: -76, east: -74, south: 38, north: 39 }), true, 'a view inside the box');
    assert.equal(footprintIntersectsView([], { west: -76, east: -74, south: 38, north: 39 }), false);
});
