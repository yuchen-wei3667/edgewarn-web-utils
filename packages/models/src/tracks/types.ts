/** A tropical cyclone as a model names it: `22e` is the 22nd system of the eastern Pacific. */
export interface StormRef {
    /** Basin letter: `l` Atlantic, `e` eastern Pacific, `c` central Pacific, `w` western Pacific... */
    basin: string;
    number: string;
    id: string;
    model: HafsModel;
    initMs: number;
}

export type HafsModel = 'hfsa' | 'hfsb';

export interface TrackPoint {
    leadMinutes: number;
    validMs: number;
    lat: number;
    /** Degrees east, -180..180. */
    lon: number;
    minPressureHpa: number | null;
    maxWindKt: number | null;
}

export interface StormTrack {
    storm: StormRef;
    points: readonly TrackPoint[];
    /** Lines of the source that were not a track point. */
    skipped: number;
    source: { url: string };
}
