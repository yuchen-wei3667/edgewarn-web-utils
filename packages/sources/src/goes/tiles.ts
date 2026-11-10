import { distanceMeters } from '@edgewarn/web-utils/geo';
import { lonLatToPixel, pixelToLonLat, scanToLonLat, zenithDeg } from '@edgewarn/web-utils/goes';
import type { LonLat, PyramidGrid } from '@edgewarn/web-utils/goes';
import { GOES_MAX_ZENITH_DEG, GOES_MESH_CELL, GOES_TILE_SIZE } from './config.ts';

/**
 * Tile pyramid and draw planning over the geostationary projection in `@edgewarn/web-utils/goes`.
 * Pixel centres sit on integer (col, row); row 0 is north.
 */

/** A tile of a file's own pyramid: level L holds one texel per 2^L x 2^L pixels of that file. */
export interface GoesTileKey {
    level: number;
    tx: number;
    ty: number;
}

export interface LonLatBounds {
    west: number;
    south: number;
    east: number;
    north: number;
}
interface ColRow {
    col: number;
    row: number;
}

/** Map a slot's texel coordinates onto the texture actually drawn there: tc' = tc * scale + offset. */
export interface TexMap {
    scale: number;
    ox: number;
    oy: number;
}
export interface GoesDraw {
    slot: GoesTileKey;
    tile: GoesTileKey;
    map: TexMap;
}

const DEG = Math.PI / 180;
const IDENTITY: TexMap = { scale: 1, ox: 0, oy: 0 };

export const mercatorX = (lon: number): number => (lon + 180) / 360;
export const mercatorY = (lat: number): number => 0.5 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / (2 * Math.PI);

// --- Pyramid -------------------------------------------------------------------------------

const levelSize = (g: PyramidGrid, level: number): { w: number; h: number } => ({
    w: Math.ceil(g.width / 2 ** level), h: Math.ceil(g.height / 2 ** level),
});

export function tileCounts(g: PyramidGrid, level: number, T = GOES_TILE_SIZE): { cols: number; rows: number } {
    const { w, h } = levelSize(g, level);
    return { cols: Math.ceil(w / T), rows: Math.ceil(h / T) };
}

/** Native pixel coordinate of a level's texel coordinate (texel i has its centre at i). */
export const texelToPixel = (t: number, level: number): number => t * 2 ** level + (2 ** level - 1) / 2;
export const pixelToTexel = (p: number, level: number): number => (p - (2 ** level - 1) / 2) / 2 ** level;

const EARTH_CIRCUMFERENCE = 2 * Math.PI * 6378137;

const haversine = (a: LonLat, b: LonLat): number => distanceMeters(a.lat, a.lon, b.lat, b.lon);

/**
 * Ground size (metres) of one native pixel at a pixel position: the geometric mean of the projection's
 * local column and row steps, so the view angle is accounted for.
 */
function nativePixelMeters(g: PyramidGrid, col: number, row: number): number | null {
    const c = pixelToLonLat(g, col, row), e = pixelToLonLat(g, col + 1, row), s = pixelToLonLat(g, col, row + 1);
    if (!c || !e || !s) return null;
    return Math.sqrt(haversine(c, e) * haversine(c, s));
}

/** First on-earth point of a 9 x 9 lattice over the bounds, nearest the centre (for off-disk centres). */
function anchorPixel(g: PyramidGrid, bounds: LonLatBounds): ColRow | null {
    const cx = (bounds.west + bounds.east) / 2, cy = (bounds.south + bounds.north) / 2;
    const centre = lonLatToPixel(g, cx, cy);
    if (centre && inGrid(g, centre)) return centre;
    let best: ColRow | null = null, bestD = Infinity;
    for (const p of lattice(bounds)) {
        const px = lonLatToPixel(g, p.lon, p.lat);
        if (!px || !inGrid(g, px)) continue;
        const d = (p.lon - cx) ** 2 + (p.lat - cy) ** 2;
        if (d < bestD) { bestD = d; best = px; }
    }
    return best ?? (centre ? clampToGrid(g, centre) : null);
}

