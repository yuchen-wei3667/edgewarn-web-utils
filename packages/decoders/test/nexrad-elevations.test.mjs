import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    ElevationAssembler, NexradDecoder, buildElevations, elevationMoments, momentReadiness, ownersOf, pickElevation, readVcpFromPrefix,
} from '../dist/nexrad/index.js';

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

test('real volume: three S/D pairs plus six standalone elevations', () => {
    const plans = buildElevations(vcpOf(ktlxPrefix));
    assert.equal(plans.length, 9);
    assert.deepEqual(plans.map((p) => p.paired), [true, true, true, false, false, false, false, false, false]);
    assert.deepEqual(plans[0].components.map((c) => c.cut), [1, 2]);
});

test('S/D pair despite different measured angles; SAILS repeat stays separate', () => {
    const vcp = vcpOf(synthetic);
    const plans = buildElevations(vcp);
    // cuts: S D B S D B  -> three elevations... S+D, B, S+D, B
    assert.deepEqual(plans.map((p) => p.components.map((c) => c.cut)), [[1, 2], [3], [4, 5], [6]]);
    assert.notEqual(plans[0].id, plans[2].id);
});

test('moment ownership, union of moments and readiness', () => {
    const plans = buildElevations(vcpOf(synthetic));
    const pair = plans[0];
    assert.deepEqual(ownersOf(pair, 'REF').map((c) => c.kind), ['S', 'D']);
    assert.deepEqual(ownersOf(pair, 'VEL').map((c) => c.kind), ['D']);
    assert.deepEqual(ownersOf(pair, 'ZDR').map((c) => c.kind), ['S']);
    assert.deepEqual(ownersOf(plans[1], 'ZDR').map((c) => c.kind), ['B']);
    assert.deepEqual(new Set(elevationMoments(pair)), new Set(['REF', 'ZDR', 'PHI', 'RHO', 'CFP', 'VEL', 'SW']));
    assert.equal(momentReadiness(pair, 'REF', new Set()), 'pending');
    assert.equal(momentReadiness(pair, 'REF', new Set([1])), 'provisional');
    assert.equal(momentReadiness(pair, 'REF', new Set([1, 2])), 'final');
    assert.equal(momentReadiness(pair, 'ZDR', new Set([1])), 'final');
    assert.equal(momentReadiness(pair, 'VEL', new Set([1])), 'pending');
});

test('cut selection by angle, ties to the earlier elevation', () => {
    const plans = buildElevations(vcpOf(synthetic));
    assert.equal(pickElevation(plans, 'REF', 0.5).id, 0);
    assert.equal(pickElevation(plans, 'REF', 1.4).id, 1);
    assert.equal(pickElevation(plans, 'VEL', 2.6).id, 3);
    assert.equal(pickElevation(plans, 'VEL', 0.0).id, 0);
});

function run(requests, bytes = synthetic) {
    const revisions = [];
    const incomplete = [];
    const progress = [];
    let assembler;
    const decoder = new NexradDecoder((radial) => assembler?.accept(radial), {
        onVcp: (vcp) => { assembler ??= new ElevationAssembler(vcp, requests, { onRevision: (r) => revisions.push(r), onIncomplete: (i) => incomplete.push(i), onProgress: (p) => progress.push(p) }); },
    });
    // Feed in small slices so the assembler sees a stream.
    for (let p = 0; p < bytes.length; p += 997) decoder.push(bytes.subarray(p, p + 997));
    decoder.finish();
    assembler.finish();
    return { revisions, incomplete, progress, assembler };
}

test('REF 8-bit S cut equals the generated reference; D replaces the whole field', () => {
    const { revisions } = run([{ elevationId: 0, moments: ['REF'] }]);
    assert.equal(revisions.length, 2);
    const [s, d] = revisions;
    assert.deepEqual([s.component, s.revision, s.provisional], ['S', 1, true]);
    assert.deepEqual([d.component, d.revision, d.provisional], ['D', 2, false]);
    assert.equal(s.field.gates, 40);
    assert.equal(d.field.gates, 20); // shorter range: no S tail kept
    assert.equal(s.field.rows, 36);
    for (const [rev, cut] of [[s, 1], [d, 2]]) {
        for (let row = 0; row < 36; row++) for (let g = 0; g < rev.field.gates; g++) {
            assert.equal(rev.field.data[row * rev.field.gates + g], code(cut, row, g));
        }
    }
    assert.equal(s.field.scale, 2);
    assert.equal(s.field.offset, 66);
    assert.equal(s.field.complete, true);
});

test('16-bit ZDR is native-order Uint16 with its own scale', () => {
    const { revisions } = run([{ elevationId: 0, moments: ['ZDR'] }]);
    assert.equal(revisions.length, 1);
    const f = revisions[0].field;
    assert.ok(f.data instanceof Uint16Array);
    assert.equal(f.wordSize, 16);
    assert.equal(f.scale, 16);
    assert.equal(f.data[5 * 20 + 3], code(1, 5, 3));
    assert.equal(revisions[0].provisional, false);
});

