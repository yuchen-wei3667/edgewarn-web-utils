/** Volume coverage pattern (message type 5): which cuts a volume holds and how each is scanned. */

/** S = surveillance (REF + dual-pol), D = Doppler (REF + VEL/SW), B = batch/other cut with every moment. */
export type CutKind = 'S' | 'D' | 'B';

export interface VcpCut {
    /** 1-based; equals the radials' elevationNumber. */
    number: number;
    angle: number;
    waveform: number;
    kind: CutKind;
    superRes: number;
}

export interface Vcp {
    number: number;
    cuts: VcpCut[];
}

const HEADER_BYTES = 22;
const CUT_BYTES = 46;
const BAMS16_DEGREES = 360 / 65536;
const WAVEFORM_SURVEILLANCE = 1;
const WAVEFORM_DOPPLER = new Set([2, 3, 5]);

function cutKindOf(waveform: number): CutKind {
    if (waveform === WAVEFORM_SURVEILLANCE) return 'S';
    return WAVEFORM_DOPPLER.has(waveform) ? 'D' : 'B';
}

/** Moments a cut of this kind carries, by the 3-letter code used in the file. */
export function momentsOfKind(kind: CutKind): readonly string[] {
    if (kind === 'S') return ['REF', 'ZDR', 'PHI', 'RHO', 'CFP'];
    if (kind === 'D') return ['REF', 'VEL', 'SW'];
    return ['REF', 'VEL', 'SW', 'ZDR', 'PHI', 'RHO', 'CFP'];
}

/** `body` starts at the message header's end (record offset 28). */
export function parseVcp(body: Uint8Array): Vcp {
    if (body.length < HEADER_BYTES) throw new Error('Truncated VCP message');
    const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
    const number = view.getUint16(4);
    const count = view.getUint16(6);
    if (count < 1 || count > 25 || body.length < HEADER_BYTES + count * CUT_BYTES)
        throw new Error('Invalid VCP cut count');
    const cuts: VcpCut[] = [];
    for (let i = 0; i < count; i++) {
        const p = HEADER_BYTES + i * CUT_BYTES;
        const waveform = body[p + 3];
        cuts.push({
            number: i + 1,
            angle: Math.round(view.getUint16(p) * BAMS16_DEGREES * 100) / 100,
            waveform,
            kind: cutKindOf(waveform),
            superRes: body[p + 4],
        });
    }
    return { number, cuts };
}
