/** NOAA TGFTP helpers for the live TVS product (the product parsing itself is `parseTvsProduct` in `/nexrad`). */

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
