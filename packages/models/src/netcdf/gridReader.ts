import { componentAlias, composeTransforms } from '../catalog.ts';
import { levelFromValues } from '@edgewarn/web-utils/grib2';
import { Hdf5File, type ByteSource, type Hdf5Dataset } from '@edgewarn/web-utils/goes';
import { modelFileUrl } from '../listing.ts';
import { ModelMissing } from '../sources/errors.ts';
import type { ModelFetcher } from '../sources/fetcher.ts';
import { RangeSource, type RangeReadStats } from '../sources/rangeSource.ts';
import type { SourceAdapter } from '../sources/types.ts';

/** The range reader every NetCDF read of one fetcher shares: its cache, retries and request limit (sized by HEAD). */
const sources = new WeakMap<ModelFetcher, RangeSource>();

/** A surface file keeps its metadata in the last tens of kilobytes; read it with the first request. */
const TAIL_BYTES = 64 * 1024;
/** Fill value of the Met Office files (NetCDF's default for float32), 9.96921e+36. */
const FILL_ABOVE = 1e30;

/** The HDF5 reader's byte source over a `RangeSource` backend, so every read is cached, merged, retried and cancellable. */
function readerSource(
    backend: { getBytes(offset: number, size: number): Promise<Uint8Array> },
    check: () => void,
): ByteSource {
    return {
        bytesFetched: 0,
        requests: 0,
        read: (offset, length) => {
            check();
            return backend.getBytes(offset, length);
        },
    };
}
/** Variables of a file that are coordinates, bounds or flags, not the field. */
const NOT_THE_FIELD =
    /^(latitude|longitude|time|height|pressure|bnds|flag|forecast_\w+|latitude_longitude|\w+_bnds)$/;

/**
 * The object URL names one file of a step, `<run>/<valid>-PT<hhh>H00M-<name>.nc`; every other variable of the step is the same
 * URL with its own name, which the component alias gives (`variable`; `{window}` stands for the statistic's period). Files with a
 * third axis hold every level, so the alias level (pressure in hPa, or height in metres) picks one 2-D slab; others have an empty level.
 */
export function netcdfVariableUrl(objectUrl: string, name: string): string {
    return `${objectUrl.slice(0, objectUrl.lastIndexOf('-') + 1)}${name}.nc`;
}

const PA_PER_HPA = 100;
/** A name in an alias that stands for the period a statistic covers: the files are `…_max-PT03H`, `…-PT06H`. */
const WINDOW_TOKEN = '{window}';

/**
 * The period of the statistic ending at the step: the hours since the run's previous step (`PT01H`, `PT03H`, `PT06H`).
 * The analysis has none.
 */
function windowName(
    req: { dataset: { stepsFor(cycle: number): readonly number[] }; initMs: number; minutes: number },
    variable: string,
): string {
    const steps = req.dataset.stepsFor(new Date(req.initMs).getUTCHours());
    const at = steps.indexOf(req.minutes);
    if (at < 1) throw new ModelMissing(`${variable} has no period ending at +${req.minutes} min`);
    return `PT${String((req.minutes - steps[at - 1]) / 60).padStart(2, '0')}H`;
}

async function findField(
    file: Hdf5File,
    links: ReadonlyMap<string, number>,
    nx: number,
    ny: number,
    url: string,
): Promise<{ name: string; dataset: Hdf5Dataset }> {
    const names = [...links.keys()].filter((name) => !NOT_THE_FIELD.test(name));
    const found = await Promise.all(
        names.map(async (name) => ({ name, dataset: await file.dataset(links.get(name)!) })),
    );
    const fields = found.filter(
        ({ dataset: d }) =>
            d.type.cls === 1 && d.dims.length >= 2 && d.dims.at(-1) === nx && d.dims.at(-2) === ny,
    );
    if (fields.length !== 1)
        throw new Error(`${url} holds ${fields.length} grid variables (${names.join(', ')}), not one`);
    return fields[0];
}

export const netcdfGridAdapter: SourceAdapter = {
    async readInputs(req, { fetcher, check, onLoading }) {
        let source = sources.get(fetcher);
        if (!source) {
            source = new RangeSource({
                maxBytes: 32 * 1024 * 1024,
                sizeByHead: true,
                fetch: (input, init) => fetcher.slot(() => (fetcher.opts.fetch ?? fetch)(input, init)),
            });
            sources.set(fetcher, source);
        }
        const stats: RangeReadStats = { bytesFetched: 0, requests: 0, reads: [] };
        const controller = new AbortController();
        const { nx, ny } = req.dataset.grid;
        try {
            const levels = [];
            for (const sel of req.selectors) {
                check();
                const alias = componentAlias(req.dataset, sel);
                if (!alias)
                    throw new ModelMissing(
                        `${req.dataset.label} has no file for ${sel.variable} at ${sel.level}`,
                    );
                const objectUrl = modelFileUrl(
                    req.dataset,
                    req.initMs,
                    req.dataset.fileOf(sel.file, req.product),
                    req.step,
                );
                const url = netcdfVariableUrl(
                    objectUrl,
                    alias.variable.replace(WINDOW_TOKEN, () => windowName(req, alias.variable)),
                );
                onLoading?.(`Loading forecast inputs: ${levels.length} of ${req.selectors.length}`);
                const backend = source.backend(url, 'nc', stats, controller.signal, TAIL_BYTES);
                const file = await Hdf5File.open(readerSource(backend, check));
                const links = await file.links(file.rootAddress);
                const { name, dataset } = await findField(file, links, nx, ny, url);
                let index: number | undefined;
                if (dataset.dims.length === 3) {
                    // The third axis is pressure in Pa (the alias level is hPa) or height in metres (the level is metres).
                    const pressure = links.get('pressure'),
                        axis = pressure ?? links.get('height');
                    if (axis === undefined) throw new Error(`${url} has no pressure or height axis`);
                    const coordinates = await file.floats(await file.dataset(axis));
                    const wanted = Number(alias.level) * (pressure === undefined ? 1 : PA_PER_HPA);
                    index = coordinates.findIndex((c) => Math.abs(c - wanted) < 0.5);
                    if (index < 0) throw new ModelMissing(`${name} in ${url} has no level ${alias.level}`);
                } else if (dataset.dims.length !== 2)
                    throw new Error(`${name} in ${url} has ${dataset.dims.length} dimensions`);
                const values = await file.floats(dataset, index);
                check();
                // Masked cells carry the fill value; the shared reducers treat NaN as missing.
                for (let i = 0; i < values.length; i++) if (values[i] > FILL_ABOVE) values[i] = NaN;
                onLoading?.(`Decoding forecast inputs: ${levels.length + 1} of ${req.selectors.length}`);
                levels.push(
                    levelFromValues(
                        values,
                        nx,
                        ny,
                        req.level,
                        req.dataset.factors[req.level],
                        sel.reducer ?? req.reducer,
                        composeTransforms(alias.transform, sel.transform),
                        sel.validMax,
                    ),
                );
            }
            return { grid: req.dataset.grid, levels, reads: stats.reads, fetched: stats.bytesFetched };
        } finally {
            controller.abort();
            fetcher.stats.bytesFetched += stats.bytesFetched;
            fetcher.stats.requests += stats.requests;
        }
    },
};
