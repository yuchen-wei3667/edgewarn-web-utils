import test from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_CONFIGS } from '../dist/configs/index.js';
import { combineInputs } from '../dist/recipes.js';
import { diagnosticInputCount } from '../dist/diagnosticRecipes.js';
import { fromHalf, HALF_NAN, toHalf } from '@edgewarn/web-utils/grib2';
import { projectionFor } from '../dist/projection/index.js';
import { validateConfigs } from '../dist/registry/validate.js';
import { bunkersDeviate } from '@edgewarn/web-utils/met';
import { temperatureFromThetaC, thetaK } from '@edgewarn/web-utils/met';
import { blendInTime, gridWindSampler, integrateTrajectory } from '../dist/trajectory.js';

/**
 * The phase 5.10 diagnostics (IVT, potential vorticity, Q-vectors, differential advection, isentropic fields,
 * storm-relative flow) and parcel trajectories, against closed forms.
 */

const R = 6371229;
const D2R = Math.PI / 180;
const M = R * D2R; // metres per degree of latitude
const G = 9.80665;
const RD = 287.04;
const OMEGA = 7.292115e-5;

const REGION = { projection: 'latlon', nx: 60, ny: 41, lat1: 30, lon1: -100, dlat: 0.25, dlon: 0.25, scanMode: 0x40, radiusM: R };
const TINY = projectionFor({ ...REGION, nx: 2, ny: 2 });

const cells = (proj, f) => {
    const out = new Float32Array(proj.nx * proj.ny);
    for (let j = 0; j < proj.ny; j++) for (let i = 0; i < proj.nx; i++) { const [lat, lon] = proj.inverse(i, j); out[j * proj.nx + i] = f(lat, lon, i, j); }
    return out;
};
const level = (proj, values) => ({ level: 0, factor: 1, nx: proj.nx, ny: proj.ny, data: Uint16Array.from(values, (v) => (Number.isNaN(v) ? HALF_NAN : toHalf(v))) });
const flat = (proj, v) => level(proj, cells(proj, () => v));
const read = (out) => Array.from(out.data, fromHalf);
const close = (a, b, rel) => Math.abs(a - b) <= rel * Math.abs(b);

/** The cell the gradient tests centre on, and its place. */
const proj = projectionFor(REGION);
const [CI, CJ] = [30, 20];
const [LAT0, LON0] = proj.inverse(CI, CJ);
const at = (arr) => arr[CJ * proj.nx + CI];
/** Metres east and north of the centre cell. */
const east = (lat, lon) => (lon - LON0) * M * Math.cos(LAT0 * D2R);
const north = (lat) => (lat - LAT0) * M;

test('IVT is the integral of humidity times wind over the column, trapezoids from the ground', () => {
    const levels = [1000, 925, 850, 700, 600, 500, 400, 300];
    const params = { levelsHpa: levels };
    const inputs = (surface) => [...levels.flatMap(() => [flat(TINY, 10), flat(TINY, 6), flat(TINY, 8)]), flat(TINY, surface)];
    // 10 g/kg and a 10 m/s wind everywhere: q V (p0 - p_top) / g with the ground at 1013 mb (every level above it).
    const full = read(combineInputs('ivt', inputs(1013), TINY, params));
    const expected = 0.01 * 10 * (1013 - 300) * 100 / G;
    assert.ok(close(full[0], expected, 0.005), `${full[0]} against ${expected}`);
    // Ground at 900 mb: 1000 and 925 mb are under it and the column starts at 900.
    const high = read(combineInputs('ivt', inputs(900), TINY, params));
    assert.ok(close(high[0], 0.01 * 10 * (900 - 300) * 100 / G, 0.005), `${high[0]}`);
    // Moisture falling off linearly in pressure from 10 g/kg at 1000 mb to 0 at 300 mb, wind 10 m/s along x: half the uniform column.
    const q = (p) => 10 * (p - 300) / 700;
    const tapered = read(combineInputs('ivt', [...levels.flatMap((p) => [flat(TINY, q(p)), flat(TINY, 10), flat(TINY, 0)]), flat(TINY, 1000)], TINY, params));
    assert.ok(close(tapered[0], 0.5 * 0.01 * 10 * 700 * 100 / G, 0.01), `${tapered[0]}`);
    // A level under the ground may be missing; a missing level above it, or the surface pressure, makes the cell missing.
    const holed = inputs(900);
    holed[0] = flat(TINY, NaN);
    assert.ok(close(read(combineInputs('ivt', holed, TINY, params))[0], high[0], 1e-6), 'a missing level under the ground is skipped');
    const above = inputs(900);
    above[3 * 3] = flat(TINY, NaN);
    assert.ok(Number.isNaN(read(combineInputs('ivt', above, TINY, params))[0]));
    const noGround = inputs(900);
    noGround[noGround.length - 1] = flat(TINY, NaN);
    assert.ok(Number.isNaN(read(combineInputs('ivt', noGround, TINY, params))[0]));
    assert.throws(() => combineInputs('ivt', inputs(900), TINY, {}), /levelsHpa/);
});

