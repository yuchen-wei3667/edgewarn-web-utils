import test from 'node:test';
import assert from 'node:assert/strict';
import { Hdf5File, Hdf5FormatError } from '../dist/goes/index.js';
import { buildHdf5 } from './helpers/hdf5-builder.mjs';

/** A byte source over a buffer that, like an HTTP range read, shortens a read at the end of the file. */
const source = (file, reads = []) => ({
    bytesFetched: 0,
    requests: 0,
    async read(offset, length) {
        reads.push([offset, length]);
        return file.subarray(offset, Math.min(file.length, offset + length));
    },
});

// A builder file has the layout the Met Office writes: v2 object headers, chunks behind a v1 B-tree, deflate.
const value = ([l, r, c]) => l * 100 + r * 10 + c + 0.5;
const slab = (level, rows, cols) => Float32Array.from({ length: rows * cols }, (_, k) => value([level, Math.floor(k / cols), k % cols]));
const cube = { name: 'air_temperature', dims: [3, 5, 7], chunk: [1, 4, 4], filters: ['deflate'], at: value, data: null };

test('the HDF5 reader returns one level of a chunked cube, including chunks that overhang its edge', async () => {
    for (const filters of [['deflate'], ['shuffle', 'deflate'], []]) {
        // Twelve chunks over a leaf of four: the B-tree has two levels, so the descent must stop at the level asked for.
        const file = buildHdf5([{ ...cube, filters }, { name: 'pressure', dims: [3], data: Float32Array.of(100000, 85000, 50000) }]);
        const h5 = await Hdf5File.open(source(file));
        const links = await h5.links();
        assert.deepEqual([...links.keys()], ['air_temperature', 'pressure']);
        const ds = await h5.dataset(links.get('air_temperature'));
        assert.deepEqual(ds.dims, [3, 5, 7]);
        for (let level = 0; level < 3; level++) assert.deepEqual([...await h5.floats(ds, level)], [...slab(level, 5, 7)], `level ${level} with ${filters}`);
        assert.deepEqual([...await h5.floats(await h5.dataset(links.get('pressure')))], [100000, 85000, 50000]);
    }
});

test('the HDF5 reader reads a whole chunked 2-D field and fetches neighbouring chunks together', async () => {
    const at = ([r, c]) => Math.sin(r * 0.7) * 100 + Math.cos(c * 1.3) * 50 + r * c;
    const file = buildHdf5([{ name: 'v', dims: [90, 100], chunk: [40, 40], filters: ['deflate'], at }], { leaf: 4 });
    const reads = [];
    const h5 = await Hdf5File.open(source(file, reads));
    const ds = await h5.dataset((await h5.links()).get('v'));
    const values = await h5.floats(ds);
    assert.deepEqual([...values], Array.from({ length: 9000 }, (_, k) => Math.fround(at([Math.floor(k / 100), k % 100]))));
    // The nine chunks lie back to back and arrive in one request; everything else is a header or B-tree node.
    assert.equal(reads.filter(([, n]) => n > 8192).length, 1, JSON.stringify(reads));
});

test('the HDF5 reader names what it does not support', async () => {
    await assert.rejects(Hdf5File.open(source(new Uint8Array(9000))), (e) => e instanceof Hdf5FormatError && /No HDF5 signature/.test(e.message));
    const file = buildHdf5([{ ...cube, filters: [] }]);
    file[8] = 0; // superblock version 0
    await assert.rejects(Hdf5File.open(source(file)), /Superblock v0 not supported/);
    const ints = buildHdf5([{ name: 'p', dims: [1], data: Float32Array.of(1) }]);
    const h5 = await Hdf5File.open(source(ints));
    const ds = await h5.dataset((await h5.links()).get('p'));
    await assert.rejects(h5.floats({ ...ds, type: { ...ds.type, size: 8 } }), /little-endian float32/);
});
