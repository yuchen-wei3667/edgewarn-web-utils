/**
 * Parser for the WPC "Coded Surface Frontal Positions" bulletin (CODSUS, WMO header ASUS02).
 *
 *   HIGHS 1036 4371107 1039 4001072
 *   COLD 3869 3475 2981
 *   OCFNT 5159 5259
 *
 * Highs and lows are pressure/position pairs. Every other record is a front or trough line made of
 * positions, optionally led by a strength word (WK, MDT, STG). A position is latitude then longitude
 * west with no separator; the ASUS02 form carries tenths of a degree (latitude is always the first
 * three digits), the ASUS01 form whole degrees (latitude is the first two).
 */

const FRONT_TYPES: Record<string, string> = {
    COLD: 'COLD',
    WARM: 'WARM',
    STNRY: 'STATIONARY',
    OCFNT: 'OCCLUDED',
    TROF: 'TROUGH',
};

const STRENGTH_WORDS = new Set(['WK', 'MDT', 'STG']);

type Position = [number, number];

function decodePosition(token: string, tenths: boolean): Position | null {
    if (!/^\d{4,7}$/.test(token)) return null;
    const latDigits = tenths ? 3 : 2;
    const scale = tenths ? 10 : 1;
    const lat = Number(token.slice(0, latDigits)) / scale;
    const lonWest = Number(token.slice(latDigits)) / scale;
    if (!Number.isFinite(lat) || !Number.isFinite(lonWest) || lat > 90 || lonWest > 180) return null;
    return [-lonWest, lat];
}

export function parseCodsus(text: string, tenths = true): GeoJSON.FeatureCollection {
    const body = text.split(/\bVALID\b[^\n]*\n/)[1] ?? text;
    const tokens = body.split('$$')[0].split(/\s+/).filter(Boolean);
    const features: GeoJSON.Feature[] = [];

    let record: { keyword: string; tokens: string[] } | null = null;
    const records: { keyword: string; tokens: string[] }[] = [];
    for (const token of tokens) {
        if (token === 'HIGHS' || token === 'LOWS' || token in FRONT_TYPES) {
            record = { keyword: token, tokens: [] };
            records.push(record);
        } else {
            record?.tokens.push(token);
        }
    }

    for (const { keyword, tokens: rest } of records) {
        if (keyword === 'HIGHS' || keyword === 'LOWS') {
            for (let i = 0; i + 1 < rest.length; i += 2) {
                const pressure = Number(rest[i]);
                const position = decodePosition(rest[i + 1], tenths);
                if (!position || !Number.isFinite(pressure)) continue;
                features.push({
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: position },
                    properties: { type: keyword === 'HIGHS' ? 'HIGH' : 'LOW', pressure },
                });
            }
            continue;
        }
        const strength = rest.find((token) => STRENGTH_WORDS.has(token));
        const coordinates = rest.flatMap((token) => {
            const position = decodePosition(token, tenths);
            return position ? [position] : [];
        });
        if (coordinates.length < 2) continue;
        features.push({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates },
            properties: { type: FRONT_TYPES[keyword], ...(strength ? { strength } : {}) },
        });
    }
    return { type: 'FeatureCollection', features };
}
