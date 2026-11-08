/** Grid + packing description taken from the file's own Sections 1, 3 and 5. */
export interface GridInfo {
    ni: number;
    nj: number;
    lat1: number;
    lon1: number;
    lat2: number;
    lon2: number;
    di: number;
    dj: number;
    /** GRIB2 scanning mode flags; MRMS uses 0 (west to east, north to south). */
    scanMode: number;
    R: number;
    E: number;
    D: number;
    nbits: number;
    /** Data representation template number (5.0 or 5.41). */
    template: number;
    /** ISO-8601 reference time from Section 1. */
    refTime: string;
}

/** One unfiltered row of packed integers. `src` is reused between calls, so copy what you keep. */
export type PackedRow = Uint16Array | Uint32Array;

export type SinkSignal = void | 'stop';

export interface RowSink {
    /** Called once, before the first row. Return 'stop' to skip the data section entirely. */
    begin(grid: GridInfo): SinkSignal | Promise<SinkSignal>;
    /** Called for each row, north to south for MRMS. Return 'stop' to end decoding and cancel the reader. */
    row(y: number, src: PackedRow): SinkSignal | Promise<SinkSignal>;
    /** Called once after the last row, or after a 'stop'. */
    finish?(info: { stopped: boolean; rowsRead: number }): void;
}

export interface DecodeOptions {
    signal?: AbortSignal;
}
