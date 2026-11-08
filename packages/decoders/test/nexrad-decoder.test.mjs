import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NexradDecoder, readVcpFromPrefix } from '../dist/nexrad/decoder/decoder.js';
import { parseVcp } from '../dist/nexrad/decoder/vcp.js';
import { CutAssembler, buildAzimuthLut, AZIMUTH_MISSING } from '../dist/nexrad/decoder/cutAssembler.js';

const fixture = (name) => new Uint8Array(readFileSync(new URL(`./fixtures/nexrad/${name}`, import.meta.url)));
const synthetic = fixture('synthetic.ar2v');
const ktlxPrefix = fixture('ktlx-first-4k.bin');
// Must match make_synthetic.py
const code = (cut, row, gate) => (cut * 7 + row * 3 + gate) % 250 + 2;

function vcpOf(bytes) {
    const vcp = readVcpFromPrefix(bytes);
    assert.ok(vcp);
    return vcp;
}

test('VCP parses from a 4 KB prefix of a real volume', () => {
    const vcp = vcpOf(ktlxPrefix);
    assert.equal(vcp.cuts.length, 12);
    assert.deepEqual(vcp.cuts.slice(0, 6).map((c) => c.angle), [0.48, 0.48, 0.88, 0.88, 1.27, 1.27]);
    assert.deepEqual(vcp.cuts.map((c) => c.kind), ['S', 'D', 'S', 'D', 'S', 'D', 'B', 'B', 'B', 'B', 'B', 'B']);
    assert.throws(() => parseVcp(new Uint8Array(10)), /Truncated/);
});

test('azimuth LUT maps bins to rows and marks unswept azimuth', () => {
    const azimuths = Array.from({ length: 18 }, (_, i) => i * 10 + 0.5); // half the circle
    const lut = buildAzimuthLut(azimuths, 18);
    assert.equal(lut[5], 0);
    assert.equal(lut[1005], 10);
    assert.equal(lut[1795], 17);
    assert.equal(lut[2700], AZIMUTH_MISSING);
    const full = buildAzimuthLut(Array.from({ length: 36 }, (_, i) => i * 10 + 0.5), 36);
    assert.ok(full.every((v) => v !== AZIMUTH_MISSING));
    assert.equal(full[3599], 0); // wraps to row 0
});

test('CutAssembler ignores other cuts and caps rows', () => {
    const a = new CutAssembler('REF', 3);
    const radial = (n, status) => ({ elevationNumber: n, status, azimuth: 0, elevation: 1, timeMs: 5, moments: [{ name: 'REF', gates: 2, wordSize: 8, scale: 2, offset: 66, firstGateMeters: 0, gateSpacingMeters: 250, raw: Uint8Array.of(9, 9) }] });
    assert.equal(a.accept(radial(2, 2)), false);
    for (let i = 0; i < 900; i++) a.accept(radial(3, 1));
    assert.equal(a.rowCount, 800);
    assert.equal(a.accept(radial(3, 2)), true);
});