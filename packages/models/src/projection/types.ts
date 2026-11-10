/**
 * How a model's grid sits on the globe. Grids keep the order the file stores them in (`i` along a row, `j`
 * down the rows in scan order), and a projection maps between that and lat/lon, so the decoder, the
 * tile pipeline, the winds, the isobars and the shader never name a projection.
 */
export interface GridProjection {
    readonly kind: 'lambert' | 'latlon' | 'polarStereo' | 'mercator';
    readonly nx: number;
    readonly ny: number;
    /** Everything that shapes the mapping, for caches: two grids sharing a size can differ in the rest. */
    readonly key: string;
    /** lat/lon (degrees) to fractional cell (i, j) in scan order; cell centres sit on integers. Finite for points off the grid too, so a caller tests the range. */
    forward(lat: number, lon: number): [number, number];
    /** Fractional cell (i, j) to [lat, lon], lon in [-180, 180). */
    inverse(i: number, j: number): [number, number];
    /** How far the grid's +i axis points clockwise of east at a point, radians; 0 where the grid follows parallels. */
    rotation(lat: number, lon: number): number;
    /** Metres between neighbouring cells along a row, at a latitude. */
    cellMetres(lat: number): number;
    /**
     * Conservative lng/lat boxes [west, south, east, north] holding the cell rectangle [i0, i1] x [j0, j1]
     * (inclusive, fractional). More than one when the rectangle crosses the antimeridian, because a mercator
     * quad cannot span it; each box then lies inside [-180, 180].
     */
    rectBounds(
        i0: number,
        j0: number,
        i1: number,
        j1: number,
    ): ReadonlyArray<readonly [number, number, number, number]>;
    /** Values for the shader's `u_projKind`, `u_projA`, `u_projB` (see `modelsShader.ts`). */
    uniforms(): ProjectionUniforms;
}

export interface ProjectionUniforms {
    /** 0 Lambert conformal, 1 regular lat/lon, 2 polar stereographic, 3 Mercator, 4 rotated lat/lon. */
    kind: 0 | 1 | 2 | 3 | 4;
    a: readonly [number, number, number, number];
    b: readonly [number, number, number, number];
}
