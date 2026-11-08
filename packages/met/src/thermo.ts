/**
 * Thermodynamics of the sounding science core (phase 5 plan, section 5.4), ported from SHARPpy's
 * `sharppy/sharptab/thermo.py` (Blumberg et al. 2017) to keep SPC-calibrated values: the Wobus
 * moist adiabat (Wobus function; its known pressure dependency, Davies-Jones 2008, is not modelled),
 * and the iterative saturated lift. Bolton (1980) relations shared with the model engine come from
 * `utils/helpers/bolton.ts`; textbook conversions (°F etc.) stay out of the science core.
 *
 * Conventions: hPa for pressure, °C for temperatures this module hands around (a Wobus port keeps
 * the °C bookkeeping), K where stated, g/kg for mixing ratio.
 */

import {
    SOUNDING_KELVIN_OFFSET,
    SOUNDING_EPSILON,
    SOUNDING_DRY_EXPONENT,
    SOUNDING_SATLIFT_CONV_C,
} from './constants.ts';
import { mixingRatioHpa } from './bolton.ts';

export {
    dewpointFromRelativeHumidity,
    saturationVapourPressure,
    mixingRatioHpa,
    lclTemperatureK,
    equivalentPotentialTemperature,
} from './bolton.ts';

/* Locally named fitting constants (no physical meaning beyond their polynomial). */

/** SHARPpy `temp_at_mixrat`: the empirical inverse of its mixing-ratio polynomial. */
const MIXRATIO_C1 = 0.0498646455;
const MIXRATIO_C2 = 2.4082965;
const MIXRATIO_C3 = 7.07475;
const MIXRATIO_C4 = 38.9114;
const MIXRATIO_C5 = 0.0915;
const MIXRATIO_C6 = 1.2035;

/** Wobus function polynomials, negative (t <= 20 °C, after the 20 °C shift) then positive branch. */
const WOBF_N_COEFFS = [
    -8.841660499999999e-3, 1.4714143e-4, -9.671989000000001e-7, -3.2607217e-8, -3.8598073e-10,
] as const;
const WOBF_P_COEFFS = [4.9618922e-7, -6.1059365e-9, 3.9401551e-11, -1.2588129e-13, 1.668828e-16] as const;
const WOBF_P_LINEAR = [3.6182989e-3, -1.3603273e-5] as const;
const WOBF_N_SCALE = 15.13;
const WOBF_P_SCALE = 29.93;

/** Finite check used everywhere below: NaN or infinite input is treated as missing, never thrown. */
const missing = (v: number): boolean => !Number.isFinite(v);

/** Potential temperature in K at `pHpa` referenced to 1000 hPa by default. */
export function thetaK(pHpa: number, tC: number, refPHpa = 1000): number {
    if (missing(pHpa) || missing(tC) || pHpa <= 0) return NaN;
    return (tC + SOUNDING_KELVIN_OFFSET) * (refPHpa / pHpa) ** SOUNDING_DRY_EXPONENT;
}

/** Potential temperature in °C (the value the Wobus bookkeeping uses). */
export function thetaC(pHpa: number, tC: number, refPHpa = 1000): number {
    return thetaK(pHpa, tC, refPHpa) - SOUNDING_KELVIN_OFFSET;
}

/** Temperature from potential temperature (°C in, °C out) along the dry adiabat. */
export function temperatureFromThetaC(thetaInC: number, pHpa: number): number {
    if (missing(thetaInC) || missing(pHpa) || pHpa <= 0) return NaN;
    return (
        (thetaInC + SOUNDING_KELVIN_OFFSET) * (pHpa / 1000) ** SOUNDING_DRY_EXPONENT - SOUNDING_KELVIN_OFFSET
    );
}

/** SHARPpy `lcltemp`: parcel temperature (°C) at the LCL. */
export function lclTempC(tC: number, tdC: number): number {
    if (missing(tC) || missing(tdC)) return NaN;
    const s = tC - tdC;
    const dlt = s * (1.2185 + 0.001278 * tC + s * (-0.00219 + 1.173e-5 * s - 0.0000052 * tC));
    return tC - dlt;
}

/** LCL pressure (hPa) from a parcel at `pHpa`/`tC` lifted dry-adiabatically to `tLclC`. */
export function lclPressureHpa(pHpa: number, tC: number, tLclC: number): number {
    if (missing(pHpa) || missing(tC) || missing(tLclC) || pHpa <= 0) return NaN;
    const tk = tC + SOUNDING_KELVIN_OFFSET;
    const tlk = tLclC + SOUNDING_KELVIN_OFFSET;
    if (tlk <= 0) return NaN;
    // SHARPpy `thalvl`: p_LCL = p·(T_LCL/T₀)^(1/κ), cooling as the dry adiabat ascends.
    return pHpa * (tlk / tk) ** (1 / SOUNDING_DRY_EXPONENT);
}

/** SHARPpy `drylift`: lifts a parcel dry-adiabatically to its LCL; `td` is its dewpoint at `pHpa`. */
export function dryLift(pHpa: number, tC: number, tdC: number): { p: number; t: number } {
    const tLcl = lclTempC(tC, tdC);
    return { p: lclPressureHpa(pHpa, tC, tLcl), t: tLcl };
}

/**
 * Virtual temperature (°C, Doswell & Rasmussen 1994): Tv = T·(1 + r/ε)/(1 + r) with r from the
 * Bolton dewpoint. Where moisture is missing the plain temperature passes through, as SHARPpy
 * `virtemp` does with masked dewpoints.
 */
