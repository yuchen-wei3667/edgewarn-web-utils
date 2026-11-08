import type { ByteReader } from './byteReader.ts';
import type { PackedRow, RowSink } from './types.ts';
import type { SectionResult } from './png.ts';

/** DRT 5.0 (simple packing) decoded row by row. */
export async function decodeSimpleSection(
    rd: ByteReader,
    sectionBytes: number,
    nbits: number,
    width: number,
    height: number,
    sink: RowSink,
    signal: AbortSignal | undefined,
): Promise<SectionResult> {
    const outRow: PackedRow = nbits > 16 ? rd.memory.array(Uint32Array, width) : rd.memory.array(Uint16Array, width);
    let rowsRead = 0;
    const checkAbort = () => { if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError'); };
    const done = (stopped: boolean): SectionResult => ({ width, height, rowsRead, stopped });

    if (nbits === 0) { // constant field: every X = 0
        await rd.skip(sectionBytes);
        for (let y = 0; y < height; y++) {
            checkAbort();
            rowsRead = y + 1;
            if ((await sink.row(y, outRow)) === 'stop') return done(true);
        }
        return done(false);
    }

    let acc = 0, accBits = 0, x = 0, y = 0;
    const emit = async (): Promise<boolean> => {
        checkAbort();
        rowsRead = y + 1;
        const stop = (await sink.row(y, outRow)) === 'stop';
        x = 0;
        y++;
        return stop;
    };

    if (nbits <= 23) { // int32 fast path: acc stays < 2^31
        const mask = (1 << nbits) - 1;
        for await (const s of rd.take(sectionBytes)) {
            for (let i = 0; i < s.length && y < height; i++) {
                acc = ((acc << 8) | s[i]) & 0x7fffffff;
                accBits += 8;
                while (accBits >= nbits && y < height) {
                    accBits -= nbits;
                    outRow[x] = (acc >>> accBits) & mask;
                    if (++x === width && (await emit())) return done(true);
                }
            }
        }
    } else {
        const mask = nbits >= 32 ? 0xffffffff : (2 ** nbits) - 1;
        for await (const s of rd.take(sectionBytes)) {
            for (let i = 0; i < s.length && y < height; i++) {
                acc = (acc * 256 + s[i]) % 2 ** 53; // float math keeps up to 53 bits exact
                accBits += 8;
                while (accBits >= nbits && y < height) {
                    accBits -= nbits;
                    outRow[x] = Math.floor(acc / 2 ** accBits) & mask;
                    acc %= 2 ** accBits;
                    if (++x === width && (await emit())) return done(true);
                }
            }
        }
    }
    if (y < height) throw new Error(`Simple packing ended after ${y}/${height} rows`);
    return done(false);
}
