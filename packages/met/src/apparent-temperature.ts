/** Steadman (1994) apparent-temperature approximation used by Heat & Cold, returned in °F. */
export function steadmanApparentTemperature(
    temperatureF: number | null,
    humidity: number | null,
    windMph: number | null,
): number | null {
    if (temperatureF == null || humidity == null || windMph == null) return temperatureF;
    const temperatureC = ((temperatureF - 32) * 5) / 9;
    const vaporPressure =
        (Math.max(0, Math.min(100, humidity)) / 100) *
        6.105 *
        Math.exp((17.27 * temperatureC) / (237.7 + temperatureC));
    const apparentC = temperatureC + 0.33 * vaporPressure - 0.7 * (windMph * 0.44704) - 4.0;
    return (apparentC * 9) / 5 + 32;
}