export function virtualTemperatureC(pHpa: number, tC: number, tdC: number): number {
    if (missing(pHpa) || missing(tC) || pHpa <= 0) return NaN;
    if (missing(tdC)) return tC;
    const r = mixingRatioHpa(pHpa, tdC);
    if (!Number.isFinite(r) || r < 0) return tC;
    const tk = tC + SOUNDING_KELVIN_OFFSET;
    return (tk * (1 + r / 1000 / SOUNDING_EPSILON)) / (1 + r / 1000) - SOUNDING_KELVIN_OFFSET;
}

/**
 * Wobus function: correction (°C) to potential temperature for the saturated potential temperature
 * (exactly SHARPpy `wobf`, without the pressure dependency of Davies-Jones 2008).
 */
export function wobf(tC: number): number {
    if (missing(tC)) return NaN;
    const t = tC - 20;
    if (t <= 0) {
        const npol =
            1 +
            t *
                (WOBF_N_COEFFS[0] +
                    t *
                        (WOBF_N_COEFFS[1] +
                            t * (WOBF_N_COEFFS[2] + t * (WOBF_N_COEFFS[3] + t * WOBF_N_COEFFS[4]))));
        return WOBF_N_SCALE / npol ** 4;
    }
    const ppol =
        t *
        (WOBF_P_COEFFS[0] +
            t * (WOBF_P_COEFFS[1] + t * (WOBF_P_COEFFS[2] + t * (WOBF_P_COEFFS[3] + t * WOBF_P_COEFFS[4]))));
    const ppoly = 1 + t * (WOBF_P_LINEAR[0] + t * (WOBF_P_LINEAR[1] + ppol));
    return WOBF_P_SCALE / ppoly ** 4 + 0.96 * t - 14.8;
}

/**
 * SHARPpy `satlift`: temperature (°C) of a saturated parcel whose saturated potential temperature
 * is `thetaSatC` when raised to `pHpa`, by iteration on the Wobus pseudoadiabat. Bounded to avoid a
 * runaway on hostile input; an unresolved case reports NaN.
 */
export function satLiftC(pHpa: number, thetaSatC: number): number {
    if (missing(pHpa) || missing(thetaSatC) || pHpa <= 0) return NaN;
    if (Math.abs(pHpa - 1000) - 0.001 <= 0) return thetaSatC;
    const pwrp = (pHpa / 1000) ** SOUNDING_DRY_EXPONENT;
    let t1 = (thetaSatC + SOUNDING_KELVIN_OFFSET) * pwrp - SOUNDING_KELVIN_OFFSET;
    let e1 = wobf(t1) - wobf(thetaSatC);
    let t2 = NaN;
    let e2 = NaN;
    let eor = 999;
    let rate = 1;
    for (let i = 0; Math.abs(eor) - SOUNDING_SATLIFT_CONV_C > 0 && i < 200; i++) {
        if (i > 0) {
            if (e2 === e1) return NaN; // parallel iteration: nothing to converge towards
            rate = (t2 - t1) / (e2 - e1);
            t1 = t2;
            e1 = e2;
        }
        t2 = t1 - e1 * rate;
        e2 = (t2 + SOUNDING_KELVIN_OFFSET) / pwrp - SOUNDING_KELVIN_OFFSET;
        e2 += wobf(t2) - wobf(e2) - thetaSatC;
        eor = e2 * rate;
    }
    if (!Number.isFinite(t2) || !Number.isFinite(eor)) return NaN;
    return t2 - eor;
}

/** SHARPpy `wetlift`: moist (pseudo-adiabatic, Wobus) ascent from `(pHpa, tC)` to `pHpa2`. */
export function wetLiftC(pHpa: number, tC: number, pHpa2: number): number {
    if (missing(pHpa) || missing(tC) || missing(pHpa2)) return NaN;
    const thetaEnvC = thetaC(pHpa, tC);
    return satLiftC(pHpa2, thetaEnvC - wobf(thetaEnvC) + wobf(tC));
}

/** SHARPpy `wetbulb`: wet-bulb temperature (°C) of `pHpa`/`tC`/`tdC`. */
export function wetBulbC(pHpa: number, tC: number, tdC: number): number {
    const lcl = dryLift(pHpa, tC, tdC);
    return wetLiftC(lcl.p, lcl.t, pHpa);
}

/** Temperature (°C) of air whose mixing ratio is `rGkg` at `pHpa` (SHARPpy `temp_at_mixrat`). */
export function tempAtMixratioC(rGkg: number, pHpa: number): number {
    if (missing(rGkg) || missing(pHpa) || pHpa <= 0 || rGkg <= 0) return NaN;
    const x = Math.log10((rGkg * pHpa) / (622 + rGkg));
    return (
        Math.pow(10, MIXRATIO_C1 * x + MIXRATIO_C2) -
        MIXRATIO_C3 +
        MIXRATIO_C4 * (Math.pow(10, MIXRATIO_C5 * x) - MIXRATIO_C6) ** 2 -
        SOUNDING_KELVIN_OFFSET
    );
}

/** Temperature (°C) after a dry-adiabatic step from `(pHpaFrom, tC)` to `pHpaTo`. */
export function dryLiftToC(pHpaFrom: number, tC: number, pHpaTo: number): number {
    if (missing(pHpaFrom) || missing(tC) || missing(pHpaTo) || pHpaFrom <= 0 || pHpaTo <= 0) return NaN;
    return (
        (tC + SOUNDING_KELVIN_OFFSET) * (pHpaTo / pHpaFrom) ** SOUNDING_DRY_EXPONENT - SOUNDING_KELVIN_OFFSET
    );
}