const inGrid = (g: PyramidGrid, p: ColRow) => p.col >= -0.5 && p.col <= g.width - 0.5 && p.row >= -0.5 && p.row <= g.height - 0.5;
const clampToGrid = (g: PyramidGrid, p: ColRow): ColRow => ({
    col: Math.max(0, Math.min(g.width - 1, p.col)), row: Math.max(0, Math.min(g.height - 1, p.row)),
});

function lattice(bounds: LonLatBounds, n = 9): LonLat[] {
    const out: LonLat[] = [];
    for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
            out.push({ lon: bounds.west + ((bounds.east - bounds.west) * i) / (n - 1), lat: bounds.south + ((bounds.north - bounds.south) * j) / (n - 1) });
        }
    }
    return out;
}

/**
 * Level of detail: the smallest level whose texel is at least one CSS pixel (one device pixel when
 * `crisp`) at the view centre, from the projection's local scale rather than a constant. `previous`
 * adds hysteresis; `bias` asks for coarser levels (playback). Null when the view sees no part of the disk.
 */
export function levelForView(
    zoom: number, bounds: LonLatBounds, g: PyramidGrid, top: number,
    options: { devicePixelRatio?: number; crisp?: boolean; previous?: number | null; bias?: number; hysteresis?: number } = {},
): number | null {
    const anchor = anchorPixel(g, bounds);
    if (!anchor) return null;
    const meters = nativePixelMeters(g, anchor.col, anchor.row);
    const where = pixelToLonLat(g, anchor.col, anchor.row);
    if (!meters || !where) return null;
    const dpr = options.crisp ? (options.devicePixelRatio ?? 1) : 1;
    const screenPx = (EARTH_CIRCUMFERENCE * Math.cos(where.lat * DEG)) / (512 * 2 ** zoom) / dpr;
    const ideal = Math.log2(screenPx / meters) + (options.bias ?? 0);
    const hysteresis = options.hysteresis ?? 0.25;
    const clamp = (level: number) => Math.max(0, Math.min(top, level));
    const prev = options.previous;
    if (prev !== null && prev !== undefined && ideal > prev - 1 - hysteresis && ideal <= prev + hysteresis) return clamp(prev);
    return clamp(Math.ceil(ideal));
}

/**
 * True when a tile lies wholly in space (or past the zenith clip). The visible disk is convex in scan
 * angle, so if the tile's point nearest the sub-satellite point is off it, the whole tile is. Only the
 * corners of a full-disk grid qualify (about a fifth of its tiles); sector grids sit on the earth.
 */
export function tileOffDisk(g: PyramidGrid, key: GoesTileKey, T = GOES_TILE_SIZE, maxZenith = GOES_MAX_ZENITH_DEG): boolean {
    const span = T * 2 ** key.level;
    const x0 = g.x0 + (key.tx * span - 0.5) * g.dx, x1 = g.x0 + ((key.tx + 1) * span - 0.5) * g.dx;
    const y0 = g.y0 + (key.ty * span - 0.5) * g.dy, y1 = g.y0 + ((key.ty + 1) * span - 0.5) * g.dy;
    const x = Math.max(Math.min(x0, x1), Math.min(0, Math.max(x0, x1)));
    const y = Math.max(Math.min(y0, y1), Math.min(0, Math.max(y0, y1)));
    const ll = scanToLonLat(g, x, y);
    return !ll || zenithDeg(g, ll.lon, ll.lat) > maxZenith;
}

/**
 * Tiles at `level` touching the viewport plus a ring of `pad`, nearest the view centre first. The
 * viewport is sampled on a 9 x 9 lattice and inverse-projected, so curved footprints are covered.
 */
