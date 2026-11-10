export type { Colormap, ColormapThreshold } from './types.ts';
export {
    mapValueToRgba,
    createColormapTextureData,
    findColormapByKey,
    normalizeColormapKey,
    isValidRgb,
} from './rgba.ts';
export { extractColormaps } from './bundle.ts';
export { colormapStops, getColormapTicks, thinColormapTicks, formatLegendValue } from './legend.ts';
export type { ColormapStop, ColormapTick } from './legend.ts';
