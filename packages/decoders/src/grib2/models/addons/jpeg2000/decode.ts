import { auditPacking } from '../../../../internal/audited.ts';
import { Memory } from '../../../../internal/memory.ts';
import type { PackedField, ValueSink } from '../../grib2.ts';
import { decodeCodestream } from './codestream.ts';

/** GRIB2 data representation template 5.40: JPEG 2000 code stream. */
export const JPEG2000_TEMPLATE = 40;

/** Packing decoder for template 5.40 (`registerPacking`). */

function decodeJpeg2000FieldImpl(field: PackedField, sink: ValueSink): void;
/** @internal */

function decodeJpeg2000FieldImpl(field: PackedField, sink: ValueSink, memory?: Memory): void;
function decodeJpeg2000FieldImpl(field: PackedField, sink: ValueSink, memory = new Memory()): void {
    const { s7, nValues, nbits, base, step } = field;
    // A constant field stores no code stream: every point is the reference value.
    if (nbits === 0) {
        for (let i = 0; i < nValues; i++) sink.value(base);
        return;
    }
    const { samples } = decodeCodestream(s7, memory);
    if (samples.length < nValues) throw new Error(`JPEG 2000 code stream holds ${samples.length} samples, the message declares ${nValues}`);
    for (let i = 0; i < nValues; i++) sink.value(base + samples[i] * step);
    memory.release(samples);
}

export const decodeJpeg2000Field = /* @__PURE__ */ auditPacking(decodeJpeg2000FieldImpl);