export function viewportTiles(bounds: LonLatBounds, level: number, g: PyramidGrid, pad = 1, T = GOES_TILE_SIZE): GoesTileKey[] {
    let c0 = Infinity, c1 = -Infinity, r0 = Infinity, r1 = -Infinity;
    for (const p of lattice(bounds)) {
        const px = lonLatToPixel(g, p.lon, p.lat);
        if (!px) continue;
        c0 = Math.min(c0, px.col); c1 = Math.max(c1, px.col);
        r0 = Math.min(r0, px.row); r1 = Math.max(r1, px.row);
    }
    if (!Number.isFinite(c0)) return [];
    if (c1 < -0.5 || r1 < -0.5 || c0 > g.width - 0.5 || r0 > g.height - 0.5) return [];
    const span = T * 2 ** level;
    const { cols, rows } = tileCounts(g, level, T);
    const tx0 = Math.max(0, Math.floor((c0 + 0.5) / span) - pad), tx1 = Math.min(cols - 1, Math.floor((c1 + 0.5) / span) + pad);
    const ty0 = Math.max(0, Math.floor((r0 + 0.5) / span) - pad), ty1 = Math.min(rows - 1, Math.floor((r1 + 0.5) / span) + pad);
    const centre = lonLatToPixel(g, (bounds.west + bounds.east) / 2, (bounds.south + bounds.north) / 2);
    const cx = centre ? (centre.col + 0.5) / span : (c0 + c1 + 1) / 2 / span;
    const cy = centre ? (centre.row + 0.5) / span : (r0 + r1 + 1) / 2 / span;
    const out: Array<{ key: GoesTileKey; d: number }> = [];
    for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
            if (tileOffDisk(g, { level, tx, ty }, T)) continue;
            out.push({ key: { level, tx, ty }, d: (tx + 0.5 - cx) ** 2 + (ty + 0.5 - cy) ** 2 });
        }
    }
    return out.sort((a, b) => a.d - b.d).map((o) => o.key);
}

/** The grid's outline as a lon/lat ring (closed), skipping edge points that are off-earth or past the zenith clip. */
export function gridFootprint(g: PyramidGrid, samplesPerEdge = 32, maxZenith = GOES_MAX_ZENITH_DEG): LonLat[] {
    const W = g.width - 0.5, H = g.height - 0.5;
    const edge: ColRow[] = [];
    for (let i = 0; i < samplesPerEdge; i++) edge.push({ col: -0.5 + ((W + 0.5) * i) / samplesPerEdge, row: -0.5 });
    for (let i = 0; i < samplesPerEdge; i++) edge.push({ col: W, row: -0.5 + ((H + 0.5) * i) / samplesPerEdge });
    for (let i = 0; i < samplesPerEdge; i++) edge.push({ col: W - ((W + 0.5) * i) / samplesPerEdge, row: H });
    for (let i = 0; i < samplesPerEdge; i++) edge.push({ col: -0.5, row: H - ((H + 0.5) * i) / samplesPerEdge });
    const ring: LonLat[] = [];
    for (const p of edge) {
        const ll = pixelToLonLat(g, p.col, p.row);
        if (ll && zenithDeg(g, ll.lon, ll.lat) <= maxZenith) ring.push(ll);
    }
    if (ring.length < 3) return limbFootprint(g, samplesPerEdge * 2, maxZenith);
    ring.push(ring[0]);
    return ring;
}

/**
 * A full-disk grid's edge is in space, so its outline is the visible limb: for each bearing from the
 * sub-satellite point, the farthest scan radius that still sees the earth within the zenith clip.
 */
function limbFootprint(g: PyramidGrid, count: number, maxZenith: number): LonLat[] {
    const reach = Math.min(Math.abs(g.x0), Math.abs(g.y0), Math.abs(g.x0 + (g.width - 1) * g.dx), Math.abs(g.y0 + (g.height - 1) * g.dy));
    const ring: LonLat[] = [];
    for (let i = 0; i < count; i++) {
        const a = (2 * Math.PI * i) / count;
        const at = (r: number) => {
            const ll = scanToLonLat(g, r * Math.cos(a), r * Math.sin(a));
            return ll && zenithDeg(g, ll.lon, ll.lat) <= maxZenith ? ll : null;
        };
        let lo = 0, hi = reach, best = at(0);
        for (let k = 0; k < 40; k++) {
            const mid = (lo + hi) / 2, ll = at(mid);
            if (ll) { lo = mid; best = ll; } else hi = mid;
        }
        if (best) ring.push(best);
    }
    if (ring.length > 0) ring.push(ring[0]);
    return ring;
}

/** Mesh cell (texels) per level: 8 at levels 0-2, 4 at 3-4, 2 at 5-6, keeping cells <= 128 native pixels. */
export const meshCellForLevel = (level: number, base = GOES_MESH_CELL): number => Math.max(1, base >> Math.max(0, Math.floor((level - 1) / 2)));

