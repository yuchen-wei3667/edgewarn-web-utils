/**
 * Defaults for NEXRAD from Unidata's public buckets. Finished volumes come from Level III (the radar
 * processor's own products, velocity already dealiased); the volume still being received comes from the
 * Level II chunks, and the Level II archive fills any volume Level III lacks.
 */

export const NEXRAD_ARCHIVE_URL = 'https://unidata-nexrad-level2.s3.amazonaws.com';
export const NEXRAD_CHUNKS_URL = 'https://unidata-nexrad-level2-chunks.s3.amazonaws.com';
export const NEXRAD_LEVEL3_URL = 'https://unidata-nexrad-level3.s3.amazonaws.com';

/** Listing and timeline limits. Functions that use one take it as an optional `limits` argument. */
export const NEXRAD_LIMITS = {
    /** Level III publishes each moment for the four lowest elevations (N0 to N3). */
    level3Tilts: 4,
    /** The product whose key marks a Level III volume as published: the last tilt's reflectivity, so all four tilts exist. */
    level3IndexProduct: 'N3B',
    /** Bytes read to get a Level III product's header (WMO line, message header and product description block). */
    level3ProbeBytes: 256,
    /** Never list more UTC days than this to fill the timeline. */
    maxArchiveDays: 3,
    /** Volume ids in the chunk bucket run 1-999 and wrap. */
    ringSize: 999,
    /** Newest volumes that can be missing from the archive (it lags about 7 minutes). Walk back at most this many ring ids. */
    maxLiveVolumes: 4,
    /** Gap rule: a delta over min(gapFactor * local median, gapMaxMs) is a gap. */
    gapFactor: 1.75,
    gapMaxMs: 12 * 60_000,
    gapWindow: 6,
    maxMissingPerGap: 20,
    /** A site with no chunks newer than this is reported offline. */
    offlineMs: 2 * 60 * 60_000,
    /** A next volume later than this many cadences is "overdue". */
    overdueFactor: 1.5,
} as const;

export type NexradLimits = { -readonly [K in keyof typeof NEXRAD_LIMITS]: (typeof NEXRAD_LIMITS)[K] extends string ? string : number };
