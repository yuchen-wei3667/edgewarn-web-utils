import type { ModelGrid } from '@edgewarn/web-utils/grib2';
import { lambertGridProjection } from './lambert.ts';
import { latLonGridProjection } from './latlon.ts';
import { mercatorGridProjection } from './mercator.ts';
import { polarStereoGridProjection } from './polarStereo.ts';
import type { GridProjection } from './types.ts';

export type { GridProjection } from './types.ts';

/** A grid cell as a profile's identity: its indices in scan order and its centre. */
export interface SnappedCell {
    i: number;
    j: number;
    lat: number;
    lon: number;
}

/**
 * The cell whose centre is nearest a point, or null when the point is off the grid. Every key, link and comparison of a
 * profile uses this cell, so two clicks in one cell share a cache entry (phase 5 plan, ADR-P5-11).
 */
export function snapToCell(projection: GridProjection, lat: number, lon: number): SnappedCell | null {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const [fi, fj] = projection.forward(lat, lon);
    const i = Math.round(fi);
    const j = Math.round(fj);
    if (!(i >= 0 && i < projection.nx && j >= 0 && j < projection.ny)) return null;
    const [cellLat, cellLon] = projection.inverse(i, j);
    return { i, j, lat: cellLat, lon: cellLon };
}

/** The projection of a grid. Callers keep the result: building one precomputes the projection's constants. */
export function projectionFor(grid: ModelGrid): GridProjection {
    switch (grid.projection) {
        case 'lambert':
            return lambertGridProjection(grid);
        case 'latlon':
            return latLonGridProjection(grid);
        case 'polarStereo':
            return polarStereoGridProjection(grid);
        case 'mercator':
            return mercatorGridProjection(grid);
        default:
            throw new Error(`No projection for grid ${(grid as { projection?: string }).projection}`);
    }
}