interface TileMesh {
    /** Interleaved (mercX, mercY, tcX, tcY) per vertex, float32. */
    vertices: Float32Array;
    /** Two triangles per kept cell; 32-bit when the vertex lattice exceeds 65,536 vertices. */
    indices: Uint16Array | Uint32Array;
}

/**
 * Warp mesh for one tile: vertices every `meshCellForLevel` texels on texel edges (including the tile's outer
 * edge), forward-projected in float64 and stored as normalised mercator. Neighbouring tiles compute
 * shared-edge vertices from the same integer pixel positions, so they match bit for bit and no cracks
 * appear. Cells with any vertex off-earth or past the zenith clip are dropped.
 */
export function buildMesh(g: PyramidGrid, key: GoesTileKey, options: { cell?: number; T?: number; maxZenith?: number } = {}): TileMesh {
    const cell = options.cell ?? meshCellForLevel(key.level), T = options.T ?? GOES_TILE_SIZE, maxZenith = options.maxZenith ?? GOES_MAX_ZENITH_DEG;
    const s = 2 ** key.level;
    const { w, h } = levelSize(g, key.level);
    const uMax = Math.min(T, w - key.tx * T), vMax = Math.min(T, h - key.ty * T);
    if (uMax <= 0 || vMax <= 0) return { vertices: new Float32Array(0), indices: new Uint16Array(0) };
    const us: number[] = [], vs: number[] = [];
    for (let u = 0; u < uMax; u += cell) us.push(u);
    us.push(uMax);
    for (let v = 0; v < vMax; v += cell) vs.push(v);
    vs.push(vMax);
    const nx = us.length, ny = vs.length;
    const vertices = new Float32Array(nx * ny * 4);
    const valid = new Uint8Array(nx * ny);
    for (let j = 0; j < ny; j++) {
        // Texel edge -> native pixel edge, clipped to the grid's own edge.
        const row = Math.min((key.ty * T + vs[j]) * s - 0.5, g.height - 0.5);
        for (let i = 0; i < nx; i++) {
            const col = Math.min((key.tx * T + us[i]) * s - 0.5, g.width - 0.5);
            const ll = pixelToLonLat(g, col, row);
            const k = j * nx + i;
            if (!ll || zenithDeg(g, ll.lon, ll.lat) > maxZenith) continue;
            valid[k] = 1;
            vertices[k * 4] = mercatorX(ll.lon);
            vertices[k * 4 + 1] = mercatorY(ll.lat);
            // The halo makes texel i sit at texture column i + 1; the shader adds that, so tc is interior-relative.
            vertices[k * 4 + 2] = pixelToTexel(col, key.level) - key.tx * T;
            vertices[k * 4 + 3] = pixelToTexel(row, key.level) - key.ty * T;
        }
    }
    const idx: number[] = [];
    for (let j = 0; j + 1 < ny; j++) {
        for (let i = 0; i + 1 < nx; i++) {
            const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
            if (valid[a] && valid[b] && valid[c] && valid[d]) idx.push(a, b, d, a, d, c);
        }
    }
    return { vertices, indices: nx * ny > 65536 ? Uint32Array.from(idx) : Uint16Array.from(idx) };
}

/** Texel-coordinate map that samples `ancestor` (k levels up) across `slot`'s mesh. */
export function ancestorMap(slot: GoesTileKey, ancestor: GoesTileKey, T = GOES_TILE_SIZE): TexMap {
    const k = ancestor.level - slot.level, f = 2 ** -k;
    return {
        scale: f,
        ox: slot.tx * T * f - ancestor.tx * T + (f - 1) / 2,
        oy: slot.ty * T * f - ancestor.ty * T + (f - 1) / 2,
    };
}

/**
 * What draws each wanted slot, without overlaps: the slot's own tile when ready, else the nearest
 * ready ancestor drawn through the slot's mesh (zooming in), else its ready descendants (zooming out).
 * Both sources of a band share one pyramid, so fallbacks also work across the MCMIP switch.
 */
