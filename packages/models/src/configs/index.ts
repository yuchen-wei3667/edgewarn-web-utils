import { gemRdps } from './datasets/gem-rdps.ts';
import { gemGdps } from './datasets/gem-gdps.ts';
import { hrrr } from './datasets/hrrr.ts';
import { hrrrSubh } from './datasets/hrrr-subh.ts';
import { hrrrAk } from './datasets/hrrr-ak.ts';
import { rap } from './datasets/rap.ts';
import { nbmAk } from './datasets/nbm-ak.ts';
import { nbmHi } from './datasets/nbm-hi.ts';
import { nbmPr } from './datasets/nbm-pr.ts';
import { nbmGu } from './datasets/nbm-gu.ts';
import { cfs } from './datasets/cfs.ts';
import { gfsWave } from './datasets/gfs-wave.ts';
import { gefsWave } from './datasets/gefs-wave.ts';
import { rrfs } from './datasets/rrfs.ts';
import { rrfsSubh } from './datasets/rrfs-subh.ts';
import { rrfsNa } from './datasets/rrfs-na.ts';
import { refs } from './datasets/refs.ts';
import { nbm } from './datasets/nbm.ts';
import { gfs } from './datasets/gfs.ts';
import { ecmwfIfs } from './datasets/ecmwf-ifs.ts';
import { gefs } from './datasets/gefs.ts';
import { ecmwfIfsEns } from './datasets/ecmwf-ifs-ens.ts';
import { ecmwfAifs } from './datasets/ecmwf-aifs.ts';
import { ecmwfAifsEns } from './datasets/ecmwf-aifs-ens.ts';
import { aigfs } from './datasets/aigfs.ts';
import { hafsA } from './datasets/hafs-a.ts';
import { hafsB } from './datasets/hafs-b.ts';
import { gemHrdps } from './datasets/gem-hrdps.ts';
import { gemHrdpsWest } from './datasets/gem-hrdps-west.ts';
import { arpegeWorld } from './datasets/arpege-world.ts';
import { ukmoGlobal } from './datasets/ukmo-global.ts';
import { gefs35d } from './datasets/gefs-35d.ts';

/**
 * Every model the Models window offers, in picker order. Adding a model is one file in `datasets/`
 * and one import and one entry here: a test fails when a file in `datasets/` is not listed.
 * Everything else (`ModelId`, the registry, the catalog) follows from this array.
 */
export const MODEL_CONFIGS = [
    hrrr,
    hrrrSubh,
    hrrrAk,
    rrfs,
    rrfsSubh,
    rrfsNa,
    refs,
    rap,
    gemRdps,
    gemHrdps,
    gemHrdpsWest,
    nbm,
    nbmAk,
    nbmHi,
    nbmPr,
    nbmGu,
    gfs,
    gemGdps,
    arpegeWorld,
    ukmoGlobal,
    gfsWave,
    cfs,
    ecmwfIfs,
    gefs,
    gefs35d,
    gefsWave,
    ecmwfIfsEns,
    ecmwfAifs,
    ecmwfAifsEns,
    aigfs,
    hafsA,
    hafsB,
] as const;
