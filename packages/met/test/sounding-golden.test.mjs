import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { analyzeSounding } from '@edgewarn/web-utils/met';

/**
 * Golden science check (plan 5.1): nine synthetic physical columns analysed by SHARPpy (primary
 * reference, ADR-P5-4) and MetPy (loose cross-check). `tests/fixtures/sounding/make_golden.py`
 * wrote the fixture; this test needs no Python. A failure lists every parameter that left its
 * tolerance, with ours and the reference side by side.
 *
 * Tolerances (plan 5.1): CAPE ±max(25 J/kg, 3 %); LCL ±25 m; LFC/EL within two 5 hPa strips (both
 * libraries resolve them on a 5 hPa mesh); SRH ±max(5 m²/s², 3 %); Bunkers ±0.5 m/s; effective
 * layer ±10 hPa; composites ±max(0.1, 6 %). MetPy: CAPE ±max(250 J/kg, 10 %), lifted index ±0.5 °C.
 * Bunkers is the 2000 definition (plan 5.4), not SHARPpy's effective-layer variant, and the
 * lifted index is plain-temperature (MetPy), not SHARPpy's virtual-temperature `li5`.
 */
const golden = JSON.parse(readFileSync(new URL('./fixtures/golden.json', import.meta.url), 'utf8'));

const columnOf = (input) => ({
    validMs: 0,
    p: Float32Array.from(input.p),
    z: Float32Array.from(input.z),
    t: Float32Array.from(input.t),
    td: Float32Array.from(input.td),
    u: Float32Array.from(input.u),
    v: Float32Array.from(input.v),
    surface: { p: input.p[0], z: input.z[0], t: input.t[0], td: input.td[0], u: input.u[0], v: input.v[0] },
});

const STRIP_HPA = 5.001;
const abs = (tol) => () => tol;
const rel = (floor, frac) => (ref) => Math.max(floor, frac * Math.abs(ref));

/** Collects out-of-tolerance rows. `null` and 0 are the same answer for "no such quantity". */
function checker(failures, label) {
    return {
        near(name, ours, ref, tol, { nullMatchesZero = true } = {}) {
            if (ref === null || ref === undefined) {
                if (ours !== null && ours !== undefined && !(nullMatchesZero && ours === 0)) failures.push(`${label} ${name}: ours ${ours}, reference undefined`);
                return;
            }
            const o = ours ?? (nullMatchesZero ? 0 : null);
            if (o === null || Math.abs(o - ref) > tol(ref)) failures.push(`${label} ${name}: ours ${ours}, reference ${ref}, tolerance ${tol(ref).toFixed(3)}`);
        },
    };
}

