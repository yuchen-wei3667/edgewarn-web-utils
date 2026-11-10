/**
 * Shared contracts of the sounding science core (phase 5 plan, section 5.3). Pure types only: the
 * science is `thermo`/`interp`/`parcels`/`kinematics`/`indices`/`composites`, orchestrated by `analyze`.
 * Nothing here fetches, renders or knows about a specific model.
 */

/** Pressure levels from the surface up, strictly decreasing; element 0 is the surface row.
 * Below-ground levels are removed by the column sources. NaN marks missing moisture in `td`. */
export interface Column {
    validMs: number;
    p: Float32Array; // hPa
    z: Float32Array; // m MSL (geopotential height)
    t: Float32Array; // °C
    td: Float32Array; // °C, NaN where moisture is missing
    u: Float32Array; // m/s, earth-relative
    v: Float32Array;
    /** Vertical motion (m/s), when the source carries it for the model. */
    vertical?: { units: 'm/s'; values: Float32Array };
    /** The surface row, duplicated from element 0 of the arrays (plus lower layers the source added). */
    surface: { p: number; z: number; t: number; td: number; u: number; v: number };
}

/** Storm motion as carried across `/models`, the map and `/sounding` (5.3). */
export type StormMotion =
    | { kind: 'bunkers-right' }
    | { kind: 'bunkers-left' }
    | { kind: 'mean-wind' }
    | { kind: 'user'; dirDeg: number; speedMs: number }; // direction the storm moves FROM, meteorological

export interface Vec2 {
    u: number;
    v: number;
}

export type ParcelKey = 'sb' | 'ml' | 'mu' | 'eff';

/** Everything the Skew-T table needs about one parcel. Undefined levels are `null`, never 0. */
export interface ParcelResult {
    cape: number | null; // J/kg, null when there is no LFC
    cin: number | null; // J/kg (negative or 0)
    lclP: number | null; // hPa
    lclZagl: number | null; // m AGL
    lfcP: number | null;
    lfcZagl: number | null;
    elP: number | null;
    elZagl: number | null;
    li: number | null; // 500 hPa lifted index (°C), null if the trace does not reach 500 hPa
    cape03: number | null; // positive area up to 3 km AGL, J/kg
    trace: { p: number; tv: number }[]; // parcel trace for the Skew-T, at most `SOUNDING_STRIP_HPA` apart
}

/** Sounding options from the UI (`AnalysisContext` in 5.2 parses the URL form of these). */
export interface AnalysisOptions {
    /** Motion the kinematics and SRH rows use. Default: Bunkers right mover. */
    stormMotion?: StormMotion;
}

/** Pressure bounds of the effective inflow layer (hPa), null when the layer is undefined. */
export interface LayerBounds {
    baseP: number;
    topP: number;
}

export interface SoundingAnalysis {
    parcels: Record<ParcelKey, ParcelResult>;
    layers: { effInflow: LayerBounds | null };
    kinematics: {
        /** Bulk shear magnitudes, m/s (0-1, 0-3, 0-6 km AGL). */
        shear01: number | null;
        shear03: number | null;
        shear06: number | null;
        /** Effective bulk wind difference, m/s: effective base to half the MU EL depth (Thompson 2007). */
        ebwd: number | null;
        /** Pressure-weighted 0-6 km mean wind, m/s (display). */
        meanWind06: Vec2 | null;
        bunkersRight: Vec2 | null;
        bunkersLeft: Vec2 | null;
        /** Storm-relative helicity, m²/s², with the options' storm motion. */
        srh01: number | null;
        srh03: number | null;
        /** SRH over the effective inflow layer with the Bunkers right mover (Thompson 2007). */
        esrh: number | null;
        /** Critical angle in degrees (Esterheld & Giuliano 2008). */
        criticalAngle: number | null;
        /** The motion actually used for SRH and the readouts (m/s components). */
        stormMotion: Vec2 | null;
    };
    thermo: {
        pw: number | null; // mm, surface to `SOUNDING_PW_TOP_HPA` (or the top of data)
        /** Lapse rates °C km⁻¹ (virtual-temperature profile, SHARPpy `lapse_rate`). */
        lr03: number | null; // 0-3 km AGL
        lr36: number | null; // 3-6 km AGL
        lr75: number | null; // 700-500 hPa
        lr85: number | null; // 850-500 hPa
        dcape: number | null; // J/kg
        frzZagl: number | null; // first 0 °C level, m AGL
        wbzZagl: number | null; // first 0 °C wet-bulb level, m AGL
        k: number | null;
        tt: number | null;
        showalter: number | null;
    };
    composites: {
        stpFixed: number | null;
        stpEff: number | null;
        scp: number | null;
        ship: number | null;
        ehi01: number | null;
        ehi03: number | null;
        brn: number | null; // bulk Richardson number from the MU parcel
    };
}

/** A run of columns at one snapped cell, by valid time. */
export interface ColumnSeries {
    /** Registry id of the model; owned by the caller's configuration. */
    model: string;
    initMs: number;
    cell: { i: number; j: number; lat: number; lon: number };
    /** The source that built it, e.g. a point reader. */
    type: string;
    /** Human attribution variant, e.g. "Open-Meteo copy of NOAA". */
    derivedFrom?: string;
    /** By valid time, ascending: only the times that were read. */
    columns: Column[];
    /** Every valid time the run lists (ms), so a step bar can offer the ones not read yet. */
    validTimes: number[];
    /** False while the provider is still writing the run: later steps may appear. */
    complete: boolean;
    /** What was read to build the series (urls or byte ranges). */
    provenance: { urls: string[]; bytes: number; reads?: unknown[]; units?: number };
    notes: string[];
}
