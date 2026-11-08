import { Memory } from '../../internal/memory.ts';
/**
 * NEXRAD Level III digital radial products: super-resolution reflectivity (153, N0B..N3B) and velocity (154,
 * N0G..N3G), and the dual-pol ZDR (159, N0X..) and correlation coefficient (161, N0C..). All four hold one
 * 8-bit code per gate in a radial data array (packet 16), so they decode into the same `CutField` as a Level II
 * cut: code 0 is below threshold, code 1 is range folded, the rest map to values with `(code - offset) / scale`.
 *
 * The file is an optional WMO header (two lines ending `\r\r\n`), the 18-byte message header, the 102-byte product
 * description block and the symbology block, which these products bzip2-compress as one stream. Offsets below are
 * from the start of the message header; ICD 2620001, figures 3-6 and 3-15.
 */
import { Bzip2Decoder } from '../decoder/bzip2.ts';
import { buildAzimuthLut } from '../decoder/cutAssembler.ts';
import type { CutField } from '../decoder/cutAssembler.ts';

export interface Level3Header {
    productCode: number;
    vcp: number;
    /** 1-based number of the elevation cut in the volume (the Level II `elevationNumber`). */
    elevationNumber: number;
    /** Elevation angle in degrees, to a tenth. */
    elevation: number;
    /** Volume start, ms since the Unix epoch (UTC). */
    volumeStartMs: number;
    scale: number;
    offset: number;
    compressed: boolean;
    /** Size of the blocks after the description block once decompressed. */
    blocksBytes: number;
    /** Offset of the symbology block from the message header, in bytes. */
    symbologyOffset: number;
    /** Offset of the message header from the start of the file (the WMO lines). */
    messageStart: number;
}

const MESSAGE_HEADER_BYTES = 18;
const DESCRIPTION_BYTES = 102;
const WMO_LINE_END = '\r\r\n';
const MS_PER_DAY = 86_400_000;
const MS_PER_SECOND = 1000;
const GATE_SPACING_M = 250;
const RADIAL_PACKET = 16;
/** Products whose levels are given as an integer minimum and increment (tenths) rather than a float scale and offset. */
const THRESHOLD_PRODUCTS = new Set([153, 154]);
const NO_DATA_CODES = 2;

/** Offset of the message header: after the WMO header when the file has one. */
function messageStartOf(bytes: Uint8Array): number {
    // A message header starts with a product code (two bytes, small); the WMO header starts with a letter.
    if (bytes.length < 2 || bytes[0] < 0x20) return 0;
    let at = 0;
    for (let line = 0; line < 2; line++) {
        let found = -1;
        for (let i = at; i + WMO_LINE_END.length <= Math.min(bytes.length, 64); i++) {
            if (bytes[i] === 13 && bytes[i + 1] === 13 && bytes[i + 2] === 10) {
                found = i;
                break;
            }
        }
        if (found < 0) return -1;
        at = found + WMO_LINE_END.length;
    }
    return at;
}

/** Read the header of a Level III radial product from its first bytes (256 are enough). Null when it is not one. */
export function parseLevel3Header(bytes: Uint8Array): Level3Header | null {
    const start = messageStartOf(bytes);
    if (start < 0 || bytes.length < start + MESSAGE_HEADER_BYTES + DESCRIPTION_BYTES) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset + start, bytes.byteLength - start);
    const productCode = view.getInt16(0);
    if (view.getInt16(MESSAGE_HEADER_BYTES) !== -1) return null;
    // Halfword n of the message starts at byte 2 * (n - 1).
    const hw = (n: number) => view.getInt16(2 * (n - 1));
    const uhw = (n: number) => view.getUint16(2 * (n - 1));
    const word = (n: number) => view.getUint32(2 * (n - 1));
    const volumeStartMs = (uhw(21) - 1) * MS_PER_DAY + word(22) * MS_PER_SECOND;

    let scale: number;
    let offset: number;
    if (THRESHOLD_PRODUCTS.has(productCode)) {
        // Minimum value and increment, both x10; code 2 is the minimum.
        const increment = hw(32) / 10;
        if (!increment) return null;
        scale = 1 / increment;
        offset = NO_DATA_CODES - hw(31) / 10 / increment;
    } else {
        scale = view.getFloat32(2 * (31 - 1));
        offset = view.getFloat32(2 * (33 - 1));
        if (!scale) return null;
    }
    return {
        productCode,
        vcp: hw(18),
        elevationNumber: hw(29),
        elevation: hw(30) / 10,
        volumeStartMs,
        scale,
        offset,
        compressed: hw(51) === 1,
        blocksBytes: word(52),
        symbologyOffset: word(55) * 2,
        messageStart: start,
    };
}

