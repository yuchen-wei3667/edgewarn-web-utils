import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import * as grib2 from '../dist/grib2/mrms/index.js';
import { decodeGrib2 } from '../dist/grib2/mrms/index.js';
import {
    buildPngGrib, buildSimpleGrib, buildPng, buildSections, chunkedStream, seededValues, section, wrapGrib,
} from './fixtures/mrms/grib2-builder.mjs';

function collector() {
    const rows = [];
    let grid = null;
    return {
        rows,
        get grid() { return grid; },
        sink: {
            begin(g) { grid = g; },
            row(y, src) { assert.equal(y, rows.length); rows.push(Array.from(src)); },
        },
    };
}

async function decodeAll(buf, chunk = 4096) {
    const c = collector();
    const { stream } = chunkedStream(buf, chunk);
    const res = await decodeGrib2(stream, c.sink);
    return { ...c, res };
}

function expectRows(rows, values, ni, nj) {
    assert.equal(rows.length, nj);
    for (let y = 0; y < nj; y++) assert.deepEqual(rows[y], values.slice(y * ni, (y + 1) * ni), `row ${y}`);
}

test('exports only decodeGrib2 at runtime', () => {
    assert.deepEqual(Object.keys(grib2), ['decodeGrib2']);
});

test('decodes every PNG filter type (0-4) and reports the file grid', async () => {
    const ni = 37, nj = 10;
    for (let ft = 0; ft <= 4; ft++) {
        const values = seededValues(ni * nj, 16, 10 + ft);
        const buf = buildPngGrib({ values, ni, nj, depth: 16, filterFor: () => ft, R: 5, E: 0, D: 1 });
        const { rows, grid } = await decodeAll(buf);
        expectRows(rows, values, ni, nj);
        assert.equal(grid.ni, ni);
        assert.equal(grid.nj, nj);
        assert.equal(grid.template, 41);
        assert.equal(grid.nbits, 16);
        assert.equal(grid.R, 5);
        assert.equal(grid.D, 1);
        assert.equal(grid.scanMode, 0);
        assert.ok(Math.abs(grid.lat1 - 54.995) < 1e-9);
        assert.ok(Math.abs(grid.lon1 - 230.005) < 1e-9);
        assert.ok(Math.abs(grid.dj - 0.01) < 1e-9);
        assert.equal(grid.refTime, '2026-10-11T01:04:40.000Z');
    }
});

test('mixed filters per row', async () => {
    const ni = 50, nj = 40;
    const values = seededValues(ni * nj, 16, 3);
    const { rows } = await decodeAll(buildPngGrib({ values, ni, nj }));
    expectRows(rows, values, ni, nj);
});

for (const [name, depth, ctype, bits] of [
    ['8-bit gray', 8, 0, 8],
    ['16-bit gray', 16, 0, 16],
    ['24-bit RGB', 8, 2, 24],
    ['32-bit RGBA', 8, 6, 32],
    ['1-bit gray', 1, 0, 1],
    ['2-bit gray', 2, 0, 2],
    ['4-bit gray', 4, 0, 4],
]) {
    test(`PNG ${name}`, async () => {
        const ni = 23, nj = 9;
        const values = seededValues(ni * nj, bits, 7);
        const buf = buildPngGrib({ values, ni, nj, depth, ctype });
        const { rows, grid } = await decodeAll(buf);
        assert.equal(grid.nbits, bits);
        expectRows(rows, values, ni, nj);
    });
}

test('multiple IDAT chunks', async () => {
    const ni = 64, nj = 64;
    const values = seededValues(ni * nj, 16, 9);
    const buf = buildPngGrib({ values, ni, nj, idatSplit: 97 });
    const { rows } = await decodeAll(buf, 33);
    expectRows(rows, values, ni, nj);
});

for (const nbits of [0, 12, 23, 30]) {
    test(`DRT 5.0 simple packing nbits=${nbits}`, async () => {
        const ni = 19, nj = 7;
        const values = nbits === 0 ? new Array(ni * nj).fill(0) : seededValues(ni * nj, nbits, 21);
        const { rows, grid } = await decodeAll(buildSimpleGrib({ values, ni, nj, nbits }));
        assert.equal(grid.template, 0);
        expectRows(rows, values, ni, nj);
    });
}

test('gzip and plain input decode identically', async () => {
    const ni = 31, nj = 12;
    const values = seededValues(ni * nj, 16, 5);
    const plain = (await decodeAll(buildPngGrib({ values, ni, nj }))).rows;
    const gz = (await decodeAll(buildPngGrib({ values, ni, nj, gzip: true }))).rows;
    assert.deepEqual(gz, plain);
    expectRows(gz, values, ni, nj);
});

