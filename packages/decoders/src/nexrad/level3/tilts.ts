import { LEVEL3_PRODUCT_LETTER } from '../catalog.ts';
import type { Level3Header } from './digitalRadial.ts';

/** One Level III product of a volume (one moment at one tilt) and its header. */
export interface Level3Tilt {
    moment: string;
    product: string;
    header: Level3Header;
}

/** One elevation as a card lists it. */
export interface ElevationSummary {
    id: number;
    nominalAngle: number;
    moments: string[];
    paired: boolean;
    cuts: number[];
}

/** Tilts of one moment whose angles differ by less than this are one elevation in the card. */
const SAME_ELEVATION_DEGREES = 0.3;
const MOMENT_ORDER = Object.keys(LEVEL3_PRODUCT_LETTER);

/** The tilts as the card's elevations: tilts at one angle (reflectivity and velocity of the same cut) are one entry. */
export function groupTilts(tilts: readonly Level3Tilt[]): Array<ElevationSummary & { members: readonly Level3Tilt[] }> {
    const sorted = [...tilts].sort(
        (a, b) =>
            a.header.elevation - b.header.elevation || MOMENT_ORDER.indexOf(a.moment) - MOMENT_ORDER.indexOf(b.moment),
    );
    const groups: Level3Tilt[][] = [];
    for (const tilt of sorted) {
        const last = groups[groups.length - 1];
        if (last && tilt.header.elevation - last[0].header.elevation < SAME_ELEVATION_DEGREES) last.push(tilt);
        else groups.push([tilt]);
    }
    return groups.map((members, id) => ({
        id,
        nominalAngle: members[0].header.elevation,
        moments: MOMENT_ORDER.filter((m) => members.some((t) => t.moment === m)),
        paired: false,
        cuts: [...new Set(members.map((t) => t.header.elevationNumber))],
        members,
    }));
}
