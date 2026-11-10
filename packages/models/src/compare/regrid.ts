import type { ModelGrid } from '@edgewarn/web-utils/grib2';
import { projectionFor } from '../projection/index.ts';
import { relate } from './gridRelation.ts';
import type { RegridReport } from './types.ts';
/** Cell centres of decimated levels sit at (i + 0.5) * factor - 0.5. */
export function regridLevel(
    data: Float32Array,
    src: ModelGrid,
    sourceFactor: number,
    target: ModelGrid,
    factor: number,
    check = () => {},
) {
    const nx = Math.ceil(target.nx / factor),
        ny = Math.ceil(target.ny / factor);
    const sx = Math.ceil(src.nx / sourceFactor),
        sy = Math.ceil(src.ny / sourceFactor);
    if (data.length !== sx * sy) throw new Error('Source level size mismatch');
    const relation = relate(target, src);
    if (relation === 'identical' && sourceFactor === factor) {
        let valid = 0;
        for (const value of data) if (Number.isFinite(value)) valid++;
        return {
            data,
            report: { relation, method: 'none' as const, coverage: valid / data.length, subsample: 1 },
        };
    }
    if (
        relation === 'shift' &&
        sourceFactor === factor &&
        src.projection === 'latlon' &&
        target.projection === 'latlon' &&
        src.nx % factor === 0
    ) {
        const shift = (target.lon1 - src.lon1) / src.dlon / factor;
        if (Math.abs(shift - Math.round(shift)) < 1e-6) {
            const out = new Float32Array(data.length);
            let valid = 0;
            for (let y = 0; y < ny; y++) {
                check();
                for (let x = 0; x < nx; x++) {
                    const value = data[y * nx + ((((x + Math.round(shift)) % nx) + nx) % nx)];
                    out[y * nx + x] = value;
                    if (Number.isFinite(value)) valid++;
                }
            }
            return {
                data: out,
                report: {
                    relation,
                    method: 'column-shift' as const,
                    coverage: valid / out.length,
                    subsample: 1,
                },
            };
        }
    }
    const sp = projectionFor(src),
        tp = projectionFor(target);
    const ratio = (tp.cellMetres(40) * factor) / (sp.cellMetres(40) * sourceFactor);
    const k =
        relation === 'resample' || sourceFactor !== factor ? Math.min(4, Math.max(1, Math.ceil(ratio))) : 1;
    const wrap = src.projection === 'latlon' && !src.rotation && Math.abs(src.nx * src.dlon - 360) < 1e-6;
    const sample = (i: number, j: number) => {
        if (
            !Number.isFinite(i + j) ||
            j < -1e-6 ||
            j > sy - 1 + 1e-6 ||
            (!wrap && (i < -1e-6 || i > sx - 1 + 1e-6))
        )
            return NaN;
        j = Math.max(0, Math.min(sy - 1, j));
        if (!wrap) i = Math.max(0, Math.min(sx - 1, i));
        const x = Math.floor(i),
            y = Math.floor(j),
            dx = i - x,
            dy = j - y;
        let sum = 0,
            weights = 0;
        for (let v = 0; v < 2; v++)
            for (let u = 0; u < 2; u++) {
                const column = wrap ? (((x + u) % sx) + sx) % sx : Math.min(sx - 1, x + u);
                const value = data[Math.min(sy - 1, y + v) * sx + column];
                const w = (u ? dx : 1 - dx) * (v ? dy : 1 - dy);
                if (Number.isFinite(value)) {
                    sum += w * value;
                    weights += w;
                }
            }
        return weights ? sum / weights : NaN;
    };
    const out = new Float32Array(nx * ny);
    let valid = 0;
    for (let y = 0; y < ny; y++) {
        check();
        for (let x = 0; x < nx; x++) {
            let sum = 0,
                count = 0;
            for (let v = 0; v < k; v++)
                for (let u = 0; u < k; u++) {
                    const [lat, lon] = tp.inverse(
                        Math.min(target.nx - 1, (x + (u + 0.5) / k) * factor - 0.5),
                        Math.min(target.ny - 1, (y + (v + 0.5) / k) * factor - 0.5),
                    );
                    const [i, j] = sp.forward(lat, lon);
                    const value = sample((i + 0.5) / sourceFactor - 0.5, (j + 0.5) / sourceFactor - 0.5);
                    if (Number.isFinite(value)) {
                        sum += value;
                        count++;
                    }
                }
            out[y * nx + x] = count ? sum / count : NaN;
            if (count) valid++;
        }
    }
    const report: RegridReport = {
        relation,
        method:
            relation === 'identical' && sourceFactor === factor ? 'none' : k > 1 ? 'area-mean' : 'bilinear',
        coverage: valid / out.length,
        subsample: k,
    };
    return { data: out, report };
}
