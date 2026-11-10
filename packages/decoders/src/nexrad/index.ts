export { Bzip2Decoder } from './decoder/bzip2.ts';
export { MessageDecoder, NexradDecoder, sample, materialize, readVcpFromPrefix } from './decoder/decoder.ts';
export type { Moment, Radial, DecoderOptions } from './decoder/decoder.ts';
export { parseVcp, momentsOfKind } from './decoder/vcp.ts';
export type { Vcp, VcpCut, CutKind } from './decoder/vcp.ts';
export { CutAssembler, buildAzimuthLut, AZIMUTH_MISSING } from './decoder/cutAssembler.ts';
export type { CutField } from './decoder/cutAssembler.ts';
export { parseLevel3Header, decodeLevel3Radial } from './level3/digitalRadial.ts';
export type { Level3Header } from './level3/digitalRadial.ts';
export { parseTvsProduct, destinationPoint } from './level3/tvs.ts';
export type { TvsKind, TvsDetection, TvsProduct } from './level3/tvs.ts';
export {
    NEXRAD_MOMENT_OF,
    LEVEL3_PRODUCT_LETTER,
    NEXRAD_FOLD_COLOR,
    hasLevel3Moment,
    codeToValue,
    formatAngle,
} from './catalog.ts';
export { NEXRAD_SITES, NEXRAD_SITE_BY_ID } from './sites.ts';
export type { NexradSite, NexradProduct } from './types.ts';
export { ChunkSequence } from './decoder/chunks.ts';
export { buildElevations, ownersOf, elevationMoments, momentReadiness, pickElevation } from './decoder/elevations.ts';
export type { ElevationPlan, ElevationComponent } from './decoder/elevations.ts';
export { ElevationAssembler } from './decoder/elevationAssembler.ts';
export type {
    ElevationRequest,
    ElevationRevision,
    ElevationProgress,
    ElevationSink,
} from './decoder/elevationAssembler.ts';
export { groupTilts } from './level3/tilts.ts';
export type { Level3Tilt, ElevationSummary } from './level3/tilts.ts';
export {
    EARTH_RADIUS_M,
    EFFECTIVE_RADIUS_M,
    MERCATOR_RADIUS_M,
    groundRangeAndBearing,
    slantRangeOf,
    beamHeightMeters,
    locateGate,
    maxRangeMeters,
    mercatorY,
    mercatorUnit,
    radarQuad,
    shaderGeometryFloat32,
} from './geometry.ts';
export type { SiteLocation } from './geometry.ts';
export {
    BEAM_HALF_WIDTH_RAD,
    buildSweeps,
    polarColumn,
    polarValueAt,
    polarProfile,
    lineRangeFrom,
    boxRangeFrom,
    rangeVerdict,
    padBand,
    bandCovers,
    cropField,
} from './volume-sample.ts';
export type { Sweep, PolarColumn, ShapeRange, RangeBand } from './volume-sample.ts';
