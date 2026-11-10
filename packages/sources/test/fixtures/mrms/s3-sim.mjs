/** Minimal ListObjectsV2 simulator that emits the same XML shape as the recorded fixtures. */
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export function makeS3(keys, { pageSize = 1000 } = {}) {
    const sorted = [...keys].sort();
    const requests = [];
    const fetcher = async (url) => {
        const u = new URL(url);
        requests.push(u.search);
        const prefix = u.searchParams.get('prefix') ?? '';
        const delimiter = u.searchParams.get('delimiter');
        const startAfter = u.searchParams.get('start-after') ?? '';
        const token = u.searchParams.get('continuation-token');
        const max = Math.min(pageSize, Number(u.searchParams.get('max-keys') ?? 1000));
        let after = startAfter;
        if (token) after = Buffer.from(token, 'base64url').toString();
        // Like S3, resuming after a common prefix skips everything inside it.
        const matching = sorted.filter((k) => k.startsWith(prefix) && k > after && !(delimiter && after.endsWith(delimiter) && k.startsWith(after)));
        let body = '';
        let last = '';
        let count = 0;
        const seenPrefixes = new Set();
        let truncated = false;
        for (const k of matching) {
            if (delimiter) {
                const rest = k.slice(prefix.length);
                const i = rest.indexOf(delimiter);
                if (i >= 0) {
                    const cp = prefix + rest.slice(0, i + 1);
                    if (seenPrefixes.has(cp)) continue;
                    if (count >= max) { truncated = true; break; }
                    seenPrefixes.add(cp);
                    body += `<CommonPrefixes><Prefix>${esc(cp)}</Prefix></CommonPrefixes>`;
                    last = cp; count++;
                    continue;
                }
            }
            if (count >= max) { truncated = true; break; }
            body += `<Contents><Key>${esc(k)}</Key><Size>1</Size></Contents>`;
            last = k; count++;
        }
        const next = truncated ? `<NextContinuationToken>${Buffer.from(last).toString('base64url')}</NextContinuationToken>` : '';
        const xml = `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>b</Name><Prefix>${esc(prefix)}</Prefix>${next}<KeyCount>${count}</KeyCount><IsTruncated>${truncated}</IsTruncated>${body}</ListBucketResult>`;
        return new Response(xml, { status: 200 });
    };
    return { fetcher, requests };
}

export const keyFor = (product, ts) => `CONUS/${product}/${ts.slice(0, 8)}/MRMS_${product}_${ts}.grib2.gz`;

/** Timestamps every `stepSec` between two Dates (inclusive of from). */
export function makeTimestamps(from, to, stepSec = 120) {
    const out = [];
    for (let t = from.getTime(); t <= to.getTime(); t += stepSec * 1000) {
        const d = new Date(t);
        out.push(`${d.toISOString().slice(0, 10).replace(/-/g, '')}-${d.toISOString().slice(11, 19).replace(/:/g, '')}`);
    }
    return out;
}
