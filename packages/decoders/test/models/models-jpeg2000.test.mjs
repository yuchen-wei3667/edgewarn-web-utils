import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { crc32 } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { decodeGrib2ToHalf } from '../../dist/grib2/models/grib2.js';
import { fromHalf } from '../../dist/grib2/models/half.js';
import { decodeCodestream } from '../../dist/grib2/models/addons/jpeg2000/codestream.js';
import { registerPacking, JPEG2000_TEMPLATE, decodeJpeg2000Field } from '../../dist/grib2/index.js';

/**
 * Real 5.40 messages from NOAA's buckets (measured 2026-11-01), each decoded to integer samples. `crc` is the CRC-32 of
 * the samples as little-endian int32 from OpenJPEG through Pillow, apart from the code under test. The wave field is
 * the case a land mask makes: a 565 460 x 1 image, wider than the 16 bits some OpenJPEG wrappers keep for a width.
 */
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'models', 'jpeg2000');
const CASES = [
    { file: 'rap-tmp2m-f06.grib2', width: 451, height: 337, precision: 10, crc: 0xddbde328, max: 695 },
    { file: 'rap-tmp925-f06.grib2', width: 451, height: 337, precision: 10, crc: 0x2c1659af, max: 647 },
    { file: 'cfs-tmp850-f018.grib2', width: 360, height: 181, precision: 10, crc: 0x3e3e28f4, max: 599 },
    { file: 'gfswave-htsgw-f006.grib2', width: 565460, height: 1, precision: 11, crc: 0x14a1866b, max: 1030 },
];

const message = (file) => new Uint8Array(readFileSync(path.join(DIR, file)));

/** Section 7 of a message, without its five-octet header. */
function section7(msg) {
    const dv = new DataView(msg.buffer, msg.byteOffset);
    for (let p = 16; !(msg[p] === 0x37 && msg[p + 1] === 0x37); p += dv.getUint32(p)) {
        if (msg[p + 4] === 7) return msg.subarray(p + 5, p + dv.getUint32(p));
    }
    throw new Error('no section 7');
}

for (const { file, width, height, precision, crc, max } of CASES) {
    test(`${file}: the code stream decodes to the samples OpenJPEG gives`, () => {
        const image = decodeCodestream(section7(message(file)));
        assert.equal(image.width, width);
        assert.equal(image.height, height);
        assert.equal(image.precision, precision);
        assert.equal(image.samples.length, width * height);
        assert.equal(crc32(Buffer.from(image.samples.buffer, image.samples.byteOffset, image.samples.byteLength)), crc);
        assert.equal(Math.max(...image.samples.subarray(0, 100000)) <= max, true);
    });
}

test('a message packed as 5.40 is refused until the source says jpeg2000', () => {
    try {
        decodeGrib2ToHalf(message('rap-tmp2m-f06.grib2'));
        assert.fail('decoded without the addon');
    } catch (error) {
        assert.match(String(error), /Data representation template 5\.40 not supported/);
    }
});

test('with jpeg2000 on the source, a real RAP message decodes through the GRIB2 reader', async () => {
    registerPacking(JPEG2000_TEMPLATE, decodeJpeg2000Field);
    // 2 m temperature: reference 261.7866 K, binary scale -4 (first samples 615, 616, 616, 616, 616 from the check above).
    const { grid, data } = decodeGrib2ToHalf(message('rap-tmp2m-f06.grib2'));
    assert.equal(grid.projection, 'lambert');
    assert.equal(grid.nx, 451);
    assert.equal(grid.ny, 337);
    const halfStep = (v) => Math.max(Math.abs(v), 2 ** -14) * 2 ** -11;
    [615, 616, 616, 616, 616].forEach((sample, i) => {
        const want = 261.7866516113281 + sample * 2 ** -4;
        assert.ok(Math.abs(fromHalf(data[i]) - want) <= halfStep(want) + 1e-6, `cell ${i}`);
    });
});

test('with a land mask, the wave field decodes every point of the 565 460 the message declares', async () => {
    registerPacking(JPEG2000_TEMPLATE, decodeJpeg2000Field);
    const { grid } = decodeGrib2ToHalf(message('gfswave-htsgw-f006.grib2'));
    assert.equal(grid.projection, 'latlon');
    assert.equal(grid.nx * grid.ny, 1440 * 721);
});

test('profiles the decoder does not follow are refused with the reason, not decoded wrongly', () => {
    const stream = Uint8Array.from(section7(message('cfs-tmp850-f018.grib2')));
    const cod = stream.findIndex((_, i) => stream[i] === 0xff && stream[i + 1] === 0x52);
    const withByte = (offset, value) => { const copy = Uint8Array.from(stream); copy[cod + offset] = value; return copy; };
    assert.throws(() => decodeCodestream(withByte(12, 0x01)), /code-block style/);
    assert.throws(() => decodeCodestream(withByte(13, 0)), /9\/7/);
    assert.throws(() => decodeCodestream(withByte(7, 2)), /several quality layers/);
    assert.throws(() => decodeCodestream(new Uint8Array([0, 1, 2, 3])), /Not a JPEG 2000 code stream/);
});