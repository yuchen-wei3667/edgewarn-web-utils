# Sounding science (`@edgewarn/web-utils/met`)

Portable synchronous meteorological analysis. No runtime dependencies, network,
storage or DOM. Usable in Node, browsers, workers and service workers.

```ts
import { analyzeSounding, type Column } from '@edgewarn/web-utils/met';

const column: Column = {
  validMs: 0,
  p: Float32Array.of(1000, 850, 700, 500),
  z: Float32Array.of(0, 1500, 3000, 5500),
  t: Float32Array.of(25, 15, 5, -15),
  td: Float32Array.of(20, 10, 0, -20),
  u: Float32Array.of(0, 5, 10, 20),
  v: Float32Array.of(5, 10, 15, 20),
  surface: { p: 1000, z: 0, t: 25, td: 20, u: 0, v: 5 },
};
const analysis = analyzeSounding(column);
console.log(analysis.parcels.sb.cape); // J/kg or null
```

## Column and result contracts

Use equal-length `Float32Array` fields with strictly decreasing pressure, element
zero at the surface and below-ground levels removed. `surface` duplicates the
first row. `validMs` is the valid time in Unix milliseconds. Optional `vertical`
contains `{ units: 'm/s', values: Float32Array }`; analysis does not use it.
`ColumnSeries`, source/model selection, I/O and rendering remain caller concerns.

Pressure is hPa, temperature °C (unless named K), mixing ratio g/kg, height metres
MSL (AGL where named), wind m/s, CAPE/CIN J/kg and helicity m²/s². User storm
direction is meteorological **FROM**, in degrees.

Missing field values use `NaN`. Undefined analysis quantities are `null`, with an
empty trace for an undefined parcel. Low-level scalar helpers can return `NaN`;
`capeCheckColumn` returns NaN CAPE/CIN when undefined. Supply physically valid
inputs: this extraction preserves the original formulas, not a general input
validator. `analyzeSounding` throws `Error('sounding: structurally empty column')`
for fewer than two pressure levels or a height/pressure length mismatch.

Analysis uses a module-owned, 32-entry FIFO memo cache keyed by time, options and
hashes of the six array bit patterns. Equal content returns the **same object**;
treat results and nested arrays as read-only. Hash collisions are not checked for
equality (the existing Website behavior). Subarray byte offsets are supported.
There is no public cache reset or configurable capacity.

SHARPpy Wobus polynomials, 5 hPa lift / 10 hPa screening meshes, the 300 hPa
most-unstable search, and DCAPE's local gravity of 9.8 are retained intentionally.
No numerical recalibration is part of this extraction.

## API

60 runtime functions and 15 types, plus four constants required by existing
Website consumers (D-M2): `SOUNDING_RD` (287.04 J kg⁻¹ K⁻¹),
`SOUNDING_GRAVITY` (9.80665 m s⁻²), `SOUNDING_KELVIN_OFFSET` (273.15), and
`SOUNDING_CIN_LIMIT_HPA` (500). All other constants and deep imports are private.

### 1 Bolton (1980) relations: 5 functions

Re-exported by `thermo` in the source, so they appear once in the public surface.

| Function | Signature | Purpose |
|---|---|---|
| `saturationVapourPressure` | `(tC: number) => number` | Saturation vapour pressure (hPa) |
| `dewpointFromRelativeHumidity` | `(tC: number, rhPercent: number) => number` | Dewpoint (°C) from temperature and RH |
| `mixingRatioHpa` | `(pHpa: number, tdC: number) => number` | Mixing ratio (g/kg) from pressure and dewpoint |
| `lclTemperatureK` | `(tK: number, tdK: number) => number` | LCL temperature (K) |
| `equivalentPotentialTemperature` | `(pHpa: number, tC: number, tdC: number) => number` | θe (K) |

### 2 Thermodynamics (SHARPpy `thermo`): 13 functions

