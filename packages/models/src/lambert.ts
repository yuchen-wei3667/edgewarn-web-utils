import type { LambertModelGrid } from '@edgewarn/web-utils/grib2';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/**
 * Precomputed Lambert conformal constants for one grid. Grid space: i runs west->east and j runs
 * south->north from the first grid point, in cells; cell centres sit on integers.
 */
export interface LambertProjection {
    /** Cone constant. */
    n: number;
    /** R * F, so rho(phi) = rF / tan(pi/4 + phi/2)^n. */
    rF: number;
    /** Central meridian, degrees in [-180, 180). */
    lov: number;
    /** Projected metres of grid point (0, 0). */
    x0: number;
    y0: number;
    dx: number;
    dy: number;
    nx: number;
    ny: number;
}

const wrapLon = (lon: number): number => ((((lon + 180) % 360) + 360) % 360) - 180;

/** The earth radius comes from the grid (the message declares it); a grid built elsewhere passes it explicitly. */
export function lambertProjection(grid: LambertModelGrid, radius = grid.radiusM): LambertProjection {
    if (radius === undefined)
        throw new Error('lambertProjection needs the earth radius: the grid has none and none was passed');
    const p1 = grid.latin1 * D2R;
    const p2 = grid.latin2 * D2R;
    const t = (phi: number) => Math.tan(Math.PI / 4 + phi / 2);
    const n =
        Math.abs(p1 - p2) < 1e-10
            ? Math.sin(p1)
            : Math.log(Math.cos(p1) / Math.cos(p2)) / Math.log(t(p2) / t(p1));
    const rF = (radius * Math.cos(p1) * t(p1) ** n) / n;
    const lov = wrapLon(grid.lov);
    const base: LambertProjection = {
        n,
        rF,
        lov,
        x0: 0,
        y0: 0,
        dx: grid.dx,
        dy: grid.dy,
        nx: grid.nx,
        ny: grid.ny,
    };
    const [x0, y0] = projectMetres(base, grid.lat1, grid.lon1);
    return { ...base, x0, y0 };
}

function projectMetres(p: LambertProjection, lat: number, lon: number): [number, number] {
    const rho = p.rF / Math.tan(Math.PI / 4 + (lat * D2R) / 2) ** p.n;
    const theta = p.n * wrapLon(lon - p.lov) * D2R;
    return [rho * Math.sin(theta), -rho * Math.cos(theta)];
}

/** lat/lon (degrees) -> fractional grid (i, j). */
export function lambertForward(p: LambertProjection, lat: number, lon: number): [number, number] {
    const [x, y] = projectMetres(p, lat, lon);
    return [(x - p.x0) / p.dx, (y - p.y0) / p.dy];
}

/** Fractional grid (i, j) -> [lat, lon] in degrees, lon in [-180, 180). */
export function lambertInverse(p: LambertProjection, i: number, j: number): [number, number] {
    const x = p.x0 + i * p.dx;
    const y = p.y0 + j * p.dy;
    const rho = Math.sign(p.n) * Math.hypot(x, y);
    const theta = p.n > 0 ? Math.atan2(x, -y) : Math.atan2(-x, y);
    const lat = 2 * Math.atan((p.rF / rho) ** (1 / p.n)) - Math.PI / 2;
    return [lat * R2D, wrapLon(p.lov + (theta / p.n) * R2D)];
}

/** Grid rotation at a longitude, radians: the grid's +i axis points this far clockwise of east. */
export function gridRotation(p: LambertProjection, lon: number): number {
    return p.n * wrapLon(lon - p.lov) * D2R;
}

/**
 * Conservative lng/lat bounds of a rectangle of grid cells [i0, i1] x [j0, j1] (inclusive, fractional),
 * found by walking its edges every `stepCells` cells. Returns [west, south, east, north].
 */
export function gridRectLngLatBounds(
    p: LambertProjection,
    i0: number,
    j0: number,
    i1: number,
    j1: number,
    stepCells = 16,
): [number, number, number, number] {
    let w = Infinity,
        s = Infinity,
        e = -Infinity,
        n = -Infinity;
    const visit = (i: number, j: number) => {
        const [lat, lon] = lambertInverse(p, i, j);
        if (lon < w) w = lon;
        if (lon > e) e = lon;
        if (lat < s) s = lat;
        if (lat > n) n = lat;
    };
    const steps = (a: number, b: number) => Math.max(1, Math.ceil((b - a) / stepCells));
    const ni = steps(i0, i1);
    const nj = steps(j0, j1);
    for (let k = 0; k <= ni; k++) {
        const i = i0 + ((i1 - i0) * k) / ni;
        visit(i, j0);
        visit(i, j1);
    }
    for (let k = 0; k <= nj; k++) {
        const j = j0 + ((j1 - j0) * k) / nj;
        visit(i0, j);
        visit(i1, j);
    }
    return [w, s, e, n];
}

/**
 * GLSL (ES 3.00) forward projection, for the fragment shader. Expects uniforms
 * `u_projA` = (n, rF, lovRad, unused) and `u_projB` = (x0, y0, dx, dy) (declared by `modelsShader.ts`,
 * which also holds the lat/lon one) and returns grid (i, j).
 * float32 is enough: rho is 6e6 to 2e7 m, so one ulp is 0.5 to 2 m, far below a cell of 2.5 or 3 km
 * (`tests/models/models-lambert.test.mjs` runs this arithmetic with float32 rounding on both grids).
 */
export const LAMBERT_GLSL = /* glsl */ `
const float LCC_PI = 3.14159265358979;
vec2 lccForward(vec2 lngLatDeg) {
    float lat = radians(lngLatDeg.y);
    float dlon = radians(lngLatDeg.x) - u_projA.z;
    dlon = dlon - 2.0 * LCC_PI * floor((dlon + LCC_PI) / (2.0 * LCC_PI));
    float rho = u_projA.y / pow(tan(LCC_PI / 4.0 + lat / 2.0), u_projA.x);
    float theta = u_projA.x * dlon;
    vec2 xy = vec2(rho * sin(theta), -rho * cos(theta));
    return (xy - u_projB.xy) / u_projB.zw;
}
`;
