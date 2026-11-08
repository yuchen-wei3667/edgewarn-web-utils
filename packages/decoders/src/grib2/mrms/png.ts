import type { ByteReader } from './byteReader.ts';
import { u32 } from './sections.ts';
import type { PackedRow, RowSink } from './types.ts';

export interface SectionResult {
    width: number;
    height: number;
    rowsRead: number;
    stopped: boolean;
}

function unfilter(ft: number, c: Uint8Array, p: Uint8Array, bpp: number, n: number): void {
    switch (ft) {
        case 0:
            return;
        case 1:
            for (let i = bpp; i < n; i++) c[i] = c[i] + c[i - bpp];
            return;
        case 2:
            for (let i = 0; i < n; i++) c[i] = c[i] + p[i];
            return;
        case 3:
            for (let i = 0; i < bpp; i++) c[i] = c[i] + (p[i] >> 1);
            for (let i = bpp; i < n; i++) c[i] = c[i] + ((c[i - bpp] + p[i]) >> 1);
            return;
        case 4:
            for (let i = 0; i < bpp; i++) c[i] = c[i] + p[i]; // paeth(0, up, 0) = up
            for (let i = bpp; i < n; i++) {
                const a = c[i - bpp],
                    b = p[i],
                    cc = p[i - bpp];
                const pa = Math.abs(b - cc),
                    pb = Math.abs(a - cc),
                    pc = Math.abs(a + b - 2 * cc);
                c[i] = c[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : cc);
            }
            return;
        default:
            throw new Error(`Bad PNG filter type ${ft}`);
    }
}

/** GRIB2 PNG packing stores X big-endian across all channels of a pixel. */
function unpackRow(b: Uint8Array, out: PackedRow, w: number, depth: number, ch: number): void {
    const bits = depth * ch;
    if (bits === 16) {
        for (let x = 0, j = 0; x < w; x++, j += 2) out[x] = (b[j] << 8) | b[j + 1];
        return;
    }
    if (bits === 8) {
        for (let x = 0; x < w; x++) out[x] = b[x];
        return;
    }
    if (bits === 24) {
        for (let x = 0, j = 0; x < w; x++, j += 3) out[x] = (b[j] << 16) | (b[j + 1] << 8) | b[j + 2];
        return;
    }
    if (bits === 32) {
        for (let x = 0, j = 0; x < w; x++, j += 4)
            out[x] = ((b[j] << 24) >>> 0) + (b[j + 1] << 16) + (b[j + 2] << 8) + b[j + 3];
        return;
    }
    // 1/2/4-bit grayscale
    const per = 8 / bits,
        mask = (1 << bits) - 1;
    for (let x = 0; x < w; x++) out[x] = (b[(x / per) | 0] >> ((per - 1 - (x % per)) * bits)) & mask;
}

/**
 * Decode a DRT 5.41 Section 7 (one PNG image) and push each unfiltered row to the sink.
 * `onBegin` receives the PNG's own dimensions before any row so the caller can validate them
 * against the grid and start the sink.
 */
