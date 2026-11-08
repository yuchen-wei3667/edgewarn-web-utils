import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Bzip2Decoder } from '../dist/nexrad/decoder/bzip2.js';
import { NexradDecoder, MessageDecoder, materialize, sample } from '../dist/nexrad/decoder/decoder.js';
import { fixtures } from './fixtures/nexrad/core-fixtures.mjs';
const archive = Buffer.from(fixtures.archive, 'base64');
const record = Buffer.from(fixtures.record, 'base64');
function decode(bytes) {
    const parts = [];
    new Bzip2Decoder().decode(bytes, a => parts.push(a.slice()));
    return Buffer.concat(parts);
}
test('bzip2 empty stream, all byte values, RLE expansion, multiple BWT blocks', () => {
    assert.equal(decode(Buffer.from(fixtures.empty, 'base64')).length, 0);
    assert.deepEqual(decode(Buffer.from(fixtures.allBytes, 'base64')), Buffer.from(Array.from({ length: 5120 }, (_, i) => i % 256)));
    assert.deepEqual(decode(Buffer.from(fixtures.longRun, 'base64')), Buffer.alloc(1100000, 88));
    const expected = Buffer.from(Array.from({ length: 1200000 }, (_, i) => (i * 17 + Math.floor(i / 256) * 31) % 256));
    assert.deepEqual(decode(Buffer.from(fixtures.multiBlock, 'base64')), expected);
});
test('all possible two-packet splits and single-byte delivery produce identical gates', () => {
    for (let split = 0; split <= archive.length; split++) {
        let values;
        const d = new NexradDecoder(r => { values = materialize(r.moments[0]); });
        d.push(archive.subarray(0, split));
        d.push(archive.subarray(split));
        d.finish();
        assert.deepEqual(values, new Float32Array([NaN, -Infinity, -32, 0, 17]));
        assert.equal(d.parser.radials, 1);
    }
    const d = new NexradDecoder(() => { });
    for (const byte of archive)
        d.push(Uint8Array.of(byte));
    d.finish();
    assert.equal(d.parser.radials, 1);
});
test('all truncations fail; failed CRC never exposes radials', () => {
    for (let n = 0; n < archive.length; n++) {
        const d = new NexradDecoder(() => { });
        d.push(archive.subarray(0, n));
        assert.throws(() => d.finish());
    }
    let emitted = 0;
    const corrupt = Buffer.from(archive);
    corrupt[38] ^= 1; // first block CRC
    const d = new NexradDecoder(() => emitted++);
    assert.throws(() => d.push(corrupt), /CRC/);
    assert.equal(emitted, 0);
    assert.throws(() => d.push(archive), /failed/);
    const combined = Buffer.from(archive);
    combined[combined.length - 2] ^= 8;
    const c = new NexradDecoder(() => emitted++);
    assert.throws(() => c.push(combined));
    assert.equal(emitted, 0);
});
test('bad header, record limit, expansion limit and trailing bzip2 data rejected', () => {
    const bad = Buffer.from(archive);
    bad[0] = 0;
    assert.throws(() => new NexradDecoder(() => { }).push(bad), /header/);
    assert.throws(() => new NexradDecoder(() => { }, { maxCompressedRecordBytes: 64 }).push(archive), /size|limit/);
    assert.throws(() => new NexradDecoder(() => { }, { maxDecodedRecordBytes: 32 }).push(archive), /limit/);
    assert.throws(() => decode(Buffer.concat([Buffer.from(fixtures.empty, 'base64'), Buffer.from([0])])), /Trailing/);
});
test('message fragmentation, metadata, 16-bit moments and missing/folded scaling', () => {
    const wide = record.slice(0, record.length - 6);
    const full = Buffer.concat([wide, Buffer.from([0, 0, 0, 1, 0, 2, 1, 0, 255, 255])]);
    full[28 + 36 + 19] = 16;
    full.writeUInt16BE((full.length - 12) / 2, 12);
    full.writeUInt16BE(full.length - 28, 28 + 18);
    let seen;
    const d = new MessageDecoder(r => {
        seen = r;
        assert.equal(r.station, 'KTLX');
        assert.equal(r.azimuth, 123.5);
        assert.equal(r.moments[0].firstGateMeters, -125);
        assert.deepEqual(materialize(r.moments[0]), new Float32Array([NaN, -Infinity, -32, 95, 32734.5]));
        assert.throws(() => sample(r.moments[0], 5), RangeError);
    });
    for (const byte of full)
        d.push(Uint8Array.of(byte));
    d.finish();
    assert.ok(seen);
});
test('malformed pointers, word sizes, scale, legacy records and segmentation reject', () => {
    const mutations = [
        (b) => b.writeUInt32BE(99999, 28 + 32),
        (b) => b[28 + 36 + 19] = 32,
        (b) => b.writeFloatBE(0, 28 + 36 + 20),
        (b) => b.writeUInt16BE(2, 24),
    ];
    for (const mutate of mutations) {
        const b = Buffer.from(record);
        mutate(b);
        assert.throws(() => new MessageDecoder(() => { }).push(b));
    }
    const legacy = Buffer.alloc(2432);
    legacy[15] = 1;
    assert.throws(() => new MessageDecoder(() => { }).push(legacy), /Legacy/);
});
test('stream emits before finish; callbacks cannot reenter and finished streams reject writes', () => {
    let count = 0;
    const d = new NexradDecoder(() => { count++; assert.throws(() => d.push(archive), /reentered/); });
    d.push(archive);
    assert.equal(count, 1);
    d.finish();
    assert.throws(() => d.push(archive), /finished/);
    const noEnd = Buffer.from(record);
    noEnd[28 + 21] = 1;
    const p = new MessageDecoder(() => { });
    p.push(noEnd);
    p.finish();
    assert.equal(p.volumeEnded, false);
});
