import test from 'node:test';
import assert from 'node:assert/strict';
import { cutTile, levelLayout } from '../dist/tiles.js';

test('global tile halos sample the opposite longitude edge', () => {
    const layout = levelLayout(0, 4, 1, [1]);
    const values = Uint16Array.from([10, 20, 30, 40]);
    const global = cutTile(values, layout, 0, 0, 1, true);
    const regional = cutTile(values, layout, 0, 0, 1);
    assert.deepEqual(Array.from(global.data.slice(global.width, 2 * global.width)), [40, 10, 20, 30, 40, 10]);
    assert.deepEqual(Array.from(regional.data.slice(regional.width, 2 * regional.width)), [10, 10, 20, 30, 40, 40]);
});
