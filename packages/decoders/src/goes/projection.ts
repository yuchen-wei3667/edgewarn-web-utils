/**
 * Geostationary fixed-grid projection (GOES-R PUG 5.1.2.8), the pure half of the map geometry.
 * Tile pyramids and draw planning built on it live in `@edgewarn/web-utils/goes/feed`.
 */

/** Geometry of one image variable, as read from the file itself. */
export interface GoesGridSpec {
    /** Scan angle (radians) of pixel (0, 0)'s centre and the step between pixels; dy is negative (row 0 is north). */
    x0: number;
    y0: number;
    dx: number;
    dy: number;
    width: number;
    height: number;
    perspectivePointHeight: number;
    semiMajorAxis: number;
    semiMinorAxis: number;
    /** Sub-satellite longitude in degrees. */
    lon0: number;
}

/**
 * A band's pyramid grid: the geostationary fixed grid of its native pixels. Every source (the band's
 * own file, or MCMIP at a coarser step) maps onto it, so tiles, meshes and fallbacks are shared.
 * Pixel centres sit on integer (col, row); row 0 is north.
 */
export interface PyramidGrid {
    x0: number;
    y0: number;
    dx: number;
    dy: number;
    width: number;
    height: number;
    /** Distance from the earth's centre to the satellite, metres. */
    satDistance: number;
    req: number;
    rpol: number;
    lon0: number;
    /** Same id means same pixels on the same earth: tiles and meshes may be shared. */
    id: string;
}

export interface LonLat {
    lon: number;
    lat: number;
}

const DEG = Math.PI / 180;

/**
 * The pyramid grid from a source's grid. MCMIP sits `shift` levels above the band (2^shift native
 * pixels per MCMIP pixel, centred on the block), so its native grid is rebuilt from the block centres.
 */
export function pyramidFromWire(g: GoesGridSpec, shift = 0): PyramidGrid {
    const s = 2 ** shift;
    const dx = g.dx / s,
        dy = g.dy / s;
    const x0 = g.x0 - ((s - 1) / 2) * dx,
        y0 = g.y0 - ((s - 1) / 2) * dy;
    const width = g.width * s,
        height = g.height * s;
    const satDistance = g.perspectivePointHeight + g.semiMajorAxis;
    // The fixed grid is global, so pixel offsets from the sub-satellite point identify the box. Centres
    // sit half a pixel off it, so count in half pixels to stay clear of rounding at .5.
    const id = [
        Math.round((2 * x0) / dx),
        Math.round((2 * y0) / dy),
        width,
        height,
        Math.round(dx * 1e10),
        g.lon0,
    ].join(':');
    return { x0, y0, dx, dy, width, height, satDistance, req: g.semiMajorAxis, rpol: g.semiMinorAxis, lon0: g.lon0, id };
}

/** GOES-R PUG 5.1.2.8.1: scan angles to geodetic lat/lon, or null when the line of sight misses the earth. */
export function scanToLonLat(g: PyramidGrid, x: number, y: number): LonLat | null {
    const H = g.satDistance,
        req2 = g.req * g.req,
        rpol2 = g.rpol * g.rpol;
    const sx = Math.sin(x),
        cx = Math.cos(x),
        sy = Math.sin(y),
        cy = Math.cos(y);
    const a = sx * sx + cx * cx * (cy * cy + (req2 / rpol2) * sy * sy);
    const b = -2 * H * cx * cy;
    const c = H * H - req2;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const rs = (-b - Math.sqrt(disc)) / (2 * a);
    const px = rs * cx * cy,
        py = -rs * sx,
        pz = rs * cx * sy;
    const lat = Math.atan((req2 / rpol2) * (pz / Math.sqrt((H - px) * (H - px) + py * py))) / DEG;
    const lon = g.lon0 - Math.atan(py / (H - px)) / DEG;
    return { lon, lat };
}

/** GOES-R PUG 5.1.2.8.2: geodetic lat/lon to scan angles, or null when the point is not visible. */
export function lonLatToScan(g: PyramidGrid, lon: number, lat: number): { x: number; y: number } | null {
    const H = g.satDistance,
        req2 = g.req * g.req,
        rpol2 = g.rpol * g.rpol;
    const phic = Math.atan((rpol2 / req2) * Math.tan(lat * DEG));
    const e2 = (req2 - rpol2) / req2;
    const cphic = Math.cos(phic);
    const rc = g.rpol / Math.sqrt(1 - e2 * cphic * cphic);
    const dl = (lon - g.lon0) * DEG;
    const sx = H - rc * cphic * Math.cos(dl);
    const sy = -rc * cphic * Math.sin(dl);
    const sz = rc * Math.sin(phic);
    if (H * (H - sx) < sy * sy + (req2 / rpol2) * sz * sz) return null; // behind the limb
    return { x: Math.asin(-sy / Math.sqrt(sx * sx + sy * sy + sz * sz)), y: Math.atan(sz / sx) };
}

export function pixelToLonLat(g: PyramidGrid, col: number, row: number): LonLat | null {
    return scanToLonLat(g, g.x0 + col * g.dx, g.y0 + row * g.dy);
}

export function lonLatToPixel(g: PyramidGrid, lon: number, lat: number): { col: number; row: number } | null {
    const s = lonLatToScan(g, lon, lat);
    return s ? { col: (s.x - g.x0) / g.dx, row: (s.y - g.y0) / g.dy } : null;
}

/** Satellite zenith angle (degrees) seen from a point on the ellipsoid. */
export function zenithDeg(g: PyramidGrid, lon: number, lat: number): number {
    const phi = lat * DEG,
        dl = (lon - g.lon0) * DEG;
    const req2 = g.req * g.req,
        rpol2 = g.rpol * g.rpol;
    const phic = Math.atan((rpol2 / req2) * Math.tan(phi));
    const rc = g.rpol / Math.sqrt(1 - ((req2 - rpol2) / req2) * Math.cos(phic) ** 2);
    const p = [rc * Math.cos(phic) * Math.cos(dl), rc * Math.cos(phic) * Math.sin(dl), rc * Math.sin(phic)];
    const n = [Math.cos(phi) * Math.cos(dl), Math.cos(phi) * Math.sin(dl), Math.sin(phi)];
    const v = [g.satDistance - p[0], -p[1], -p[2]];
    const len = Math.hypot(v[0], v[1], v[2]);
    return (
        Math.acos(Math.max(-1, Math.min(1, (n[0] * v[0] + n[1] * v[1] + n[2] * v[2]) / len))) / DEG
    );
}
