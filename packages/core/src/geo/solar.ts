/**
 * Where the sun is, from the day of the year and the target's latitude (longitude and the clock set the time
 * of day). Declination follows the day of year, day length follows declination and latitude, and the sun's
 * height follows the hour angle. Accurate to about a degree, which is plenty for a picture.
 */
export interface SolarPosition {
    /** Degrees above the horizon; negative below it. */
    altitudeDeg: number;
    /** Degrees clockwise from north. */
    azimuthDeg: number;
    /** Local solar time, 0 to 24, where 12 is when the sun is highest. */
    solarHour: number;
    /** Solar time of sunrise and sunset; null in polar day or polar night. */
    sunriseHour: number | null;
    sunsetHour: number | null;
    /** How high the sun climbs today at this latitude. */
    noonAltitudeDeg: number;
    dayOfYear: number;
    declinationDeg: number;
}

const RAD = Math.PI / 180;
const MS_PER_HOUR = 3600000;
const MS_PER_DAY = 86400000;
const AXIAL_TILT_DEG = 23.44;
/** Sunrise and sunset are when the sun's top edge meets the horizon, allowing for refraction. */
const SUNRISE_ALTITUDE_DEG = -0.833;
const mod = (value: number, size: number) => ((value % size) + size) % size;

/** Day of the year (1 to 366) on the calendar at the target's longitude, so the day turns over at local solar midnight. */
export function dayOfYear(date: Date, longitudeDeg: number): number {
    const local = new Date(date.getTime() + (longitudeDeg / 15) * MS_PER_HOUR);
    const year = local.getUTCFullYear();
    return Math.round(
        (Date.UTC(year, local.getUTCMonth(), local.getUTCDate()) - Date.UTC(year, 0, 0)) / MS_PER_DAY,
    );
}

export function declinationDeg(day: number): number {
    return AXIAL_TILT_DEG * Math.sin((2 * Math.PI * (284 + day)) / 365);
}

/** How far the sun runs ahead of or behind a clock that never speeds up, in minutes. */
function equationOfTimeMinutes(day: number): number {
    const b = (2 * Math.PI * (day - 81)) / 364;
    return 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
}

export function solarPosition(latitudeDeg: number, longitudeDeg: number, date: Date): SolarPosition {
    const day = dayOfYear(date, longitudeDeg);
    const declination = declinationDeg(day);
    const utcHour = (date.getTime() % MS_PER_DAY) / MS_PER_HOUR;
    const solarHour = mod(utcHour + longitudeDeg / 15 + equationOfTimeMinutes(day) / 60, 24);
    const hourAngle = 15 * (solarHour - 12) * RAD;
    const lat = latitudeDeg * RAD;
    const dec = declination * RAD;

    const altitude = Math.asin(
        Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(hourAngle),
    );
    const fromSouth = Math.atan2(
        Math.sin(hourAngle),
        Math.cos(hourAngle) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat),
    );

    const cosHalfDay =
        (Math.sin(SUNRISE_ALTITUDE_DEG * RAD) - Math.sin(lat) * Math.sin(dec)) /
        (Math.cos(lat) * Math.cos(dec));
    const polar = Math.abs(cosHalfDay) > 1;
    const halfDayHours = polar ? 0 : Math.acos(cosHalfDay) / RAD / 15;
    return {
        altitudeDeg: altitude / RAD,
        azimuthDeg: mod(fromSouth / RAD + 180, 360),
        solarHour,
        sunriseHour: polar ? null : 12 - halfDayHours,
        sunsetHour: polar ? null : 12 + halfDayHours,
        noonAltitudeDeg: 90 - Math.abs(latitudeDeg - declination),
        dayOfYear: day,
        declinationDeg: declination,
    };
}

/**
 * How far the visible body is along its path, 0 at rising and 1 at setting. By day it is the sun's path
 * between sunrise and sunset; at night it is the picture moon's path between sunset and the next sunrise.
 */
export function pathFraction(position: SolarPosition, sunIsUp: boolean): number {
    const { solarHour, sunriseHour, sunsetHour } = position;
    if (sunriseHour === null || sunsetHour === null) return solarHour / 24;
    if (sunIsUp) return (solarHour - sunriseHour) / (sunsetHour - sunriseHour);
    const nightLength = 24 - (sunsetHour - sunriseHour);
    return mod(solarHour - sunsetHour, 24) / nightLength;
}

/** The picture's moon sits opposite the sun. It is not the real moon, which would need its own phase and orbit. */
export function oppositeAltitude(position: SolarPosition): number {
    return -position.altitudeDeg;
}