/** Temperature (degC) with the potential temperature `theta` at `p`. */
const tAt = (theta, p) => temperatureFromThetaC(theta - 273.15, p);

test('potential vorticity is -g (zeta + f) d(theta)/dp, and the baroclinic term turns on with shear and a horizontal gradient', () => {
    const levels = [600, 500, 400];
    const theta = { 600: 300, 500: 305, 400: 312 };
    const params = { frame: 'earth', levelsHpa: levels };
    const still = levels.flatMap((p) => [level(proj, cells(proj, () => tAt(theta[p], p))), flat(proj, 0), flat(proj, 0)]);
    const out = read(combineInputs('potential-vorticity', still, proj, params));
    const f = 2 * OMEGA * Math.sin(LAT0 * D2R);
    const dthdp = (thetaK(400, tAt(theta[400], 400)) - thetaK(600, tAt(theta[600], 600))) / (-200 * 100);
    assert.ok(close(at(out), -G * f * dthdp * 1e6, 0.01), `${at(out)} against ${-G * f * dthdp * 1e6}`);
    assert.ok(at(out) > 0, 'a stable atmosphere in the northern hemisphere has positive PV');
    // Solid rotation u = -zeta y, v = 0 adds a relative vorticity of +zeta... u_y = -zeta so zeta = -u_y: rotate with u = -Z y.
    const Z = 2e-5;
    const spin = levels.flatMap((p) => [level(proj, cells(proj, () => tAt(theta[p], p))), level(proj, cells(proj, (lat) => -Z * north(lat))), flat(proj, 0)]);
    const spun = read(combineInputs('potential-vorticity', spin, proj, params));
    assert.ok(close(at(spun), -G * (f + Z) * dthdp * 1e6, 0.02), `${at(spun)} against ${-G * (f + Z) * dthdp * 1e6}`);
    // Wind that backs with height over a northward-rising potential temperature: + du/dp d(theta)/dy.
    const dudp = 10 / (-200 * 100); // u = 10 m/s at 400 mb, 0 at 600 mb (500 mb in between)
    const uAt = { 600: 0, 500: 5, 400: 10 };
    const slope = 4e-6; // K per metre northward at every level
    const tilt = levels.flatMap((p) => [level(proj, cells(proj, (lat) => tAt(theta[p] + slope * north(lat), p))), flat(proj, uAt[p]), flat(proj, 0)]);
    const tilted = read(combineInputs('potential-vorticity', tilt, proj, params));
    const expected = -G * (f * dthdp + dudp * slope) * 1e6;
    assert.ok(close(at(tilted), expected, 0.03), `${at(tilted)} against ${expected}`);
    // A grid-relative frame needs its rotation; a missing level is NaN; the levels must be three.
    assert.ok(Number.isNaN(at(read(combineInputs('potential-vorticity', [level(proj, cells(proj, () => NaN)), ...still.slice(1)], proj, params)))));
    assert.throws(() => combineInputs('potential-vorticity', still, proj, { frame: 'earth', levelsHpa: [600, 500] }), /3 levels/);
    assert.throws(() => combineInputs('potential-vorticity', still.map((g) => ({ ...g, factor: 2 })), proj, params), /full-resolution/);
});

