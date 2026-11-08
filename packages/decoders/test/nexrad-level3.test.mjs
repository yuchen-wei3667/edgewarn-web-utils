import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeLevel3Radial, parseLevel3Header } from '../dist/nexrad/level3/digitalRadial.js';

// Tiny products built to the ICD layout. VEL: product 154 with a WMO header and a bzip2-compressed symbology
// block, elevation cut 2 at 0.9 degrees, VCP 212, 4 radials x 6 bins. ZDR: product 159 with float scale and offset,
// no WMO header, no compression, 3 radials x 5 bins (odd, so each radial is padded) starting at bin 8.
const VEL = Uint8Array.from(Buffer.from(
    'U0RVUzU0IEtPVU4gMjAwMDA5DQ0KTjBHVExYDQ0KAJpRCwAAAogAAADoAAAAAAAD//8AAIoF//6EAgT9AJoAAADUAAAAAFELAAACPwAAAAAAAAAAAAAAAgAJ/YUABQD+AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAATgAAAAAAPAAAAAAAAAAAQlpoOTFBWSZTWZhLx5MAACdtFf8H4fgAAQABBAAABABAAIAAH6AAVFamEwEwmhkzIQmJPUPU0aGnqNGhdAG+REEDdzrBpvLmIdMWNTMZaEE8CEF1XbeNKLx79fDAB3HWdCQhHwti7kinChITCXjyYA==',
    'base64'));
const ZDR = Uint8Array.from(Buffer.from(
    'AJ9RCwAAAogAAAC6AAAAAAAD//8AAIoF//6EAgT9AJ8AAAAjAAAAAFELAAACPwAAAAAAAAAAAAAAAQAFQYAAAEMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQgAAAAAAPAAAAAAAAAAA//8AAQAAAEIAAf//AAAAMgAQAAgABQAAAAAD5wADAAUAAABkAAECAwQAAAUAZABkCgsMDQ4AAAUAyABkFBUWFxgA',
    'base64'));

test('header: description block read from the first 256 bytes', () => {
    const vel = parseLevel3Header(VEL.subarray(0, 256));
    assert.equal(vel.productCode, 154);
    assert.equal(vel.vcp, 212);
    assert.equal(vel.elevationNumber, 2);
    assert.equal(vel.elevation, 0.9);
    assert.equal(vel.volumeStartMs, Date.UTC(2026, 9, 20, 0, 9, 35));
    // Minimum -63.5 m/s and increment 0.5 m/s: code 2 is the minimum, i.e. (code - 129) / 2.
    assert.deepEqual([vel.scale, vel.offset, vel.compressed], [2, 129, true]);
    const zdr = parseLevel3Header(ZDR);
    assert.deepEqual([zdr.productCode, zdr.scale, zdr.offset, zdr.compressed, zdr.messageStart], [159, 16, 128, false, 0]);
    assert.equal(parseLevel3Header(VEL.subarray(0, 100)), null);
    assert.equal(parseLevel3Header(new Uint8Array(256)), null);
});

test('velocity: bzip2 block decodes into a cut field', () => {
    const { field } = decodeLevel3Radial(VEL, 'VEL');
    assert.deepEqual([field.moment, field.cut, field.rows, field.gates, field.wordSize, field.complete], ['VEL', 2, 4, 6, 8, true]);
    assert.deepEqual([...field.data], [0, 1, 2, 3, 4, 5, 12, 13, 14, 15, 16, 17, 22, 23, 24, 25, 26, 27, 255, 254, 253, 252, 251, 250]);
    // Radial centres: start angle plus half the 10 degree width.
    assert.deepEqual([...field.azimuths], [355, 5, 15, 25]);
    assert.deepEqual([field.firstGateMeters, field.gateSpacingMeters, field.elevation], [125, 250, 0.9]);
    assert.equal(field.scanTimeMs, Date.UTC(2026, 9, 20, 0, 9, 35));
    assert.equal(field.sweepAzimuth, 25);
    // Row of the radial nearest each azimuth.
    assert.equal(field.azimuthLut[3560], 0);
    assert.equal(field.azimuthLut[60], 1);
});

test('ZDR: float scale and offset, padded radials, first bin offset', () => {
    const { header, field } = decodeLevel3Radial(ZDR, 'ZDR');
    assert.deepEqual([header.scale, header.offset], [16, 128]);
    assert.deepEqual([field.rows, field.gates], [3, 5]);
    assert.deepEqual([...field.data], [0, 1, 2, 3, 4, 10, 11, 12, 13, 14, 20, 21, 22, 23, 24]);
    // Bin 8 spans 2000 to 2250 m: its centre is the Level II first gate of reflectivity.
    assert.equal(field.firstGateMeters, 2125);
    assert.equal(field.elevation, 0.5);
});

test('damaged products throw, and a wrong packet is refused', () => {
    assert.throws(() => decodeLevel3Radial(VEL.subarray(0, VEL.length - 20), 'VEL'));
    assert.throws(() => decodeLevel3Radial(ZDR.subarray(0, ZDR.length - 8), 'ZDR'), /Truncated/);
    const wrongPacket = ZDR.slice();
    wrongPacket[120 + 16 + 1] = 0x11; // low byte of the packet code: the symbology block starts at byte 120, the packet 16 bytes in
    assert.throws(() => decodeLevel3Radial(wrongPacket, 'ZDR'), /Unsupported Level III packet/);
    assert.throws(() => decodeLevel3Radial(new Uint8Array(300), 'ZDR'), /Not a Level III radial product/);
});

