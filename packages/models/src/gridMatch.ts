import type { ModelGrid } from '@edgewarn/web-utils/grib2';

/** Messages carry micro-degree integers and millimetre spacings; a config is typed by hand to the same digits. NBM's own files differ by 64e-6 degrees in the central meridian from one message to the next (265 and 264.999936), far below a cell. */
const ANGLE_TOLERANCE_DEG = 1e-4;
const SPACING_TOLERANCE_M = 0.01;
const RADIUS_TOLERANCE_M = 1;

/** The grid as one line, for an error message a person can compare against the config. */
export function describeGrid(g: ModelGrid): string {
    const radius = g.radiusM === undefined ? '' : `, radius ${g.radiusM}`;
    const scan = `scan 0x${g.scanMode.toString(16)}`;
    if (g.projection === 'latlon') {
        return `${g.nx}x${g.ny} ${g.rotation ? 'rotated ' : ''}lat/lon at ${g.dlat}x${g.dlon} deg, first point ${g.lat1}, ${g.lon1}, ${scan}${radius}`;
    }
    if (g.projection === 'polarStereo') {
        return (
            `${g.nx}x${g.ny} polar stereographic at ${g.dx} m, first point ${g.lat1}, ${g.lon1}, orientation ${g.lov}, ` +
            `true at ${g.latD}, ${scan}${radius}`
        );
    }
    if (g.projection === 'mercator') {
        return `${g.nx}x${g.ny} Mercator at ${g.dx} m, first point ${g.lat1}, ${g.lon1}, true at ${g.latD}, ${scan}${radius}`;
    }
    return (
        `${g.nx}x${g.ny} at ${g.dx} m, first point ${g.lat1}, ${g.lon1}, central meridian ${g.lov}, ` +
        `tangent ${g.latin1}/${g.latin2}, ${scan}${radius}`
    );
}

const near = (a: number, b: number, tolerance: number) => Math.abs(a - b) <= tolerance;

/**
 * Whether a decoded message sits on the grid the config declares. Null when it does; otherwise the
 * keys that differ. Tiles are planned from the declared grid before anything is decoded, so a message
 * on another grid must be an error, not a silent re-plan.
 *
 * With `shapeOnly` (a moving grid, such as a storm-following nest) the first point is left out: size, scan order,
 * spacing, projection and radius must still match, but the corner may be anywhere.
 */
export function gridMismatch(
    declared: ModelGrid,
    actual: ModelGrid,
    { shapeOnly = false }: { shapeOnly?: boolean } = {},
): string[] | null {
    if (declared.projection !== actual.projection) return ['projection'];
    const diffs: string[] = [];
    if (declared.nx !== actual.nx) diffs.push('nx');
    if (declared.ny !== actual.ny) diffs.push('ny');
    if (declared.scanMode !== actual.scanMode) diffs.push('scanMode');
    const corner = (['lat1', 'lon1'] as const).filter(() => !shapeOnly);
    if (declared.projection === 'lambert' && actual.projection === 'lambert') {
        for (const key of [...corner, 'lov', 'latin1', 'latin2'] as const)
            if (!near(declared[key], actual[key], ANGLE_TOLERANCE_DEG)) diffs.push(key);
        for (const key of ['dx', 'dy'] as const)
            if (!near(declared[key], actual[key], SPACING_TOLERANCE_M)) diffs.push(key);
    } else if (declared.projection === 'polarStereo' && actual.projection === 'polarStereo') {
        for (const key of [...corner, 'lov', 'latD'] as const)
            if (!near(declared[key], actual[key], ANGLE_TOLERANCE_DEG)) diffs.push(key);
        for (const key of ['dx', 'dy'] as const)
            if (!near(declared[key], actual[key], SPACING_TOLERANCE_M)) diffs.push(key);
    } else if (declared.projection === 'mercator' && actual.projection === 'mercator') {
        for (const key of [...corner, 'latD'] as const)
            if (!near(declared[key], actual[key], ANGLE_TOLERANCE_DEG)) diffs.push(key);
        for (const key of ['dx', 'dy'] as const)
            if (!near(declared[key], actual[key], SPACING_TOLERANCE_M)) diffs.push(key);
    } else if (declared.projection === 'latlon' && actual.projection === 'latlon') {
        if (!!declared.rotation !== !!actual.rotation) diffs.push('rotation');
        if (declared.rotation && actual.rotation) {
            for (const key of ['southPoleLat', 'southPoleLon'] as const)
                if (!near(declared.rotation[key], actual.rotation[key], ANGLE_TOLERANCE_DEG)) diffs.push(key);
        }
        for (const key of [...corner, 'dlat', 'dlon'] as const)
            if (!near(declared[key], actual[key], ANGLE_TOLERANCE_DEG)) diffs.push(key);
    }
    if (
        declared.radiusM !== undefined &&
        actual.radiusM !== undefined &&
        !near(declared.radiusM, actual.radiusM, RADIUS_TOLERANCE_M)
    )
        diffs.push('radiusM');
    return diffs.length ? diffs : null;
}