test('survives 1-byte chunks, so every header byte straddles a boundary', async () => {
    const ni = 9, nj = 5;
    for (const [gzip, depth, ctype] of [[false, 16, 0], [true, 8, 2]]) {
        const bits = depth * (ctype === 2 ? 3 : 1);
        const values = seededValues(ni * nj, bits, 4);
        const { rows } = await decodeAll(buildPngGrib({ values, ni, nj, depth, ctype, gzip }), 1);
        expectRows(rows, values, ni, nj);
    }
    const values = seededValues(ni * nj, 12, 4);
    const { rows } = await decodeAll(buildSimpleGrib({ values, ni, nj, nbits: 12 }), 1);
    expectRows(rows, values, ni, nj);
});

test('a truncated stream rejects', async () => {
    const ni = 40, nj = 40;
    const buf = buildPngGrib({ values: seededValues(ni * nj, 16, 2), ni, nj });
    for (const cut of [10, 60, Math.floor(buf.length / 2), buf.length - 20]) {
        const { stream } = chunkedStream(buf.subarray(0, cut), 64);
        await assert.rejects(decodeGrib2(stream, collector().sink), /Unexpected end|PNG ended|overruns|incomplete|unexpected end/i, `cut at ${cut}`);
    }
    const gz = buildPngGrib({ values: seededValues(ni * nj, 16, 2), ni, nj, gzip: true });
    const { stream } = chunkedStream(gz.subarray(0, gz.length - 30), 64);
    await assert.rejects(decodeGrib2(stream, collector().sink));
});

test('rejects non-GRIB input and unsupported templates', async () => {
    await assert.rejects(decodeGrib2(chunkedStream(Buffer.from('this is not a grib file at all')).stream, collector().sink), /Not a GRIB file/);
    const ni = 4, nj = 4;
    const bad = wrapGrib([...buildSections({ ni, nj, template: 3, nbits: 8 }), section(7, Buffer.alloc(8))]);
    await assert.rejects(decodeGrib2(chunkedStream(bad).stream, collector().sink), /template 5\.3 not supported/);
});

test("'stop' after row r delivers no further rows, cancels the reader", async () => {
    const ni = 200, nj = 400;
    const values = seededValues(ni * nj, 16, 8);
    const buf = buildPngGrib({ values, ni, nj, filterFor: () => 0 });
    for (const stopAt of [0, 5, 100]) {
        const { stream, state } = chunkedStream(buf, 512);
        const seen = [];
        const res = await decodeGrib2(stream, {
            begin() {},
            row(y) { seen.push(y); if (y === stopAt) return 'stop'; },
            finish(info) { seen.push(`finish:${info.stopped}`); },
        });
        assert.deepEqual(seen.slice(-2), [stopAt, 'finish:true']);
        assert.equal(seen.length, stopAt + 2);
        assert.equal(res.stopped, true);
        assert.equal(res.rowsRead, stopAt + 1);
        assert.equal(state.cancelled, true);
    }
});

test("'stop' from begin skips the data section", async () => {
    const ni = 50, nj = 50;
    const buf = buildPngGrib({ values: seededValues(ni * nj, 16, 8), ni, nj });
    const { stream, state } = chunkedStream(buf, 128);
    let rows = 0;
    const res = await decodeGrib2(stream, { begin: () => 'stop', row() { rows++; } });
    assert.equal(rows, 0);
    assert.equal(res.stopped, true);
    assert.equal(state.cancelled, true);
});

test('an aborted signal rejects and cancels the stream', async () => {
    const ni = 100, nj = 300;
    const buf = buildPngGrib({ values: seededValues(ni * nj, 16, 8), ni, nj });
    const { stream, state } = chunkedStream(buf, 256);
    const ac = new AbortController();
    await assert.rejects(decodeGrib2(stream, {
        begin() {},
        row(y) { if (y === 3) ac.abort(); },
    }, { signal: ac.signal }), { name: 'AbortError' });
    assert.equal(state.cancelled, true);
});

test('a sink that throws rejects the decode', async () => {
    const ni = 20, nj = 20;
    const buf = buildPngGrib({ values: seededValues(ni * nj, 16, 8), ni, nj });
    await assert.rejects(decodeGrib2(chunkedStream(buf, 64).stream, {
        begin() {},
        row(y) { if (y === 2) throw new Error('sink boom'); },
    }), /sink boom/);
});

