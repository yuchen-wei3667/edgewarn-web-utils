/**
 * NEXRAD Level III Tornado Vortex Signature product (NTV, product code 61) as
 * published on NOAA TGFTP. Plain TypeScript with no imports, so Node tests run it.
 *
 * The file is a WMO header (two lines ending `\r\r\n`), an 18-byte message
 * header, the product description block (radar latitude and longitude, in
 * thousandths of a degree) and a tabular alphanumeric block whose rows carry
 * each detection as text. The rows are read from that text, so a change in the
 * binary packets around it does not matter.
 */

export type TvsKind = 'TVS' | 'ETVS';

export interface TvsDetection {
    kind: TvsKind;
    /** Storm id the radar gave the detection, e.g. `B2`. */
    stormId: string;
    /** Scan time the radar gave the product, ms since the Unix epoch (UTC). */
    scanMs: number;
    lat: number;
    lon: number;
    azimuthDeg: number;
    rangeNm: number;
    /** Average, low-level and maximum delta velocity, in knots. */
    avgDvKt: number;
    lowLevelDvKt: number;
    maxDvKt: number;
    maxDvHeightKft: number;
    depthKft: number;
    baseKft: number;
    topKft: number;
    maxShearE3PerS: number;
    maxShearHeightKft: number;
}

export interface TvsProduct {
    radarLat: number;
    radarLon: number;
    /** Time of the message header, in ms since the Unix epoch. */
    issuedMs: number;
    /** The radar's own `Date/Time` of the scan the detections come from (UTC, ms); the issue time when absent. */
    scanMs: number;
    detections: TvsDetection[];
}

const HEADER_LINE_END = '\r\r\n';
const MESSAGE_HEADER_BYTES = 18;
const BLOCK_DIVIDER_BYTES = 2;
const TVS_PRODUCT_CODE = 61;
const MS_PER_DAY = 86_400_000;
const MS_PER_SECOND = 1000;
const THOUSANDTHS_PER_DEGREE = 1000;
const NM_TO_M = 1852;
const EARTH_RADIUS_M = 6_371_000;
const RADIANS = Math.PI / 180;

/** `Date/Time  10:21:26/00:22:53` is MM:DD:YY/HH:MM:SS in UTC. */
const DATE_TIME = /Date\/Time\s+(\d\d):(\d\d):(\d\d)\/(\d\d):(\d\d):(\d\d)/;
const NUM = '(-?\\d+(?:\\.\\d+)?)';
/** `TVS B2 320/ 36 35 51 51/ 2.7 > 5.3 < 2.7/ 8.0 22/ 2.7` */
const ROW = new RegExp(
    `\\b(ETVS|TVS)\\s+(\\S+)\\s+${NUM}\\/\\s*${NUM}\\s+${NUM}\\s+${NUM}\\s+${NUM}\\/\\s*${NUM}` +
        `\\s+[><]?\\s*${NUM}\\s+<?\\s*${NUM}\\/\\s*${NUM}\\s+${NUM}\\/\\s*${NUM}`,
    'g',
);

/** The point `rangeM` metres from `lat`/`lon` along `bearingDeg`, on a sphere. */
export function destinationPoint(
    lat: number,
    lon: number,
    bearingDeg: number,
    rangeM: number,
): { lat: number; lon: number } {
    const delta = rangeM / EARTH_RADIUS_M;
    const bearing = bearingDeg * RADIANS;
    const lat1 = lat * RADIANS;
    const lon1 = lon * RADIANS;
    const lat2 = Math.asin(
        Math.sin(lat1) * Math.cos(delta) + Math.cos(lat1) * Math.sin(delta) * Math.cos(bearing),
    );
    const lon2 =
        lon1 +
        Math.atan2(
            Math.sin(bearing) * Math.sin(delta) * Math.cos(lat1),
            Math.cos(delta) - Math.sin(lat1) * Math.sin(lat2),
        );
    return { lat: lat2 / RADIANS, lon: ((lon2 / RADIANS + 540) % 360) - 180 };
}