test('S-only moments stay available; Doppler moments wait for D', () => {
    const { revisions } = run([{ elevationId: 0, moments: ['VEL', 'RHO'] }]);
    const byMoment = Object.fromEntries(revisions.map((r) => [r.moment, r]));
    assert.equal(byMoment.RHO.component, 'S');
    assert.equal(byMoment.VEL.component, 'D');
    assert.equal(byMoment.VEL.field.cut, 2);
});

test('standalone elevation uses the batch cut', () => {
    const { revisions } = run([{ elevationId: 1, moments: ['REF', 'VEL'] }]);
    assert.deepEqual(revisions.map((r) => [r.moment, r.component, r.provisional]), [['REF', 'B', false], ['VEL', 'B', false]]);
});

test('SAILS occurrences stay separate', () => {
    const { revisions } = run([{ elevationId: 2, moments: ['REF'] }]);
    assert.deepEqual(revisions.map((r) => r.field.cut), [4, 5]);
});

test('progress follows the swept azimuth of the current cut', () => {
    const { progress } = run([{ elevationId: 0, moments: ['REF'] }]);
    const first = progress.filter((p) => p.cut === 1);
    assert.ok(first.length > 5);
    assert.equal(first[first.length - 1].fraction, 1);
    assert.ok(first.every((p, i) => i === 0 || p.fraction >= first[i - 1].fraction));
    assert.equal(progress.find((p) => p.cut === 2).component, 'D');
});

test('streaming stops being needed once the last wanted cut ends', () => {
    let assembler;
    const decoder = new NexradDecoder((r) => assembler?.accept(r), {
        onVcp: (vcp) => { assembler = new ElevationAssembler(vcp, [{ elevationId: 0, moments: ['VEL'] }], { onRevision() {} }); },
    });
    decoder.push(synthetic.subarray(0, 4000));
    assert.equal(assembler.lastNeededCut, 2);
    for (let p = 4000; p < synthetic.length && !assembler.finished; p += 500) decoder.push(synthetic.subarray(p, p + 500));
    assert.equal(assembler.finished, true);
});

test('a volume that ends before D keeps S as an explicit incomplete fallback', () => {
    // Cut the stream after the S record (record 2 of 7) so D never arrives.
    const bytes = synthetic;
    let end = 24;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < 2; i++) end += 4 + Math.abs(view.getInt32(end));
    const { revisions, incomplete } = runTruncated(bytes, end);
    assert.equal(revisions.length, 1);
    assert.equal(revisions[0].provisional, true);
    assert.deepEqual(incomplete, [{ elevationId: 0, moment: 'REF' }]);
});

function runTruncated(bytes, end) {
    const revisions = [];
    const incomplete = [];
    let assembler;
    const decoder = new NexradDecoder((r) => assembler?.accept(r), {
        onVcp: (vcp) => { assembler = new ElevationAssembler(vcp, [{ elevationId: 0, moments: ['REF'] }], { onRevision: (r) => revisions.push(r), onIncomplete: (i) => incomplete.push(i) }); },
    });
    decoder.push(bytes.subarray(0, end));
    assembler.finish();
    return { revisions, incomplete };
}

test('partials: the cut being received is offered when its rows change, S component only, with the sweep azimuth', () => {
    const vcp = vcpOf(synthetic);
    const assembler = new ElevationAssembler(vcp, [{ elevationId: 0, moments: ['REF'] }], { onRevision() {} });
    const radial = (cut, row, status) => ({
        elevationNumber: cut, status, azimuth: row * 10 + 0.5, elevation: 0.5, timeMs: 1,
        moments: [{ name: 'REF', gates: 4, wordSize: 8, scale: 2, offset: 66, firstGateMeters: 2125, gateSpacingMeters: 250, raw: Uint8Array.of(9, 9, 9, 9) }],
    });
    assert.deepEqual(assembler.partials(), []);
    for (let row = 0; row < 18; row++) assembler.accept(radial(1, row, row === 0 ? 0 : 1));
    const first = assembler.partials();
    assert.equal(first.length, 1);
    assert.equal(first[0].component, 'S');
    assert.equal(first[0].field.rows, 18);
    assert.equal(first[0].field.complete, false);
    assert.equal(first[0].field.sweepAzimuth, 170.5);
    assert.deepEqual(assembler.partials(), []); // unchanged
    for (let row = 18; row < 36; row++) assembler.accept(radial(1, row, row === 35 ? 2 : 1));
    // the S cut is complete; the D cut is a replacement of the whole field and is never offered
    for (let row = 0; row < 10; row++) assembler.accept(radial(2, row, row === 0 ? 0 : 1));
    assert.deepEqual(assembler.partials(), []);
});
