import test from 'node:test';
import assert from 'node:assert/strict';
import { packedOf, physicalOf } from '../dist/grib2/index.js';

const pack = { R: -100, E: 0, D: 1 };

test('physicalOf decodes Y = (R + X * 2^E) / 10^D', () => {
    assert.equal(physicalOf(0, pack), -10);
    assert.equal(physicalOf(1000, pack), 90);
    assert.equal(physicalOf(3, { R: 0, E: 1, D: 0 }), 6);
});

test('packedOf inverts physicalOf for representable values and is null otherwise', () => {
    for (const x of [0, 1, 17, 1000]) assert.equal(packedOf(physicalOf(x, pack), pack), x);
    assert.equal(packedOf(-10, pack), 0);
    assert.equal(packedOf(-10.05, pack), null, 'between two packed integers');
    assert.equal(packedOf(-11, pack), null, 'below the reference value');
    assert.equal(packedOf(5, { R: 0, E: 1, D: 0 }), null, 'odd value with a step of 2');
});