/** Parse one TGFTP NTV file. Returns null when the bytes are not a TVS product. */
export function parseTvsProduct(bytes: Uint8Array): TvsProduct | null {
    const text = new TextDecoder('latin1').decode(bytes);
    const first = text.indexOf(HEADER_LINE_END);
    if (first < 0) return null;
    const second = text.indexOf(HEADER_LINE_END, first + HEADER_LINE_END.length);
    if (second < 0) return null;
    const start = second + HEADER_LINE_END.length;
    if (bytes.length < start + MESSAGE_HEADER_BYTES + BLOCK_DIVIDER_BYTES + 8) return null;

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getInt16(start) !== TVS_PRODUCT_CODE) return null;
    // Days since 1970-01-01 counted from 1, then seconds into the day.
    const issuedMs = (view.getUint16(start + 2) - 1) * MS_PER_DAY + view.getUint32(start + 4) * MS_PER_SECOND;
    const description = start + MESSAGE_HEADER_BYTES + BLOCK_DIVIDER_BYTES;
    const radarLat = view.getInt32(description) / THOUSANDTHS_PER_DEGREE;
    const radarLon = view.getInt32(description + 4) / THOUSANDTHS_PER_DEGREE;

    // Control bytes inside the text block become spaces so rows read as lines.
    const printable = text.slice(start + MESSAGE_HEADER_BYTES).replace(/[^\x20-\x7e]/g, ' ');
    const stamp = DATE_TIME.exec(printable);
    const scanMs = stamp
        ? Date.UTC(
              2000 + Number(stamp[3]),
              Number(stamp[1]) - 1,
              Number(stamp[2]),
              Number(stamp[4]),
              Number(stamp[5]),
              Number(stamp[6]),
          )
        : issuedMs;
    const detections: TvsDetection[] = [];
    for (const match of printable.matchAll(ROW)) {
        const [, kind, stormId, az, ran, avgDv, llDv, mxDv, mxDvHgt, depth, base, top, shear, shearHgt] =
            match;
        const azimuthDeg = Number(az);
        const rangeNm = Number(ran);
        const point = destinationPoint(radarLat, radarLon, azimuthDeg, rangeNm * NM_TO_M);
        detections.push({
            kind: kind as TvsKind,
            stormId,
            scanMs,
            ...point,
            azimuthDeg,
            rangeNm,
            avgDvKt: Number(avgDv),
            lowLevelDvKt: Number(llDv),
            maxDvKt: Number(mxDv),
            maxDvHeightKft: Number(mxDvHgt),
            depthKft: Number(depth),
            baseKft: Number(base),
            topKft: Number(top),
            maxShearE3PerS: Number(shear),
            maxShearHeightKft: Number(shearHgt),
        });
    }
    return { radarLat, radarLon, issuedMs, scanMs, detections };
}

const LISTING_ROW = /href="(sn\.(?:\d{4}|last))">[^<]*<\/a><\/td><td[^>]*>\s*([^<]*?)\s*<\/td>/g;

/** The numbered products (and `sn.last`) in a TGFTP directory page, with the modified stamp shown beside each. */
export function parseTgftpListing(html: string): Array<{ name: string; stamp: string }> {
    return [...html.matchAll(LISTING_ROW)].map((match) => ({ name: match[1], stamp: match[2] }));
}

/** How long after a volume's start a product still counts as its own: the scan time is stamped when the volume ends. */
export const TVS_VOLUME_GRACE_MS = 60_000;

/**
 * The volume a scan belongs to: the latest one starting no later than the scan
 * (plus a minute of slack). `startsMs` is sorted ascending; -1 when the scan
 * is older than every volume.
 */
export function volumeIndexForScan(startsMs: readonly number[], scanMs: number): number {
    let found = -1;
    for (let i = 0; i < startsMs.length && startsMs[i] <= scanMs + TVS_VOLUME_GRACE_MS; i++) found = i;
    return found;
}

/** The TGFTP path piece for a station: `KTLX` becomes `ktlx`. */
export function tgftpStationId(siteId: string): string {
    return siteId.toLowerCase();
}
