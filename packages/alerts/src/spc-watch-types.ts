export type SPCWatchType = 'Severe Thunderstorm' | 'Tornado' | 'Unknown';

export interface SPCWatchProbabilities {
    twoOrMoreTornadoes: string | null;
    strongTornadoes: string | null;
    tenOrMoreSevereWindEvents: string | null;
    windEvents65KnotsOrMore: string | null;
    tenOrMoreSevereHailEvents: string | null;
    hailEvents2InchesOrMore: string | null;
    sixOrMoreCombinedSevereHailWindEvents: string | null;
}

export interface SPCWatchAttributes {
    maxHailInches: number | null;
    maxWindGustKnots: number | null;
    maxTopsHundredsFeet: number | null;
    meanStormMotionVector: string | null;
    particularlyDangerousSituation: boolean | null;
}

export interface SPCWatchSourceUrls {
    productText: string;
    watchPage: string;
}

export interface SPCWatchDetails {
    watchNumber: number;
    type: SPCWatchType;
    metadataLines: string[];
    probabilities: SPCWatchProbabilities;
    attributes: SPCWatchAttributes;
    sourceUrls: SPCWatchSourceUrls;
}
