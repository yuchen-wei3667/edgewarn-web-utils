import type { GridProjection } from './types.ts';

type Box = readonly [number, number, number, number];

const wrap180 = (lon: number): number => ((((lon + 180) % 360) + 360) % 360) - 180;
/** Sampled boundaries sit between samples by a sagitta far under this, degrees, so the box is padded by it. */
const SAMPLE_PAD_DEG = 0.02;

/**
 * Conservative lng/lat boxes of the cell rectangle [i0, i1] x [j0, j1] for a projection whose cells map to smooth
 * curves: the rectangle's edges are walked every `stepCells` cells, and a rectangle that holds the pole is
 * every longitude. A set of longitudes that straddles the antimeridian becomes two boxes, each inside [-180, 180].
 */
export function sampledRectBounds(
    inverse: GridProjection['inverse'],
    forward: GridProjection['forward'],
    i0: number,
    j0: number,
    i1: number,
    j1: number,
    stepCells = 4,
): Box[] {
    const lats: number[] = [];
    const lons: number[] = [];
    const add = (i: number, j: number) => {
        const [lat, lon] = inverse(i, j);
        lats.push(lat);
        lons.push(wrap180(lon));
    };
    for (let i = i0; i < i1; i += stepCells) {
        add(i, j0);
        add(i, j1);
    }
    for (let j = j0; j < j1; j += stepCells) {
        add(i0, j);
        add(i1, j);
    }
    add(i1, j0);
    add(i1, j1);
    add(i0, j1);
    const south = Math.max(-90, Math.min(...lats) - SAMPLE_PAD_DEG);
    const [pi, pj] = forward(90, 0);
    if (pi >= i0 && pi <= i1 && pj >= j0 && pj <= j1) return [[-180, south, 180, 90]];
    const north = Math.min(90, Math.max(...lats) + SAMPLE_PAD_DEG);
    const direct = lons;
    const shifted = lons.map((lon) => (lon < 0 ? lon + 360 : lon));
    const span = (values: number[]) => Math.max(...values) - Math.min(...values);
    if (span(direct) <= span(shifted)) {
        return [
            [
                Math.max(-180, Math.min(...direct) - SAMPLE_PAD_DEG),
                south,
                Math.min(180, Math.max(...direct) + SAMPLE_PAD_DEG),
                north,
            ],
        ];
    }
    const west = Math.min(...shifted) - SAMPLE_PAD_DEG;
    const east = Math.max(...shifted) + SAMPLE_PAD_DEG - 360;
    return [
        [west, south, 180, north],
        [-180, south, east, north],
    ];
}