/** The blocks after the description block, decompressed when the product is. */
function blocksOf(bytes: Uint8Array, header: Level3Header, memory: Memory): Uint8Array {
    const body = bytes.subarray(header.messageStart + header.symbologyOffset);
    if (!header.compressed) return body;
    const out = memory.array(Uint8Array, header.blocksBytes);
    let at = 0;
    const bzip = new Bzip2Decoder(memory);
    bzip.decode(body, (chunk) => {
        if (at + chunk.length > out.length) throw new Error('Level III block larger than declared');
        out.set(chunk, at);
        at += chunk.length;
    });
    if (at !== out.length) throw new Error('Level III block shorter than declared');
    return out;
}

/** Decode a whole product file into the cut it holds. */

export function decodeLevel3Radial(
    bytes: Uint8Array,
    moment: string,
): {
    header: Level3Header;
    field: CutField;
};
/** @internal */

export function decodeLevel3Radial(
    bytes: Uint8Array,
    moment: string,
    memory?: Memory,
): {
    header: Level3Header;
    field: CutField;
};
export function decodeLevel3Radial(
    bytes: Uint8Array,
    moment: string,
    memory = new Memory(),
): { header: Level3Header; field: CutField } {
    const header = parseLevel3Header(bytes);
    if (!header) throw new Error('Not a Level III radial product');
    const body = blocksOf(bytes, header, memory);
    const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
    // Symbology block: divider, id, length, layer count; then the layer: divider, length; then the packet.
    if (body.length < 30 || view.getInt16(0) !== -1 || view.getInt16(2) !== 1)
        throw new Error('Invalid Level III symbology block');
    if (view.getUint16(16) !== RADIAL_PACKET) throw new Error('Unsupported Level III packet');
    const firstBin = view.getUint16(18);
    const gates = view.getUint16(20);
    const rows = view.getUint16(28);
    if (!gates || !rows) throw new Error('Empty Level III radial array');

    const data = memory.array(Uint8Array, rows * gates);
    const azimuths = memory.array(Float32Array, rows);
    let at = 30;
    for (let r = 0; r < rows; r++) {
        if (at + 6 > body.length) throw new Error('Truncated Level III radial array');
        const count = view.getUint16(at);
        const startAngle = view.getUint16(at + 2) / 10;
        const delta = view.getUint16(at + 4) / 10;
        at += 6;
        if (at + count > body.length) throw new Error('Truncated Level III radial array');
        data.set(body.subarray(at, at + Math.min(count, gates)), r * gates);
        azimuths[r] = (startAngle + delta / 2) % 360;
        at += count + (count & 1);
    }
    const field: CutField = {
        moment,
        cut: header.elevationNumber,
        rows,
        gates,
        wordSize: 8,
        scale: header.scale,
        offset: header.offset,
        // Bin n spans n * 250 m to (n + 1) * 250 m; a gate is placed at its centre, as in Level II.
        firstGateMeters: (firstBin + 0.5) * GATE_SPACING_M,
        gateSpacingMeters: GATE_SPACING_M,
        data,
        azimuths,
        azimuthLut: buildAzimuthLut(azimuths, rows, memory),
        elevation: header.elevation,
        scanTimeMs: header.volumeStartMs,
        complete: true,
        sweepAzimuth: azimuths[rows - 1],
    };
    return { header, field };
}