test('absolute vorticity of a speed and a from-direction is the shear vorticity plus the Coriolis parameter', () => {
    const Z = 2e-5;
    const f = 2 * OMEGA * Math.sin(LAT0 * D2R);
    // u = -Z y (westerly south of the centre, easterly north of it) has zeta = -du/dy = Z; the u tan(lat) / a term is zero at the centre.
    const u = cells(proj, (lat) => -Z * north(lat));
    const speed = level(proj, u.map(Math.abs));
    const direction = level(proj, u.map((x) => (x >= 0 ? 270 : 90)));
    const out = read(combineInputs('absolute-vorticity', [speed, direction], proj, {}));
    assert.ok(close(at(out), (Z + f) * 1e5, 0.02), `${at(out)} against ${(Z + f) * 1e5}`);
    // A calm field is the planetary vorticity alone; a coarse input has no derivative.
    const calm = read(combineInputs('absolute-vorticity', [flat(proj, 0), flat(proj, 0)], proj, {}));
    assert.ok(close(at(calm), f * 1e5, 0.01));
    assert.throws(() => combineInputs('absolute-vorticity', [speed, direction].map((g) => ({ ...g, factor: 2 })), proj, {}), /full-resolution/);
});

test('the Q-vector of pure deformation over a northward gradient is (R/p) D G, and its convergence follows the gradient\'s change', () => {
    const D = 5e-5; // u = D x, v = -D y
    const G0 = 1e-5;
    const G1 = 1e-10;
    const u = level(proj, cells(proj, (lat, lon) => D * east(lat, lon)));
    const v = level(proj, cells(proj, (lat) => -D * north(lat)));
    const uniform = level(proj, cells(proj, (lat) => G0 * north(lat)));
    const magnitude = read(combineInputs('q-vector', [uniform, u, v], proj, { frame: 'earth', levelHpa: 700, output: 'magnitude' }));
    assert.ok(close(at(magnitude), RD / 70000 * D * G0 * 1e11, 0.03), `${at(magnitude)} against ${RD / 70000 * D * G0 * 1e11}`);
    // The gradient strengthens northward (T = G0 y + G1 y^2 / 2): Q points north and grows north, so it diverges: -2 dQ2/dy < 0.
    const varying = level(proj, cells(proj, (lat) => G0 * north(lat) + G1 * north(lat) ** 2 / 2));
    const convergence = read(combineInputs('q-vector', [varying, u, v], proj, { frame: 'earth', levelHpa: 700, output: 'convergence' }));
    const expected = -2 * RD / 70000 * D * G1 * 1e16;
    assert.ok(close(at(convergence), expected, 0.05), `${at(convergence)} against ${expected}`);
    assert.ok(Math.abs(at(read(combineInputs('q-vector', [uniform, u, v], proj, { frame: 'earth', levelHpa: 700, output: 'convergence' })))) < 0.05 * Math.abs(expected), 'a uniform gradient gives no convergence');
    assert.throws(() => combineInputs('q-vector', [uniform, u, v], proj, { frame: 'earth', output: 'magnitude' }), /pressure level/);
    assert.throws(() => combineInputs('q-vector', [uniform, u, v], proj, { frame: 'earth', levelHpa: 700 }), /magnitude or convergence/);
});