export function planDraws(wanted: GoesTileKey[], isReady: (key: GoesTileKey) => boolean, g: PyramidGrid, top: number, T = GOES_TILE_SIZE): GoesDraw[] {
    const draws: GoesDraw[] = [];
    const exists = (key: GoesTileKey) => {
        const { cols, rows } = tileCounts(g, key.level, T);
        return key.tx < cols && key.ty < rows;
    };
    const descend = (key: GoesTileKey) => {
        if (key.level === 0) return;
        for (let dy = 0; dy < 2; dy++) {
            for (let dx = 0; dx < 2; dx++) {
                const child: GoesTileKey = { level: key.level - 1, tx: key.tx * 2 + dx, ty: key.ty * 2 + dy };
                if (!exists(child)) continue;
                if (isReady(child)) draws.push({ slot: child, tile: child, map: IDENTITY });
                else descend(child);
            }
        }
    };
    for (const slot of wanted) {
        if (!exists(slot)) continue;
        if (isReady(slot)) { draws.push({ slot, tile: slot, map: IDENTITY }); continue; }
        let covered = false;
        for (let k = 1; slot.level + k <= top; k++) {
            const ancestor: GoesTileKey = { level: slot.level + k, tx: slot.tx >> k, ty: slot.ty >> k };
            if (isReady(ancestor)) { draws.push({ slot, tile: ancestor, map: ancestorMap(slot, ancestor, T) }); covered = true; break; }
        }
        if (!covered) descend(slot);
    }
    return draws;
}

/** True when a footprint ring and the view bounds overlap (box test, then a point-in-ring test). */
export function footprintIntersectsView(ring: readonly LonLat[], view: LonLatBounds): boolean {
    if (ring.length < 3) return false;
    let w = Infinity, e = -Infinity, s = Infinity, n = -Infinity;
    for (const p of ring) { w = Math.min(w, p.lon); e = Math.max(e, p.lon); s = Math.min(s, p.lat); n = Math.max(n, p.lat); }
    if (e < view.west || w > view.east || n < view.south || s > view.north) return false;
    // Any ring vertex inside the view, or the view centre inside the ring.
    if (ring.some((p) => p.lon >= view.west && p.lon <= view.east && p.lat >= view.south && p.lat <= view.north)) return true;
    const cx = (view.west + view.east) / 2, cy = (view.south + view.north) / 2;
    if (pointInRing(ring, cx, cy)) return true;
    // Edges crossing the view rectangle (a thin box crossing a large view).
    const corners: LonLat[] = [
        { lon: view.west, lat: view.south }, { lon: view.east, lat: view.south },
        { lon: view.east, lat: view.north }, { lon: view.west, lat: view.north },
    ];
    for (let i = 0; i + 1 < ring.length; i++) {
        for (let k = 0; k < 4; k++) if (segmentsCross(ring[i], ring[i + 1], corners[k], corners[(k + 1) % 4])) return true;
    }
    return false;
}

function pointInRing(ring: readonly LonLat[], lon: number, lat: number): boolean {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i], b = ring[j];
        if ((a.lat > lat) !== (b.lat > lat) && lon < ((b.lon - a.lon) * (lat - a.lat)) / (b.lat - a.lat) + a.lon) inside = !inside;
    }
    return inside;
}

function segmentsCross(p1: LonLat, p2: LonLat, q1: LonLat, q2: LonLat): boolean {
    const cross = (a: LonLat, b: LonLat, c: LonLat) => (b.lon - a.lon) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lon - a.lon);
    const d1 = cross(q1, q2, p1), d2 = cross(q1, q2, p2), d3 = cross(p1, p2, q1), d4 = cross(p1, p2, q2);
    return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Bounding box of a ring, for fitting the camera. */
export function ringBounds(ring: readonly LonLat[]): LonLatBounds | null {
    if (ring.length === 0) return null;
    let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
    for (const p of ring) { west = Math.min(west, p.lon); east = Math.max(east, p.lon); south = Math.min(south, p.lat); north = Math.max(north, p.lat); }
    return { west, south, east, north };
}

/** Centroid of a ring's vertices (good enough for a near-rectangular sector box). */
export function ringCentre(ring: readonly LonLat[]): LonLat | null {
    const pts = ring.length > 1 && ring[0] === ring[ring.length - 1] ? ring.slice(0, -1) : ring;
    if (pts.length === 0) return null;
    return { lon: pts.reduce((a, p) => a + p.lon, 0) / pts.length, lat: pts.reduce((a, p) => a + p.lat, 0) / pts.length };
}
