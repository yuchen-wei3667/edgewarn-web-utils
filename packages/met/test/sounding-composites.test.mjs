import test from 'node:test';
import assert from 'node:assert/strict';
import { stpFixed, stpEffective, scp, ship, ehi } from '@edgewarn/web-utils/met';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} vs ${expected}`);

test('fixed STP clamps the LCL and shear terms at their boundaries', () => {
    for (const [lcl, factor] of [[500, 1], [1000, 1], [1500, 0.5], [2000, 0], [2500, 0]]) {
        close(stpFixed(3000, lcl, 300, 30), 6 * factor);
    }
    for (const [shear, factor] of [[12.49, 0], [12.5, 0.625], [20, 1], [30, 1.5], [40, 1.5]]) {
        close(stpFixed(1500, 1000, 150, shear), factor);
    }
});

test('effective STP applies all LCL, shear and CIN limits, and cannot be negative', () => {
    for (const [cin, factor] of [[-250, 0], [-200, 0], [-100, 2 / 3], [-50, 1], [0, 1]]) {
        close(stpEffective(1500, 150, 20, 1000, cin), factor);
    }
    for (const [lcl, factor] of [[500, 1], [1000, 1], [1500, 0.5], [2000, 0], [2500, 0]]) {
        close(stpEffective(1500, 150, 20, lcl, -50), factor);
    }
    for (const [shear, factor] of [[12.49, 0], [12.5, 0.625], [30, 1.5], [40, 1.5]]) {
        close(stpEffective(1500, 150, shear, 1000, -50), factor);
    }
    assert.equal(stpEffective(1500, -150, 20, 1000, -50), 0);
});

test('SCP has a 10 m/s floor and a 20 m/s saturation boundary', () => {
    for (const [shear, expected] of [[5, 0], [9.99, 0], [10, 2], [15, 3], [20, 4], [25, 4]]) {
        close(scp(2000, 100, shear), expected);
    }
});

test('SHIP caps mixing ratio, temperature and shear and applies each small-value adjustment', () => {
    const base = 3000 * 13.6 * 9 * 10 * 27 / 42000000;
    close(ship(3000, 13.6, 9, -10, 27, 3000), base);
    close(ship(3000, 20, 9, -10, 40, 3000), base);
    close(ship(3000, 5, 9, -10, 5, 3000), 3000 * 11 * 9 * 10 * 7 / 42000000);
    for (const t of [-5.5, 0]) close(ship(3000, 13.6, 9, t, 27, 3000), base * 0.55);
    for (const cape of [650, 1300]) {
        close(ship(cape, 13.6, 9, -10, 27, 3000), base * cape / 3000 * Math.min(cape / 1300, 1));
    }
    for (const lr of [2.9, 5.8]) {
        close(ship(3000, 13.6, lr, -10, 27, 3000), base * lr / 9 * Math.min(lr / 5.8, 1));
    }
    for (const frz of [1200, 2400]) close(ship(3000, 13.6, 9, -10, 27, frz), base * Math.min(frz / 2400, 1));
});

test('EHI is CAPE times SRH divided by 160000', () => {
    assert.equal(ehi(2000, 100), 1.25);
    assert.equal(ehi(2000, -100), -1.25);
});

test('each composite propagates every missing or non-finite argument to null', () => {
    for (const [fn, args] of [
        [stpFixed, [3000, 500, 300, 25]],
        [stpEffective, [3000, 300, 25, 500, -50]],
        [scp, [2000, 100, 25]],
        [ship, [3000, 13.6, 9, -10, 27, 3000]],
        [ehi, [2000, 100]],
    ]) {
        for (let i = 0; i < args.length; i++) {
            for (const missing of [null, NaN, Infinity]) {
                const input = [...args];
                input[i] = missing;
                assert.equal(fn(...input), null, `${fn.name} argument ${i}`);
            }
        }
    }
});
