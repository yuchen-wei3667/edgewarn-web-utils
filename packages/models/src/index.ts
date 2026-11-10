// Projection
export { projectionFor, snapToCell } from './projection/index.ts';
export type { SnappedCell } from './projection/index.ts';
export type { GridProjection, ProjectionUniforms } from './projection/types.ts';
export { lambertGridProjection } from './projection/lambert.ts';
export { latLonGridProjection, LATLON_GLSL } from './projection/latlon.ts';
export { mercatorGridProjection, MERCATOR_GLSL } from './projection/mercator.ts';
export { polarStereoGridProjection, POLAR_STEREO_GLSL } from './projection/polarStereo.ts';
export { rotatedLatLonGridProjection, ROTATED_LATLON_GLSL } from './projection/rotatedLatlon.ts';
export {
    lambertProjection,
    lambertForward,
    lambertInverse,
    gridRotation,
    gridRectLngLatBounds,
    LAMBERT_GLSL,
} from './lambert.ts';
export type { LambertProjection } from './lambert.ts';

// Field math
export { rotateToEarth, rotationTables, speedAndDirection } from './winds.ts';
export { derivativeSpan, gridMetrics, gradient } from './derivatives.ts';
export type { GridMetrics } from './derivatives.ts';
export { integrateTrajectory, gridWindSampler, blendInTime } from './trajectory.ts';
export type { TrajectoryPoint, WindSampler, TrajectoryOptions } from './trajectory.ts';
export {
    assembleLevelGrid,
    smoothGrid,
    contourTexels,
    findPressureCenters,
    buildContourLines,
    buildIsobarSet,
} from './isobars.ts';
export type { IsobarLevelGrid, IsobarTile, IsobarLine, PressureCenter, IsobarSet } from './isobars.ts';
export { RECIPE_ROLES, combineInputs, combinesBeforeDecimation, decimateMean } from './recipes.ts';
export type { RecipeOutput } from './recipes.ts';
export {
    DIAGNOSTIC_RECIPES,
    DIAGNOSTIC_ROLES,
    diagnosticInputCount,
    combineDiagnostic,
} from './diagnosticRecipes.ts';
export type { DiagnosticRecipe } from './diagnosticRecipes.ts';
export { describeGrid, gridMismatch } from './gridMatch.ts';
export { levelLayout, tileTexels, cutTile, allTiles } from './tiles.ts';
export type { ModelLevelLayout, ModelTileKey } from './tiles.ts';
export * from './limits.ts';

// Sources
export { ModelHttpError, ModelCancelled, ModelMissing } from './sources/errors.ts';
export { ModelFetcher } from './sources/fetcher.ts';
export type { ModelRange, ModelByteCache } from './sources/fetcher.ts';
export { RangeSource } from './sources/rangeSource.ts';
export type { RangeReadStats } from './sources/rangeSource.ts';
export { makeGrib2IndexAdapter, grib2IndexAdapter } from './sources/grib2Index.ts';
export { loadSourceAdapter } from './sources/index.ts';
export type { LoadSourceOptions } from './sources/index.ts';
export { probeUrlFor } from './sources/probe.ts';
export type { SourceReadRequest, SourceContext, SourceInputs, SourceAdapter } from './sources/types.ts';
export { ModelMessageCache } from './messageCache.ts';
export type { ModelMessageCacheOptions } from './messageCache.ts';
export { netcdfGridAdapter, netcdfVariableUrl } from './netcdf/gridReader.ts';

