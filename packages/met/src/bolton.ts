/**
 * Bolton (1980) relations shared by every source of air-mass temperature and moisture maths. This
 * module is deliberately neutral: the model engine's θe recipe and the sounding science core import
 * the same functions, so the two never drift apart (phase 5 plan, section 5.1, `lint:dupes`).
 *
 * Reference: D. Bolton, 1980: The computation of equivalent potential temperature.
 * Mon. Wea. Rev., 108, 1046-1053. Eqs 10 (saturation vapour pressure), 15 (LCL temperature) and 43 (θe).
 */

/** e_s from °C temperature in hPa (eq. 10, within 0.1 % under 100 hPa e). */
export function saturationVapourPressure(tC: number): number {
    return 6.112 * Math.exp((17.67 * tC) / (tC + 243.5));
}

/**
 * Dewpoint in °C from °C temperature and percent relative humidity: eq. 10 inverted at e = RH · e_s(T). NaN for a
 * humidity that is missing or not above zero, because the dewpoint of dry air is undefined (not -infinity).
 */
export function dewpointFromRelativeHumidity(tC: number, rhPercent: number): number {
    if (!(rhPercent > 0) || !Number.isFinite(tC)) return Number.NaN;
    const gamma = Math.log(rhPercent / 100) + (17.67 * tC) / (tC + 243.5);
    return (243.5 * gamma) / (17.67 - gamma);
}

/** Mixing ratio in g kg⁻¹ from hPa pressure and dewpoint °C: r = 1000 · ε e/(p − e). */
export function mixingRatioHpa(pHpa: number, tdC: number): number {
    const e = saturationVapourPressure(tdC);
    return (621.97 * e) / (pHpa - e); // 621.97 = 1000 · ε
}

/** T of the LCL in K (eq. 15) from parcel temperature and dewpoint in K. */
export function lclTemperatureK(tK: number, tdK: number): number {
    return 1 / (1 / (tdK - 56) + Math.log(tK / tdK) / 800) + 56;
}

/** Equivalent potential temperature in K (eq. 43), from hPa pressure and °C temperature/dewpoint.
 * The same expression the model engine used in-line, shared so `lint:dupes` stays clean. */
export function equivalentPotentialTemperature(pHpa: number, tC: number, tdC: number): number {
    const tK = tC + 273.15;
    const tdK = tdC + 273.15;
    const r = mixingRatioHpa(pHpa, tdC) / 1000; // kg/kg
    const tl = lclTemperatureK(tK, tdK);
    return (
        tK *
        (1000 / pHpa) ** (0.2854 * (1 - 0.28 * r)) *
        Math.exp((3.376 / tl - 0.00254) * r * 1000 * (1 + 0.81 * r))
    );
}