for (const profile of golden.profiles) {
    test(`golden: ${profile.name} agrees with SHARPpy and MetPy`, () => {
        const a = analyzeSounding(columnOf(profile.input));
        const ref = profile.sharppy;
        const failures = [];
        const c = checker(failures, profile.name);

        for (const key of ['sb', 'ml', 'mu']) {
            const o = a.parcels[key];
            const r = ref.parcels[key];
            c.near(`${key} CAPE`, o.cape, r.cape, rel(25, 0.03));
            if (r.cape > 0) {
                c.near(`${key} CIN`, o.cin, r.cin, rel(10, 0.05));
                // SHARPpy reports the LAST upward crossing before the EL, ours the lowest (plan 5.4).
                // They differ only when an intermediate negative layer is trivially weak (|CIN| < 10).
                const ambiguousLfc = Math.abs(r.cin) < 10 && o.lfcP !== null && r.lfcP !== null && r.lfcP < o.lfcP;
                if (!ambiguousLfc) c.near(`${key} LFC p`, o.lfcP, r.lfcP, abs(STRIP_HPA * 2), { nullMatchesZero: false });
                c.near(`${key} EL p`, o.elP, r.elP, abs(STRIP_HPA * 2), { nullMatchesZero: false });
            }
            c.near(`${key} LCL AGL`, o.lclZagl, r.lclZagl, abs(25));
        }
        // MetPy: loose cross-check of CAPE and the sb lifted index (plain temperature)
        for (const key of ['sb', 'ml', 'mu']) {
            // MetPy has no virtual-temperature correction by default, which moves a 1000 J/kg
            // profile by ~200 J/kg; the check is a sanity bound, SHARPpy is the tight reference
            c.near(`${key} CAPE vs MetPy`, a.parcels[key].cape, profile.metpy[key].cape, rel(250, 0.1));
        }
        c.near('sb LI vs MetPy', a.parcels.sb.li, profile.metpy.sb.li, abs(0.5), { nullMatchesZero: false });

        const k = a.kinematics;
        const rk = ref.kinematics;
        c.near('0-1 km shear', k.shear01, rk.shear01, abs(0.2));
        c.near('0-3 km shear', k.shear03, rk.shear03, abs(0.2));
        c.near('0-6 km shear', k.shear06, rk.shear06, abs(0.2));
        c.near('ebwd', k.ebwd, rk.ebwd, abs(0.5), { nullMatchesZero: false });
        c.near('Bunkers RM u', k.bunkersRight?.u, rk.bunkersRight.u, abs(0.5));
        c.near('Bunkers RM v', k.bunkersRight?.v, rk.bunkersRight.v, abs(0.5));
        c.near('Bunkers LM u', k.bunkersLeft?.u, rk.bunkersLeft.u, abs(0.5));
        c.near('Bunkers LM v', k.bunkersLeft?.v, rk.bunkersLeft.v, abs(0.5));
        c.near('mean wind u', k.meanWind06?.u, rk.meanWind06.u, abs(0.2));
        c.near('mean wind v', k.meanWind06?.v, rk.meanWind06.v, abs(0.2));
        // 250 m sampling against SHARPpy's exact data levels: ~3 % apart at SRH near 400 m²/s²
        c.near('SRH 0-1', k.srh01, rk.srh01, rel(5, 0.03));
        c.near('SRH 0-3', k.srh03, rk.srh03, rel(5, 0.03));
        c.near('ESRH', k.esrh, rk.esrh, rel(5, 0.03), { nullMatchesZero: false });
        c.near('critical angle', k.criticalAngle, rk.criticalAngle, abs(2));

        if (ref.effInflow === null) {
            assert.equal(a.layers.effInflow, null, `${profile.name}: no effective inflow layer in the reference`);
        } else {
            assert.ok(a.layers.effInflow, `${profile.name}: effective inflow layer expected`);
            c.near('effective base', a.layers.effInflow.baseP, ref.effInflow.baseP, abs(10));
            c.near('effective top', a.layers.effInflow.topP, ref.effInflow.topP, abs(10));
        }

        const t = a.thermo;
        const rt = ref.thermo;
        c.near('PW', t.pw, rt.pw, abs(0.5));
        c.near('DCAPE', t.dcape, rt.dcape, rel(25, 0.1));
        c.near('LR 700-500', t.lr75, rt.lr75, abs(0.05));
        c.near('LR 850-500', t.lr85, rt.lr85, abs(0.05), { nullMatchesZero: false });
        c.near('K index', t.k, rt.k, abs(0.5), { nullMatchesZero: false });
        c.near('Total totals', t.tt, rt.tt, abs(0.5), { nullMatchesZero: false });

        const cm = a.composites;
        const rc = ref.composites;
        const tol = rel(0.1, 0.06);
        c.near('STP fixed', cm.stpFixed, rc.stpFixed, tol);
        c.near('STP effective', cm.stpEff, rc.stpEff, tol);
        c.near('SCP', cm.scp, rc.scp, tol);
        c.near('SHIP', cm.ship, rc.ship, tol);
        c.near('EHI 0-1', cm.ehi01, rc.ehi01, tol);
        c.near('EHI 0-3', cm.ehi03, rc.ehi03, tol);

        assert.deepEqual(failures, [], `\n${failures.join('\n')}`);
    });
}