test('rejects when the PNG and grid sizes disagree', async () => {
    const png = buildPng(seededValues(8 * 8, 16, 1), 8, 8, { depth: 16 });
    const buf = wrapGrib([...buildSections({ ni: 9, nj: 8, template: 41, nbits: 16 }), section(7, png)]);
    await assert.rejects(decodeGrib2(chunkedStream(buf).stream, collector().sink), /≠ grid/);
});

test('streams a 7000×3500 field without allocating a grid-sized buffer', async () => {
    const ni = 7000, nj = 3500;
    // Gradient plus low-bit noise compresses roughly like real radar (~5-10:1) instead of 1000:1.
    const rowBytes = ni * 2;
    const deflate = zlib.createDeflate();
    const parts = [];
    deflate.on('data', (d) => parts.push(d));
    const row = Buffer.alloc(1 + rowBytes);
    let noise = 12345;
    for (let y = 0; y < nj; y++) {
        row[0] = 0;
        for (let x = 0; x < ni; x++) { noise = (Math.imul(noise, 1664525) + 1013904223) >>> 0; const v = (((x + y) & 0x3ff) << 6) | (noise >>> 26); row[1 + 2 * x] = v >> 8; row[2 + 2 * x] = v & 0xff; }
        if (!deflate.write(row)) await new Promise((r) => deflate.once('drain', r));
    }
    const ended = new Promise((r) => deflate.once('end', r));
    deflate.end();
    await ended;
    const idat = Buffer.concat(parts);
    // The decoder skips chunk CRCs (zlib's adler32 guards the payload), so the fixture leaves them zeroed.
    const crcless = (type, data) => { const n = Buffer.alloc(4); n.writeUInt32BE(data.length); return Buffer.concat([n, Buffer.from(type), data, Buffer.alloc(4)]); };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(ni, 0); ihdr.writeUInt32BE(nj, 4); ihdr[8] = 16; ihdr[9] = 0;
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crcless('IHDR', ihdr), crcless('IDAT', idat), crcless('IEND', Buffer.alloc(0))]);
    const buf = zlib.gzipSync(wrapGrib([...buildSections({ ni, nj, template: 41, nbits: 16 }), section(7, png)]));

    global.gc?.();
    const base = process.memoryUsage().arrayBuffers;
    let peak = 0, rows = 0, sum = 0;
    const { stream } = chunkedStream(buf, 16384);
    await decodeGrib2(stream, {
        begin() {},
        row(y, src) {
            rows++;
            sum += src[(y * 7) % ni];
            if (y % 50 === 0) peak = Math.max(peak, process.memoryUsage().arrayBuffers - base);
        },
    });
    assert.equal(rows, nj);
    assert.ok(sum > 0);
    // A full grid is 49 MB. Streaming should stay at stream-chunk scale.
    assert.ok(peak < 16 * 1024 * 1024, `arrayBuffers grew by ${(peak / 1048576).toFixed(1)} MB`);
});

test('rows equal the packed values the fixture was built from, for every fixture shape', async () => {
    const ni = 33;
    const nj = 21;
    const grid = (values) => Array.from({ length: nj }, (_, y) => values.slice(y * ni, (y + 1) * ni));
    const v = (bits, seed) => seededValues(ni * nj, bits, seed);
    const png16 = v(16, 1), png8 = v(8, 2), png24 = v(24, 3), png4 = v(4, 4), simple12 = v(12, 5), simple23 = v(23, 6);
    const cases = [
        { name: 'png16', buf: buildPngGrib({ values: png16, ni, nj }), want: grid(png16) },
        { name: 'png8', buf: buildPngGrib({ values: png8, ni, nj, depth: 8 }), want: grid(png8) },
        { name: 'png24', buf: buildPngGrib({ values: png24, ni, nj, depth: 8, ctype: 2 }), want: grid(png24) },
        { name: 'png4 gz', buf: buildPngGrib({ values: png4, ni, nj, depth: 4, gzip: true }), want: grid(png4) },
        { name: 'simple12', buf: buildSimpleGrib({ values: simple12, ni, nj, nbits: 12 }), want: grid(simple12) },
        { name: 'simple23 gz', buf: buildSimpleGrib({ values: simple23, ni, nj, nbits: 23, gzip: true }), want: grid(simple23) },
        { name: 'simple0', buf: buildSimpleGrib({ values: new Array(ni * nj).fill(0), ni, nj, nbits: 0 }), want: grid(new Array(ni * nj).fill(0)) },
    ];
    for (const { name, buf, want } of cases) {
        const { rows } = await decodeAll(buf, 1000);
        assert.deepEqual(rows, want, name);
    }
});