// Registry
export {
    HOUR_MS,
    HOST_UNREACHABLE,
    ModelHostError,
    floorHour,
    roundStep,
    runCycle,
    modelFileUrl,
    makeRangeProbe,
    rangeProbe,
    countPublishedSteps,
    findNewestRun,
    listRecentRuns,
    stepIndexOf,
    activeStepList,
    chooseModelStep,
} from './listing.ts';
export type { ModelRunInfo, ModelProbe, ProbeResult, ModelStepSource, ChooseStepContext } from './listing.ts';
export {
    MODEL_PANES,
    PTYPE_CODES,
    MODEL_FIELDS,
    getModelField,
    knowsModelField,
    fieldsForModel,
    modelHasIsobars,
    panesForModel,
    inputsFor,
    recipeFor,
    modelHasField,
    heightContourFieldForModel,
    resolveModelFieldId,
    isVectorField,
    fieldFloor,
    needsForecastStep,
    fieldReducer,
    componentAlias,
    resolveVariable,
    resolveLevel,
    composeTransforms,
    findIdxEntry,
    findIdxWindowEntries,
} from './catalog.ts';
export type {
    ModelFieldDef,
    ModelPane,
    ModelColormapRef,
    ModelFieldKind,
    ModelPaneId,
    ModelQuantity,
    ModelRecipe,
    ModelRecipeParams,
    ModelSelector,
} from './catalog.ts';
export {
    MODEL_DATASETS,
    MODEL_IDS,
    MAP_MODEL_IDS,
    VIEWER_MODEL_IDS,
    COMPARE_MODEL_IDS,
    isModelId,
    isMapModelId,
    initialModelFields,
    initialModelRuns,
    getDataset,
} from './datasets.ts';
export type {
    EnsembleProduct,
    ModelFile,
    ModelId,
    ModelCapabilities,
    ModelPointSeries,
    ModelProfiles,
    ModelDataset,
} from './datasets.ts';
export { verticalOf } from './field.ts';
export type { ModelFieldVertical, ModelFieldRead, ModelFieldFrame } from './field.ts';
export {
    memberIds,
    EnsembleReducer,
    PRODUCT_LABELS,
    MEMBER_READ_MB,
    offeredProducts,
    isComputedProduct,
    membersRead,
    memberLabel,
    stepMemberId,
    firstMember,
    thresholdKey,
    parseThreshold,
} from './ensemble.ts';
export type { ComputedStat, ExceedThreshold } from './ensemble.ts';
export {
    modelFamily,
    familyModelIds,
    familyPickerIds,
    familyProduct,
    familyFields,
    familyPanes,
    familyFieldModel,
} from './modelFamily.ts';
export { groupModels, modelMatches } from './modelGroups.ts';
export { compileDataset, compileFields } from './registry/compile.ts';
export { validateConfigs } from './registry/validate.ts';
export { MODEL_CONFIGS } from './configs/index.ts';
export * from './configs/shared.ts';
export { hafsTrackModel, hafsDatasetId, setHafsStorm, stormPathId } from './configs/hafsStorm.ts';
export { OPEN_METEO_CREDIT } from './configs/openMeteo.ts';
export type * from './configs/types.ts';

// Compare
export { parseExpr, ExprError } from './compare/expr/parse.ts';
export type { Expr } from './compare/expr/parse.ts';
export { checkExpr } from './compare/expr/check.ts';
export { evaluate, evaluateAsync } from './compare/expr/vm.ts';
export { regridLevel } from './compare/regrid.ts';
export { alignSteps } from './compare/align.ts';
export { runComparison } from './compare/compareRunner.ts';
export type { Produced } from './compare/compareRunner.ts';
export {
    diffSpec,
    absDiffSpec,
    percentDiffSpec,
    zscoreSpec,
    blendSpec,
    runDeltaSpec,
} from './compare/presets.ts';
export { describeSpec, blendFromPercent } from './compare/describe.ts';
export { checkComparison, registerComparison } from './compare/fieldMeta.ts';
export { refuseMovingGrid, relate, chooseReference } from './compare/gridRelation.ts';
export { comparisonHash } from './compare/identity.ts';
export { operandUnits } from './compare/operandUnits.ts';
export { resolveComparison } from './compare/resolve.ts';
export { runPair, probeOlderRun, resolveRuns } from './compare/runs.ts';
export type { DerivedFieldInfo } from './compare/derived.ts';
export type * from './compare/types.ts';

// Tracks
export {
    parseHafsStats,
    stormFromKey,
    statsUrl,
    parseStormListing,
    recentCycles,
    listingUrl,
    listHafsStorms,
    fetchStormTrack,
    intensityCategory,
    positionAt,
} from './tracks/hafs.ts';
export type * from './tracks/types.ts';