test('differential advection is the lower level\'s temperature advection minus the upper level\'s', () => {
    const t = level(proj, cells(proj, (lat) => lat - 35));
    const southerly = flat(proj, 10);
    const calm = flat(proj, 0);
    const inputs = [t, calm, southerly, t, calm, calm];
    const out = read(combineInputs('differential-advection', inputs, proj, { frame: 'earth' }));
    const cold = -10 / M * 3600; // 10 m/s from the cold side down the gradient
    assert.ok(close(at(out), cold, 0.01), `${at(out)} against ${cold}`);
    const swapped = read(combineInputs('differential-advection', [t, calm, calm, t, calm, southerly], proj, { frame: 'earth' }));
    assert.ok(close(at(swapped), -cold, 0.01), 'advection aloft is subtracted');
    assert.ok(Number.isNaN(out[0]), 'the edge has no derivative');
});

/** A profile with potential temperature 280 + 0.04 (1000 - p) K, so 296 K at 600 mb and 300 K at 500 mb. */
const PROFILE = [1000, 925, 850, 700, 600, 500, 400, 300];
const profileTheta = (p) => 280 + 0.04 * (1000 - p);
const isentropicInputs = (output, surface) => [
    ...PROFILE.map((p) => flat(TINY, tAt(profileTheta(p), p))),
    ...(output === 'humidity' ? PROFILE.map((p) => flat(TINY, p / 100)) : []),
    ...(output === 'speed' ? [...PROFILE.map(() => flat(TINY, 3)), ...PROFILE.map(() => flat(TINY, 4))] : []),
    flat(TINY, surface),
];

test('an isentropic surface is found between the levels that bracket it, linear in ln p, and carries the other fields with it', () => {
    const params = (output, thetaK_) => ({ frame: 'grid', levelsHpa: PROFILE, thetaK: thetaK_, output });
    // 298 K is halfway between 596... 296 K at 600 mb and 300 K at 500 mb.
    const pressure = read(combineInputs('isentropic', isentropicInputs('pressure', 1013), TINY, params('pressure', 298)))[0];
    assert.ok(close(pressure, Math.sqrt(600 * 500), 0.005), `${pressure}`);
    const humidity = read(combineInputs('isentropic', isentropicInputs('humidity', 1013), TINY, params('humidity', 298)))[0];
    assert.ok(close(humidity, 5.5, 0.01), `${humidity}`);
    const speed = read(combineInputs('isentropic', isentropicInputs('speed', 1013), TINY, params('speed', 298)))[0];
    assert.ok(close(speed, 5, 0.01), `${speed}`);
    // The ground at 800 mb hides the lowest levels without moving the surface above them; a surface under the ground or above the top is missing.
    assert.ok(close(read(combineInputs('isentropic', isentropicInputs('pressure', 800), TINY, params('pressure', 298)))[0], pressure, 1e-6));
    assert.ok(Number.isNaN(read(combineInputs('isentropic', isentropicInputs('pressure', 1013), TINY, params('pressure', 270)))[0]), 'under the ground');
    assert.ok(Number.isNaN(read(combineInputs('isentropic', isentropicInputs('pressure', 1013), TINY, params('pressure', 330)))[0]), 'above the top level');
    assert.ok(Number.isNaN(read(combineInputs('isentropic', isentropicInputs('pressure', 650), TINY, params('pressure', 290)))[0]), 'the 290 K surface is at 740 mb, under a 650 mb ground');
    assert.throws(() => combineInputs('isentropic', isentropicInputs('pressure', 1013), TINY, { levelsHpa: PROFILE, output: 'pressure' }), /thetaK/);
});

