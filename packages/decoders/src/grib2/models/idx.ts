/** One line of a wgrib2-style `.idx` inventory with its resolved byte range. */
export interface IdxEntry {
    variable: string;
    level: string;
    /** Column 6, the forecast column: `6 hour fcst`, `315 min fcst`, `5-6 hour max fcst`. */
    forecast: string;
    /**
     * Columns 7 onwards, kept verbatim because `.idx` files are not always six columns wide.
     * RRFS's `2dfld` files carry probabilistic components (`prob >1:prob fcst 0/1`) and REFS's
     * `prob` file repeats one variable/level/forecast triple once per threshold — up to seven times
     * for `VIS|surface|1 hour fcst`. Dropping these columns makes those indistinguishable.
     */
    extra: readonly string[];
    /** Ensemble member the message belongs to (0 = control), for inventories that hold several members. */
    member?: number;
    start: number;
    /** Inclusive end byte; null for the last message in the file. */
    end: number | null;
}

/** Parse `n:offset:d=YYYYMMDDHH:VAR:LEVEL:FORECAST[:extra...]` lines into byte ranges. */
export function parseIdx(text: string): IdxEntry[] {
    const out: IdxEntry[] = [];
    for (const line of text.split('\n')) {
        if (!line) continue;
        const parts = line.split(':');
        if (parts.length < 6) continue;
        // Every wgrib2 record ends in a colon, so the split leaves one empty trailing field that is
        // not a column. Dropping it keeps `extra` free of a phantom "" that would shadow a qualifier.
        if (parts[parts.length - 1] === '') parts.pop();
        out.push({
            variable: parts[3],
            level: parts[4],
            forecast: parts[5],
            extra: parts.length > 6 ? parts.slice(6) : [],
            start: Number(parts[1]),
            end: null,
        });
    }
    // Several submessages can share an offset (e.g. UGRD/VGRD pairs); end is the next distinct offset.
    let nextStart: number | null = null;
    for (let i = out.length - 1; i >= 0; i--) {
        out[i].end = nextStart === null ? null : nextStart - 1;
        if (i === 0 || out[i - 1].start !== out[i].start) nextStart = out[i].start;
    }
    return out;
}