export async function decodePngSection(
    rd: ByteReader,
    sectionBytes: number,
    sink: RowSink,
    signal: AbortSignal | undefined,
    onBegin: (width: number, height: number) => Promise<'stop' | void>,
): Promise<SectionResult> {
    let left = sectionBytes;
    const need = async (n: number) => {
        left -= n;
        if (left < 0) throw new Error('PNG overruns Section 7');
        return rd.read(n);
    };

    const sig = await need(8);
    if (sig[0] !== 0x89 || sig[1] !== 0x50) throw new Error('Section 7 is not a PNG stream');

    let hdr = await need(8);
    let len = u32(hdr, 0);
    if (String.fromCharCode(hdr[4], hdr[5], hdr[6], hdr[7]) !== 'IHDR') throw new Error('PNG missing IHDR');
    const ih = await need(len + 4);
    const width = u32(ih, 0),
        height = u32(ih, 4),
        depth = ih[8],
        ctype = ih[9],
        interlace = ih[12];
    if (interlace) throw new Error('Interlaced PNG not supported');
    const channels = ctype === 0 ? 1 : ctype === 2 ? 3 : ctype === 6 ? 4 : ctype === 4 ? 2 : 0;
    if (!channels) throw new Error(`PNG color type ${ctype} not supported`);
    const bitsPP = depth * channels;
    const bpp = Math.max(1, bitsPP >> 3); // filter byte distance
    const rowBytes = Math.ceil((width * bitsPP) / 8);

    if ((await onBegin(width, height)) === 'stop') return { width, height, rowsRead: 0, stopped: true };

    const outRow: PackedRow =
        bitsPP > 16 ? rd.memory.array(Uint32Array, width) : rd.memory.array(Uint16Array, width);
    let prev = rd.memory.array(Uint8Array, rowBytes),
        cur = rd.memory.array(Uint8Array, rowBytes);

    let stopped = false;
    let rowsRead = 0;
    const ds = new DecompressionStream('deflate');
    const writer = ds.writable.getWriter();
    const inflated = ds.readable.getReader();
    const halt = () => {
        stopped = true;
        inflated.cancel().catch(() => {});
        writer.abort().catch(() => {});
    };
    const onAbort = () => halt();
    if (signal) {
        if (signal.aborted) halt();
        else signal.addEventListener('abort', onAbort, { once: true });
    }

    // Native inflate: feed IDAT payloads in, drain rows out, concurrently (avoids backpressure deadlock).
    const feed = (async () => {
        try {
            while (left > 0 && !stopped) {
                hdr = await need(8);
                len = u32(hdr, 0);
                const t = String.fromCharCode(hdr[4], hdr[5], hdr[6], hdr[7]);
                left -= len + 4;
                if (left < 0) throw new Error('PNG chunk overruns Section 7');
                if (t === 'IDAT') {
                    for await (const s of rd.take(len)) {
                        if (stopped) return;
                        await writer.ready;
                        writer.write(s as BufferSource).catch(() => {});
                    }
                    await rd.skip(4); // CRC: zlib's adler32 already guards the payload
                } else {
                    await rd.skip(len + 4);
                    if (t === 'IEND') break;
                }
            }
            if (stopped) return;
            if (left > 0) await rd.skip(left); // trailing pad inside Section 7, if any
            await writer.close();
        } catch (e) {
            if (stopped) return;
            writer.abort(e).catch(() => {});
            throw e;
        }
    })();

    const drain = (async () => {
        try {
            let y = 0,
                pos = -1,
                ft = 0; // pos -1 = waiting for filter byte
            for (;;) {
                const { value: c, done } = await inflated.read();
                if (done) break;
                let i = 0;
                const n = c.length;
                while (i < n && y < height) {
                    if (pos < 0) {
                        ft = c[i++];
                        pos = 0;
                        continue;
                    }
                    const k = Math.min(rowBytes - pos, n - i);
                    cur.set(c.subarray(i, i + k), pos);
                    pos += k;
                    i += k;
                    if (pos === rowBytes) {
                        unfilter(ft, cur, prev, bpp, rowBytes);
                        unpackRow(cur, outRow, width, depth, channels);
                        const t = prev;
                        prev = cur;
                        cur = t;
                        y++;
                        pos = -1;
                        rowsRead = y;
                        if ((await sink.row(y - 1, outRow)) === 'stop') {
                            halt();
                            return;
                        }
                        if (stopped) return;
                    }
                }
                if (y >= height) break;
            }
            if (!stopped && rowsRead !== height)
                throw new Error(`PNG ended after ${rowsRead}/${height} rows`);
        } catch (e) {
            if (!stopped) {
                stopped = true;
                writer.abort(e).catch(() => {});
            }
            throw e;
        }
    })();

    try {
        await Promise.all([feed, drain]);
    } catch (error) {
        halt();
        rd.cancel();
        await Promise.allSettled([feed, drain]);
        throw error;
    } finally {
        signal?.removeEventListener('abort', onAbort);
    }
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    return { width, height, rowsRead, stopped };
}
