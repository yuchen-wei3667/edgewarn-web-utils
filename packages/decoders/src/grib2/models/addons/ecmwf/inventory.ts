import type { IdxEntry } from '../../idx.ts';

/** Parameters ECMWF accumulates from the start of the run: the forecast column reads `0-N hour acc`. */
const ACCUMULATED: ReadonlySet<string> = new Set([
    'tp',
    'cp',
    'sf',
    'ro',
    'ssr',
    'ssrd',
    'str',
    'strd',
    'ttr',
    'ewss',
    'nsss',
]);
/** `mx2t3`, `mn2t6`: the maximum or minimum over the hours before the step, named by their length. */
const PERIOD_EXTREME = /^m([xn])\w+?(\d+)$/;

interface IndexRecord {
    param?: string;
    levtype?: string;
    levelist?: string | number;
    step?: string | number;
    /** Ensemble type (`cf` control, `pf` perturbed) and the perturbed member's number. */
    type?: string;
    number?: string | number;
    _offset?: number;
    _length?: number;
}

/**
 * The `level` column: pressure levels are written the NCEP way (`500 mb`) so a field is written once; every other
 * level type keeps ECMWF's own name (`sfc`, `sol 1`).
 */
function levelOf(rec: IndexRecord): string {
    if (rec.levtype === 'pl') return `${rec.levelist} mb`;
    return rec.levelist === undefined ? String(rec.levtype) : `${rec.levtype} ${rec.levelist}`;
}

/** A control message is member 0; a perturbed one carries its number. Deterministic inventories have neither. */
function memberOf(rec: IndexRecord): { member?: number } {
    if (rec.type === 'cf') return { member: 0 };
    const n = Number(rec.number);
    return rec.number !== undefined && Number.isInteger(n) ? { member: n } : {};
}

/** The forecast column, in the words the engine matches (`anl`, `6 hour fcst`, `0-6 hour acc fcst`, `3-6 hour max fcst`). */
function forecastOf(param: string, hours: number): string {
    if (ACCUMULATED.has(param)) return `0-${hours} hour acc fcst`;
    const period = PERIOD_EXTREME.exec(param);
    if (period && hours >= Number(period[2]))
        return `${hours - Number(period[2])}-${hours} hour ${period[1] === 'x' ? 'max' : 'min'} fcst`;
    return hours === 0 ? 'anl' : `${hours} hour fcst`;
}

/**
 * Parse an ECMWF open-data `.index` (one JSON object per message, with `_offset` and `_length`) into the rows a
 * wgrib2 `.idx` gives: the variable is ECMWF's short name (`2t`, `msl`, `t`), so a dataset's `idx.components` and
 * `idx.variables` name ECMWF parameters. Lines that are not messages (a blank line, an error body) are skipped.
 */
export function parseEcmwfIndex(text: string): IdxEntry[] {
    const out: IdxEntry[] = [];
    for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        let rec: IndexRecord;
        try {
            rec = JSON.parse(line) as IndexRecord;
        } catch {
            continue;
        }
        const { param, _offset: start, _length: length } = rec;
        if (!param || !Number.isFinite(start) || !Number.isFinite(length)) continue;
        out.push({
            variable: param,
            level: levelOf(rec),
            forecast: forecastOf(param, Number(rec.step ?? 0)),
            extra: rec.type === 'em' ? ['ens mean'] : rec.type === 'es' ? ['ens std dev'] : [],
            ...memberOf(rec),
            start: start!,
            end: start! + length! - 1,
        });
    }
    return out;
}
