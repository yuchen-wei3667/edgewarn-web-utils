import { MODEL_TILE_HALO, MODEL_TILE_SIZE } from './limits.ts';

/** A tile of one level of a model's grid: level L holds one texel per factor(L) x factor(L) cells. */
export interface ModelTileKey {
    level: number;
    tx: number;
    ty: number;
}

/** Size of one level of a model's grid and its tile layout. */
export interface ModelLevelLayout {
    level: number;
    factor: number;
    /** Texels in the level. */
    nx: number;
    ny: number;
    tilesX: number;
    tilesY: number;
}

/** `factors` are the source cells merged per texel at each level (`dataset.factors`). */
export function levelLayout(
    level: number,
    gridNx: number,
    gridNy: number,
    factors: readonly number[],
): ModelLevelLayout {
    const factor = factors[level];
    if (!factor) throw new Error(`No model level ${level}`);
    const nx = Math.ceil(gridNx / factor);
    const ny = Math.ceil(gridNy / factor);
    return {
        level,
        factor,
        nx,
        ny,
        tilesX: Math.ceil(nx / MODEL_TILE_SIZE),
        tilesY: Math.ceil(ny / MODEL_TILE_SIZE),
    };
}

/** Interior texel rectangle of a tile: columns [c0, c1) and rows [r0, r1) of its level. */
export function tileTexels(
    layout: ModelLevelLayout,
    tx: number,
    ty: number,
): { c0: number; r0: number; c1: number; r1: number } {
    const c0 = tx * MODEL_TILE_SIZE;
    const r0 = ty * MODEL_TILE_SIZE;
    return {
        c0,
        r0,
        c1: Math.min(c0 + MODEL_TILE_SIZE, layout.nx),
        r1: Math.min(r0 + MODEL_TILE_SIZE, layout.ny),
    };
}

/**
 * Copy one tile plus a 1-texel halo out of a level grid (float16 bits, `channels` interleaved).
 * The halo repeats the edge texel at regional borders; global grids can wrap columns.
 */
export function cutTile(
    level: Uint16Array,
    layout: ModelLevelLayout,
    tx: number,
    ty: number,
    channels: number,
    wrapX = false,
): { data: Uint16Array; width: number; height: number } {
    const { c0, r0, c1, r1 } = tileTexels(layout, tx, ty);
    const h = MODEL_TILE_HALO;
    const width = c1 - c0 + 2 * h;
    const height = r1 - r0 + 2 * h;
    const data = new Uint16Array(width * height * channels);
    for (let y = 0; y < height; y++) {
        const r = Math.min(Math.max(r0 - h + y, 0), layout.ny - 1);
        for (let x = 0; x < width; x++) {
            const column = c0 - h + x;
            const c = wrapX
                ? ((column % layout.nx) + layout.nx) % layout.nx
                : Math.min(Math.max(column, 0), layout.nx - 1);
            const src = (r * layout.nx + c) * channels;
            const dst = (y * width + x) * channels;
            for (let k = 0; k < channels; k++) data[dst + k] = level[src + k];
        }
    }
    return { data, width, height };
}

export function allTiles(layout: ModelLevelLayout): ModelTileKey[] {
    const out: ModelTileKey[] = [];
    for (let ty = 0; ty < layout.tilesY; ty++)
        for (let tx = 0; tx < layout.tilesX; tx++) out.push({ level: layout.level, tx, ty });
    return out;
}
