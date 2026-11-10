import type { ModelSource } from '../configs/types.ts';
import {
    componentAlias,
    composeTransforms,
    findIdxEntry,
    findIdxWindowEntries,
    resolveLevel,
    resolveVariable,
    type ModelFile,
    type ModelSelector,
} from '../catalog.ts';
import type { ModelFieldRead } from '../field.ts';
import {
    decodeGrib2ToLevels,
    parseIdx,
    type IdxEntry,
    type LevelGrid,
    type ModelGrid,
} from '@edgewarn/web-utils/grib2';
import { modelFileUrl } from '../listing.ts';
import { ModelMissing } from './errors.ts';
import type { ModelRange } from './fetcher.ts';
import { probeUrlFor } from './probe.ts';
import type { SourceAdapter } from './types.ts';

const PARSED_INVENTORIES = 4;

interface Located {
    sel: ModelSelector;
    url: string;
    entry: IdxEntry;
}

/**
 * GRIB2 objects with an inventory next to each: the inventory picks the byte range of the one or two messages a
 * field needs out of an object of 50-600 MB, and only those ranges are read and decoded. A dialect is the `parse`
 * function that turns its inventory text into `IdxEntry` rows (wgrib2 `.idx` here, ECMWF's JSON `.index` in
 * `addons/ecmwf`); everything after that is the same.
 */
export function makeGrib2IndexAdapter(parseText: (text: string) => IdxEntry[]): SourceAdapter {
    // An ensemble reads one inventory for every member (ECMWF's has ~8 800 rows), so the last few parses are kept.
    const parsed = new Map<string, IdxEntry[]>();
    const parse = (text: string): IdxEntry[] => {
        let entries = parsed.get(text);
        if (!entries) {
            if (parsed.size >= PARSED_INVENTORIES) parsed.delete(parsed.keys().next().value!);
            parsed.set(text, (entries = parseText(text)));
        }
        return entries;
    };
    return {
        async readInputs(req, { fetcher, check, onLoading }) {
            const { dataset, product, minutes, selectors, step } = req; // A selector names the kind of object it reads; the dataset says which object that is.
            const fileOf = (source: ModelSource) => dataset.fileOf(source, product);
            const urls = new Map<ModelFile, string>();
            for (const sel of selectors)
                urls.set(
                    fileOf(sel.file),
                    modelFileUrl(dataset, req.initMs, fileOf(sel.file), step, req.member),
                );

            // Locate every component first, so one missing component fails the job before any fetch.
            onLoading?.('Finding forecast inputs');
            const located: Located[] = [];
            for (const sel of selectors) {
                const url = urls.get(fileOf(sel.file))!;
                const inventory = probeUrlFor(dataset, url);
                const entries = parse(await fetcher.text(inventory));
                check();
                const found =
                    sel.timing === 'sum-window'
                        ? findIdxWindowEntries(entries, sel, minutes, dataset, product, req.member)
                        : (() => {
                              const e = findIdxEntry(entries, sel, minutes, dataset, product, req.member);
                              return e ? [e] : [];
                          })();
                if (!found.length) {
                    // Name the component as this dataset words it, since a rewrite is what is missing.
                    const wanted = `${resolveVariable(dataset, sel.variable, sel.exact, sel.level)}:${resolveLevel(dataset, sel.level, sel.exact, sel.variable)}`;
                    throw new ModelMissing(`${wanted} is not in ${inventory}`);
                }
                for (const entry of found) located.push({ sel, url, entry });
            }
            const ranges: ModelRange[] = located.map((l) => ({
                url: l.url,
                start: l.entry.start,
                end: l.entry.end,
            }));
            onLoading?.(`Loading forecast inputs: 0 of ${ranges.length}`);
            const { bytes, fetched } = await fetcher.readRanges(ranges, check, (done, total) => {
                onLoading?.(
                    done >= total
                        ? 'Decoding forecast inputs'
                        : `Loading forecast inputs: ${done} of ${total}`,
                );
            });
            check();

            let grid: ModelGrid | null = null;
            const levels: LevelGrid[] = located.map((l, k) => {
                onLoading?.(`Decoding forecast inputs: ${k + 1} of ${located.length}`);
                const alias = componentAlias(dataset, l.sel);
                const transform = composeTransforms(alias?.transform, l.sel.transform);
                const res = decodeGrib2ToLevels(bytes[k], {
                    // Standard deviations are differences: apply unit scaling, never an absolute-value offset.
                    transform: product === 'sprd' ? { scale: Math.abs(transform?.scale ?? 1) } : transform,
                    levels: [req.level],
                    factors: dataset.factors,
                    reducer: l.sel.reducer ?? req.reducer,
                    validMax: l.sel.validMax,
                });
                grid = res.grid;
                return res.levels[0];
            });
            const reads: ModelFieldRead[] = ranges.map((r) => ({ url: r.url, start: r.start, end: r.end }));
            return { grid: grid!, levels, reads, fetched };
        },
    };
}

/** wgrib2 `.idx` inventories: NOAA's buckets. */
export const grib2IndexAdapter: SourceAdapter = makeGrib2IndexAdapter(parseIdx);