| Function | Signature | Purpose |
|---|---|---|
| `thetaK` | `(pHpa, tC, refPHpa = 1000) => number` | Potential temperature (K) |
| `thetaC` | `(pHpa, tC, refPHpa = 1000) => number` | Potential temperature (°C) |
| `temperatureFromThetaC` | `(thetaInC, pHpa) => number` | Inverse of `thetaC` |
| `lclTempC` | `(tC, tdC) => number` | LCL temperature (°C) |
| `lclPressureHpa` | `(pHpa, tC, tLclC) => number` | LCL pressure |
| `dryLift` | `(pHpa, tC, tdC) => { p: number; t: number }` | Dry-lift a parcel to its LCL |
| `virtualTemperatureC` | `(pHpa, tC, tdC) => number` | Virtual temperature |
| `wobf` | `(tC) => number` | Wobus function |
| `satLiftC` | `(pHpa, thetaSatC) => number` | Iterative saturated lift |
| `wetLiftC` | `(pHpa, tC, pHpa2) => number` | Moist-adiabatic lift between levels |
| `wetBulbC` | `(pHpa, tC, tdC) => number` | Wet-bulb temperature |
| `tempAtMixratioC` | `(rGkg, pHpa) => number` | Temperature at a mixing ratio |
| `dryLiftToC` | `(pHpaFrom, tC, pHpaTo) => number` | Dry-adiabatic temperature at another level |

### 3 Interpolation and layers: 11 functions

All take a `Column`. Interpolation is linear in log-p; outside the profile it returns `NaN`.

| Function | Signature | Purpose |
|---|---|---|
| `interpolateLogP` | `(ps: Float32Array, field: Float32Array, pHpa) => number` | Core interpolator over descending pressures |
| `heightAt` | `(col, pHpa) => number` | Height MSL at a pressure |
| `pressureAt` | `(col, zMsl) => number` | Pressure at a height MSL |
| `fieldAt` | `(col, field: ColumnField, pHpa) => number` | Any column field at a pressure |
| `heightsAgl` | `(col) => Float32Array` | Whole column in metres AGL |
| `heightAglAt` | `(col, pHpa) => number` | Height AGL at a pressure |
| `pressureAtAgl` | `(col, zAglM) => number` | Pressure at a height AGL |
| `levelOfTemperature` | `(col, tC) => number` | Pressure where the profile first crosses a temperature |
| `layerMean` | `(col, field, pBotHpa, pTopHpa, options?: LayerMeanOptions) => number` | Mean of a field over a pressure layer |
| `exactLayerMean` | `(col, pBotHpa, pTopHpa, valueAtLevel, endpoint) => number` | Layer mean from caller-supplied level values |
| `isLayerValid` | `(col, pBotHpa, pTopHpa) => boolean` | Layer lies inside the profile |

### 4 Parcels: 7 functions

| Function | Signature | Purpose |
|---|---|---|
| `surfaceParcelDef` | `(col) => ParcelDefinition` | Surface-based parcel |
| `meanLayerParcelDef` | `(col, depthHpa = 100) => ParcelDefinition \| null` | Mixed-layer parcel |
| `mostUnstableParcelDef` | `(col, depthHpa = 300) => ParcelDefinition \| null` | Most-unstable parcel |
| `effectiveParcelDef` | `(col, pBotHpa, pTopHpa) => ParcelDefinition \| null` | Parcel at the effective inflow base |
| `liftColumn` | `(col, def, mesh = 5) => LiftResult \| null` | Full lift: CAPE, CIN, LCL/LFC/EL, LI, CAPE 0-3 km, trace |
| `capeCheckColumn` | `(col, def, mesh = 10) => CapeCheck` | Cheap CAPE/CIN screen used while searching layers; both fields `NaN` when undefined |
| `dcapeColumn` | `(col) => number \| null` | Downdraft CAPE |

### 5 Indices: 9 functions + 1 type