test('the inputs of a recipe with a variable list are counted from its params, and the registry holds fields to it', () => {
    const n = PROFILE.length;
    assert.equal(diagnosticInputCount('ivt', { levelsHpa: PROFILE }), 3 * n + 1);
    assert.equal(diagnosticInputCount('isentropic', { levelsHpa: PROFILE, output: 'pressure' }), n + 1);
    assert.equal(diagnosticInputCount('isentropic', { levelsHpa: PROFILE, output: 'humidity' }), 2 * n + 1);
    assert.equal(diagnosticInputCount('isentropic', { levelsHpa: PROFILE, output: 'speed' }), 3 * n + 1);
    assert.equal(diagnosticInputCount('isentropic', { levelsHpa: PROFILE, output: 'nope' }), -1);
    assert.equal(diagnosticInputCount('storm-relative', { levelsHpa: [850, 700] }), 5 + 6);
    assert.equal(diagnosticInputCount('advection', {}), null);
    const hrrr = MODEL_CONFIGS.find((c) => c.id === 'hrrr');
    const withField = (id, change) => ({ ...hrrr, fields: hrrr.fields.map((f) => (f.id === id ? { ...f, ...change } : f)) });
    const field = (id) => hrrr.fields.find((f) => f.id === id);
    assert.deepEqual(validateConfigs(MODEL_CONFIGS).filter((p) => p.startsWith('hrrr:')), []);
    assert.match(validateConfigs([withField('HRRR_IVT', { inputs: field('HRRR_IVT').inputs.slice(1) })]).join('\n'), /HRRR_IVT: recipe ivt takes 25 inputs/);
    assert.match(validateConfigs([withField('HRRR_ISEN_300K_SPEED', { recipeParams: { levelsHpa: PROFILE, thetaK: 300 } })]).join('\n'), /needs recipeParams.levelsHpa and an output/);
    assert.match(validateConfigs([withField('HRRR_PV_500MB', { recipeParams: { levelsHpa: [600, 500] } })]).join('\n'), /three recipeParams.levelsHpa/);
    assert.match(validateConfigs([withField('HRRR_QCONV_700MB', { recipeParams: { levelHpa: 700 } })]).join('\n'), /needs recipeParams.levelHpa and an output/);
    assert.match(validateConfigs([withField('HRRR_SRFLOW_850MB', { recipeParams: { levelsHpa: [850, 700, 500, 400], targetHpa: 925 } })]).join('\n'), /targetHpa among its levelsHpa/);
    assert.match(validateConfigs([withField('HRRR_ISEN_300K_PRESSURE', { recipeParams: { levelsHpa: PROFILE, output: 'pressure' } })]).join('\n'), /needs recipeParams.thetaK/);
});

/** One storm-relative case: the inputs [terrain, u10, v10, shear u, shear v, then HGT, u, v for 850, 700, 500 and 400 mb]. */
const STORM_LEVELS = [850, 700, 500, 400];
const stormInputs = ({ terrain = 100, heights = [1600, 3100, 5700, 7400], u = (z) => 10 + z / 1000, shear = [0, 20] } = {}) => [
    flat(TINY, terrain), flat(TINY, u(0)), flat(TINY, 0), flat(TINY, shear[0]), flat(TINY, shear[1]),
    ...heights.flatMap((h) => [flat(TINY, h), flat(TINY, u(h - terrain)), flat(TINY, 0)]),
];

test('storm-relative flow is the level\'s wind minus the Bunkers right mover built from the 0-6 km mean wind and shear', () => {
    const params = (targetHpa) => ({ frame: 'grid', levelsHpa: STORM_LEVELS, targetHpa });
    // u = 10 + z/1000 (z AGL): the 0-6 km mean is 13 m/s; with a southward... shear along +v the right mover is 7.5 m/s to the east of it.
    const mover = bunkersDeviate({ u: 13, v: 0 }, 0, 20);
    assert.deepEqual(mover, { u: 20.5, v: 0 });
    const low = read(combineInputs('storm-relative', stormInputs(), TINY, params(850)))[0];
    assert.ok(close(low, 20.5 - 11.5, 0.01), `${low}`);
    const mid = read(combineInputs('storm-relative', stormInputs(), TINY, params(500)))[0];
    assert.ok(close(mid, 20.5 - 15.6, 0.03), `${mid}`);
    // Shear along +u puts the right mover south of the mean: 7.5 m/s toward -v.
    const along = read(combineInputs('storm-relative', stormInputs({ shear: [20, 0] }), TINY, params(850)))[0];
    assert.ok(close(along, Math.hypot(11.5 - 13, 7.5), 0.01), `${along}`);
    // A target under the ground, or a profile that does not reach 4 km above it, is missing; an unlisted target is an error.
    assert.ok(Number.isNaN(read(combineInputs('storm-relative', stormInputs({ terrain: 1700 }), TINY, params(850)))[0]));
    assert.ok(Number.isNaN(read(combineInputs('storm-relative', stormInputs({ heights: [1600, 2400, 3000, 3400], terrain: 100 }), TINY, params(850)))[0]));
    assert.throws(() => combineInputs('storm-relative', stormInputs(), TINY, params(925)), /targetHpa/);
});

