/**
 * S3 ListObjectsV2 over plain fetch, shared by every public-bucket stack
 * (MRMS, GOES, NEXRAD). Neutral on purpose: it imports nothing, so no stack
 * leaks into another through it.
 */

export interface S3Object {
    key: string;
    size: number;
}

export interface S3ListingPage {
    objects: S3Object[];
    /** `CommonPrefixes` of a delimiter listing. */
    prefixes: string[];
    nextToken: string | null;
}

export interface S3ListOptions {
    fetcher?: typeof fetch;
    signal?: AbortSignal;
    /** Names the stack in the HTTP error message (`MRMS listing failed: HTTP 503`). */
    label: string;
    /** Follow continuation tokens; false reads the first page only. */
    allPages?: boolean;
}

const decodeEntities = (s: string) =>
    s
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');

/** ListObjectsV2 XML is flat, so a strict regex parse works in workers without DOMParser. */
export function parseS3Listing(xml: string): S3ListingPage {
    const objects: S3Object[] = [];
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const key = /<Key>([^<]+)<\/Key>/.exec(m[1]);
        const size = /<Size>(\d+)<\/Size>/.exec(m[1]);
        if (key) objects.push({ key: decodeEntities(key[1]), size: size ? Number(size[1]) : 0 });
    }
    const prefixes = [...xml.matchAll(/<CommonPrefixes>\s*<Prefix>([^<]+)<\/Prefix>/g)].map((m) =>
        decodeEntities(m[1]),
    );
    const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
    const token = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
    return { objects, prefixes, nextToken: truncated && token ? decodeEntities(token[1]) : null };
}

/** List `baseUrl` with `params` (prefix, delimiter, start-after, max-keys), calling `onPage` for each page. */
export async function listS3Pages(
    baseUrl: string,
    params: Record<string, string>,
    opts: S3ListOptions,
    onPage: (page: S3ListingPage) => void,
): Promise<void> {
    const fetcher = opts.fetcher ?? globalThis.fetch;
    let token: string | null = null;
    do {
        const query = new URLSearchParams({ 'list-type': '2', ...params });
        if (token) query.set('continuation-token', token);
        const response = await fetcher(`${baseUrl}/?${query.toString()}`, { signal: opts.signal });
        if (!response.ok) throw new Error(`${opts.label} listing failed: HTTP ${response.status}`);
        const page = parseS3Listing(await response.text());
        onPage(page);
        token = opts.allPages === false ? null : page.nextToken;
    } while (token);
}