| Function | Signature | Purpose |
|---|---|---|
| `lapseRatePressure` | `(col, pBotHpa, pTopHpa) => number \| null` | Lapse rate (°C/km, virtual temperature) between pressures |
| `lapseRateHeight` | `(col, lowerAglM, upperAglM) => number \| null` | Lapse rate between heights AGL |
| `precipitableWater` | `(col) => number \| null` | PW (mm) |
| `kIndex` | `(col) => number \| null` | K index |
| `totalTotals` | `(col) => number \| null` | Total Totals |
| `showalter` | `(col, lift: LiftFn) => number \| null` | Showalter index; lift function injected (avoids a parcels→indices cycle) |
| `freezingLevelAgl` | `(col) => number \| null` | First 0 °C level, m AGL |
| `wetBulbZeroAgl` | `(col) => number \| null` | First 0 °C wet-bulb level, m AGL |
| `bulkRichardson` | `(col, capeJkg: number \| null) => number \| null` | BRN |

### 6 Kinematics: 8 functions

| Function | Signature | Purpose |
|---|---|---|
| `bulkShear` | `(col, topAglM) => number \| null` | Surface-to-height shear magnitude |
| `meanWind` | `(col, pBotHpa, pTopHpa, weighted: boolean) => Vec2 \| null` | Layer mean wind |
| `bunkersDeviate` | `(mean: Vec2, su, sv) => Vec2` | Apply the Bunkers deviation to a mean wind |
| `bunkersMotion` | `(col) => BunkersResult` | Right, left and mean-wind storm motions |
| `helicity` | `(col, lowerAglM, upperAglM, storm: Vec2) => number \| null` | Storm-relative helicity |
| `effectiveInflowLayer` | `(col) => LayerBounds \| null` | Effective inflow layer (Thompson 2007) |
| `effectiveBulkShear` | `(col, muElZaglM, layer) => number \| null` | Effective bulk wind difference |
| `criticalAngle` | `(col, storm: Vec2) => number \| null` | Critical angle (Esterheld and Giuliano 2008) |

### 7 Composites: 5 functions

| Function | Signature | Purpose |
|---|---|---|
| `stpFixed` | `(sbCape, sbLclZagl, srh01, shear06) => number \| null` | Significant Tornado Parameter, fixed layer |
| `stpEffective` | `(mlCape, esrh, ebwd, mlLclZagl, mlCin) => number \| null` | STP, effective layer |
| `scp` | `(muCape, esrh, ebwd) => number \| null` | Supercell Composite Parameter |
| `ship` | `(muCape, muMixingRatioGkg, lr75, t500C, shear06, frzZagl) => number \| null` | Significant Hail Parameter |
| `ehi` | `(capeJkg, srh) => number \| null` | Energy-Helicity Index |

### 8 Orchestration: 2 functions

| Function | Signature | Purpose |
|---|---|---|
| `analyzeSounding` | `(col: Column, options: AnalysisOptions = {}) => SoundingAnalysis` | The one-call entry point. Four parcels, kinematics, thermo indices, composites. Throws `Error('sounding: structurally empty column')` when `p` has fewer than 2 levels or `z.length !== p.length`. Results are memoised (see the memoisation contract above) |
| `resolveMotion` | `(motion: StormMotion \| undefined, bunkers) => Vec2 \| null` | Turns a `StormMotion` choice into u/v components |

### 9 Types: 15

`Column`, `Vec2`, `StormMotion`, `ParcelKey`, `ParcelResult`, `AnalysisOptions`, `LayerBounds`, `SoundingAnalysis`: already exported in source.

`ParcelDefinition`, `LiftResult`, `CapeCheck`, `BunkersResult`, `ColumnField`, `LayerMeanOptions`: **newly exported.** They are file-private in the source but appear in public signatures, so a consumer cannot name them otherwise. `LiftFn` is already exported from `indices.ts`.