test('a parcel in a uniform eastward wind moves along the parallel, and the backward path retraces the forward one', () => {
    const wind = () => ({ u: 10, v: 0 });
    const forward = integrateTrajectory({ lat: 0, lon: 0 }, wind, { durationS: 3600, direction: 'forward' });
    const end = forward[forward.length - 1];
    assert.equal(end.seconds, 3600);
    assert.ok(close(end.lon, 36000 / R / D2R, 1e-6) && Math.abs(end.lat) < 1e-9, `${end.lon}, ${end.lat}`);
    // A swirl: the wind turns with position, so the path bends and the return trip must retrace it.
    const swirl = (lat, lon) => ({ u: 15 * Math.cos(lat * D2R * 20) + 5, v: 8 * Math.sin(lon * D2R * 30) });
    const out = integrateTrajectory({ lat: 40, lon: -95 }, swirl, { durationS: 6 * 3600, direction: 'forward' });
    const last = out[out.length - 1];
    const back = integrateTrajectory({ lat: last.lat, lon: last.lon }, swirl, { durationS: 6 * 3600, direction: 'backward', stepS: 300 });
    assert.ok(Math.abs(back[back.length - 1].lat - 40) < 1e-3 && Math.abs(back[back.length - 1].lon + 95) < 1e-3, `${JSON.stringify(back[back.length - 1])}`);
    assert.equal(back[back.length - 1].seconds, -6 * 3600);
    assert.ok(out.some((p) => p.lat !== 40), 'the path bent');
    // The wind running out ends the path early; the longitude stays in -180..180 across the date line.
    const edge = integrateTrajectory({ lat: 0, lon: 0 }, (lat, lon) => (lon < 0.05 ? { u: 10, v: 0 } : null), { durationS: 7200, direction: 'forward' });
    assert.ok(edge.length > 1 && edge.length < 25);
    const dateLine = integrateTrajectory({ lat: 0, lon: 179.9 }, wind, { durationS: 7200, direction: 'forward' });
    assert.ok(dateLine.every((p) => p.lon >= -180 && p.lon <= 180) && dateLine[dateLine.length - 1].lon < 0);
});

test('a grid sampler interpolates in the cell and says nothing outside the grid, and frames blend in time', () => {
    const east_ = Float32Array.from(cells(proj, (_lat, lon) => (lon + 100)));
    const north_ = Float32Array.from(cells(proj, () => -2));
    const sample = gridWindSampler(proj, east_, north_);
    const w = sample(36.1, -97.3);
    assert.ok(close(w.u, 2.7, 0.01) && w.v === -2, `${w.u}`);
    assert.equal(sample(10, -97), null);
    assert.equal(sample(36, 20), null);
    const a = () => ({ u: 0, v: 0 });
    const b = () => ({ u: 10, v: 20 });
    const blend = blendInTime([0, 3600], [a, b]);
    assert.deepEqual(blend(0, 0, 1800), { u: 5, v: 10 });
    assert.deepEqual(blend(0, 0, -100), { u: 0, v: 0 });
    assert.deepEqual(blend(0, 0, 9000), { u: 10, v: 20 });
    assert.equal(blendInTime([0, 3600], [a, () => null])(0, 0, 100), null);
});
