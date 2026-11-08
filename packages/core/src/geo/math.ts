/** Converts degrees to radians. */
export function toRad(deg: number): number {
    return (deg * Math.PI) / 180;
}

/** Clamps `value` into [min, max]. */
export function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

/** Wraps a longitude into [-180, 180]. */
export function normalizeLongitude(lon: number): number {
    let normalized = lon;
    while (normalized > 180) normalized -= 360;
    while (normalized < -180) normalized += 360;
    return normalized;
}

const EARTH_RADIUS_MILES = 3958.8;

/** Great-circle (haversine) distance between two points in statute miles. */
export function distanceMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return EARTH_RADIUS_MILES * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Converts radians to degrees. */
function toDeg(rad: number): number {
    return (rad * 180) / Math.PI;
}

/**
 * Calculates a new coordinate given a starting point, distance, and bearing.
 */
export function calculateDestination(lat: number, lon: number, distance: number, bearing: number): [number, number] {
    const earthRadiusMeters = 6371e3;
    const radLat = toRad(lat);
    const radLon = toRad(lon);
    const radBearing = toRad(bearing);
    const angularDist = distance / earthRadiusMeters;

    const newLat = Math.asin(
        Math.sin(radLat) * Math.cos(angularDist) +
        Math.cos(radLat) * Math.sin(angularDist) * Math.cos(radBearing)
    );

    const newLon = radLon + Math.atan2(
        Math.sin(radBearing) * Math.sin(angularDist) * Math.cos(radLat),
        Math.cos(angularDist) - Math.sin(radLat) * Math.sin(newLat)
    );

    return [toDeg(newLat), toDeg(newLon)];
}

/** Calculates the initial bearing between two points. */
export function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const phi1 = toRad(lat1);
    const phi2 = toRad(lat2);
    const deltaLambda = toRad(lon2 - lon1);

    const y = Math.sin(deltaLambda) * Math.cos(phi2);
    const x = Math.cos(phi1) * Math.sin(phi2) -
        Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);

    const theta = Math.atan2(y, x);
    return (toDeg(theta) + 360) % 360;
}
