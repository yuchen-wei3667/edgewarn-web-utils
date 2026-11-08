import { Memory } from '../../internal/memory.ts';
import { ByteReader, maybeGunzip } from './byteReader.ts';
import { decodePngSection } from './png.ts';
import type { SectionResult } from './png.ts';
import { decodeSimpleSection } from './simple.ts';
import { makeGridInfo, o, parseSection1, parseSection3, parseSection5, u32 } from './sections.ts';
import type { Section3, Section5 } from './sections.ts';
import type { DecodeOptions, GridInfo, RowSink } from './types.ts';

/**
 * Stream a GRIB2 message (optionally gzipped) and push each unfiltered row of packed integers to
 * `sink`. Nothing is buffered beyond two PNG rows. The sink can return 'stop' from `begin` or `row`
 * to end decoding early; the underlying reader is then cancelled, which also stops the download.
 */

export function decodeGrib2(
    body: ReadableStream<Uint8Array>,
    sink: RowSink,
    options?: DecodeOptions,
): Promise<{
    grid: GridInfo;
    rowsRead: number;
    bytesRead: number;
    stopped: boolean;
}>;
/** @internal */

export function decodeGrib2(
    body: ReadableStream<Uint8Array>,
    sink: RowSink,
    options?: DecodeOptions,
    memory?: Memory,
): Promise<{
    grid: GridInfo;
    rowsRead: number;
    bytesRead: number;
    stopped: boolean;
}>;
export async function decodeGrib2(
    body: ReadableStream<Uint8Array>,
    sink: RowSink,
    options: DecodeOptions = {},
    memory = new Memory(),
): Promise<{ grid: GridInfo; rowsRead: number; bytesRead: number; stopped: boolean }> {
    const { signal } = options;
    const abortError = () => signal?.reason ?? new DOMException('Aborted', 'AbortError');
    if (signal?.aborted) {
        body.cancel(abortError()).catch(() => {});
        throw abortError();
    }

    const rd = new ByteReader(await maybeGunzip(body, memory, signal), memory);
    const onAbort = () => rd.cancel();
    signal?.addEventListener('abort', onAbort, { once: true });
    let result: SectionResult | null = null;
    let grid: GridInfo | null = null;
    try {
        const s0 = await rd.read(16);
        if (s0[0] !== 0x47 || s0[1] !== 0x52 || s0[2] !== 0x49 || s0[3] !== 0x42)
            throw new Error('Not a GRIB file');
        if (s0[7] !== 2) throw new Error(`GRIB edition ${s0[7]} not supported`);
        let refTime = '';
        let g3: Section3 | undefined;
        let d5: Section5 | undefined;

        for (;;) {
            const h = await rd.read(5);
            if (h[0] === 0x37 && h[1] === 0x37 && h[2] === 0x37 && h[3] === 0x37)
                throw new Error('No data section found');
            const len = u32(h, 0),
                num = h[4];
            if (len < 5) throw new Error('Invalid GRIB2 section length');
            if (num === 7) {
                if (!g3 || !d5) throw new Error('Section 7 before Sections 3/5');
                const info = makeGridInfo(g3, d5, refTime);
                grid = info;
                const begin = async (w: number, hgt: number) => {
                    if (w !== info.ni || hgt !== info.nj)
                        throw new Error(`Packed image ${w}×${hgt} ≠ grid ${info.ni}×${info.nj}`);
                    return sink.begin(info);
                };
                if (d5.template === 41) {
                    result = await decodePngSection(rd, len - 5, sink, signal, begin);
                } else if (d5.template === 0) {
                    if ((await begin(info.ni, info.nj)) === 'stop') {
                        result = { width: info.ni, height: info.nj, rowsRead: 0, stopped: true };
                    } else {
                        result = await decodeSimpleSection(
                            rd,
                            len - 5,
                            d5.nbits,
                            info.ni,
                            info.nj,
                            sink,
                            signal,
                        );
                    }
                } else {
                    throw new Error(`Data representation template 5.${d5.template} not supported`);
                }
                break;
            }
            const section = memory.array(Uint8Array, len);
            section.set(h, 0);
            section.set(await rd.read(len - 5), 5); // keep 1-based octet math honest
            if (num === 1) refTime = parseSection1(section).refTime;
            else if (num === 3) g3 = parseSection3(section);
            else if (num === 5) d5 = parseSection5(section);
            else if (num === 6 && section[o(6)] !== 255)
                throw new Error('Bitmaps not supported (MRMS does not use them)');
            memory.release(section);
        }
        if (signal?.aborted) throw abortError();
        sink.finish?.({ stopped: result.stopped, rowsRead: result.rowsRead });
        return { grid, rowsRead: result.rowsRead, bytesRead: rd.consumed, stopped: result.stopped };
    } finally {
        signal?.removeEventListener('abort', onAbort);
        rd.cancel(); // stop downloading anything after message 1 (or after an early stop)
    }
}
