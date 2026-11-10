import { CutAssembler } from './cutAssembler.ts';
import type { CutField } from './cutAssembler.ts';
import type { Radial } from './decoder.ts';
import type { CutKind, Vcp } from './vcp.ts';
import { buildElevations, ownersOf } from './elevations.ts';
import type { ElevationPlan } from './elevations.ts';

export interface ElevationRequest {
    elevationId: number;
    moments: string[];
}

export interface ElevationRevision {
    elevationId: number;
    moment: string;
    component: CutKind;
    /** 1 for S, 2 for the D replacement of paired reflectivity. */
    revision: number;
    /** True for S reflectivity while its D cut is still to come. */
    provisional: boolean;
    field: CutField;
}

export interface ElevationProgress {
    elevationId: number;
    cut: number;
    component: CutKind;
    angle: number;
    fraction: number;
}

export interface ElevationSink {
    onRevision(revision: ElevationRevision): void;
    /** Volume ended and the D cut never completed: S stays as an explicit incomplete fallback. */
    onIncomplete?(info: { elevationId: number; moment: string }): void;
    onProgress?(progress: ElevationProgress): void;
}

interface Capture {
    plan: ElevationPlan;
    moment: string;
    assembler: CutAssembler;
    component: CutKind;
    revision: number;
    /** Another component of this moment follows this one. */
    provisional: boolean;
    /** Rows already offered as a partial, so an unchanged cut is not sent twice. */
    partialRows: number;
}

/**
 * Streams radials into the requested (elevation, moment) fields. Publishes S reflectivity as a
 * provisional revision, then the D cut replaces the whole field. Never keeps more than the cuts asked for.
 */
export class ElevationAssembler {
    readonly plans: ElevationPlan[];
    private captures: Capture[] = [];
    private doneCuts = new Set<number>();
    private sink: ElevationSink;
    private lastCut = 0;
    private lastProgress = -1;

    constructor(vcp: Vcp, requests: ElevationRequest[], sink: ElevationSink) {
        this.plans = buildElevations(vcp);
        this.sink = sink;
        for (const request of requests) {
            const plan = this.plans[request.elevationId];
            if (!plan) throw new Error(`Elevation ${request.elevationId} is not in VCP ${vcp.number}`);
            for (const moment of request.moments) {
                const owners = ownersOf(plan, moment);
                if (!owners.length) throw new Error(`Elevation ${plan.id} carries no ${moment}`);
                owners.forEach((owner, index) => {
                    this.captures.push({
                        plan,
                        moment,
                        assembler: new CutAssembler(moment, owner.cut),
                        component: owner.kind,
                        revision: index + 1,
                        provisional: index < owners.length - 1,
                        partialRows: 0,
                    });
                });
            }
        }
    }

    get finished(): boolean {
        return this.captures.every((c) => c.assembler.done);
    }

    /** Highest cut number any capture needs. Bytes past its end are never used. */
    get lastNeededCut(): number {
        return Math.max(0, ...this.captures.map((c) => c.assembler.cut));
    }

    accept(radial: Radial) {
        if (radial.elevationNumber !== this.lastCut) {
            // A new cut began: any open capture on an earlier cut ended without a flag.
            for (const c of this.captures) if (!c.assembler.done && c.assembler.cut < radial.elevationNumber) this.complete(c, true);
            this.lastCut = radial.elevationNumber;
            this.lastProgress = -1;
        }
        for (const c of this.captures) {
            if (c.assembler.done || c.assembler.cut !== radial.elevationNumber) continue;
            if (c.assembler.accept(radial)) this.complete(c, false);
        }
        this.reportProgress(radial);
    }

    private reportProgress(radial: Radial) {
        if (!this.sink.onProgress) return;
        const open = this.captures.find((c) => c.assembler.cut === radial.elevationNumber && !c.assembler.done)
            ?? this.captures.find((c) => c.assembler.cut === radial.elevationNumber);
        if (!open) return;
        const fraction = open.assembler.fraction;
        if (fraction === this.lastProgress) return;
        this.lastProgress = fraction;
        this.sink.onProgress({
            elevationId: open.plan.id,
            cut: open.assembler.cut,
            component: open.component,
            angle: radial.elevation,
            fraction,
        });
    }

    private complete(capture: Capture, forced: boolean) {
        if (forced) capture.assembler.close();
        this.doneCuts.add(capture.assembler.cut);
        if (!capture.assembler.rowCount) return;
        this.sink.onRevision({
            elevationId: capture.plan.id,
            moment: capture.moment,
            component: capture.component,
            revision: capture.revision,
            provisional: capture.provisional,
            field: capture.assembler.snapshot(),
        });
    }

    /**
     * What has arrived of each cut still being received, for the partial-sweep overlay. Only the first component of a
     * moment is offered: paired reflectivity keeps its complete S field until D replaces it whole.
     */
    partials(): ElevationRevision[] {
        const out: ElevationRevision[] = [];
        for (const c of this.captures) {
            if (c.assembler.done || c.revision !== 1) continue;
            const rows = c.assembler.rowCount;
            if (!rows || rows === c.partialRows) continue;
            c.partialRows = rows;
            out.push({
                elevationId: c.plan.id, moment: c.moment, component: c.component, revision: c.revision,
                provisional: c.provisional, field: c.assembler.snapshot(),
            });
        }
        return out;
    }

    /** Call when the stream ended. Closes captures still open and reports provisional fields that never got their D. */
    finish() {
        for (const c of this.captures) if (!c.assembler.done) this.complete(c, true);
        for (const c of this.captures) {
            if (!c.provisional) continue;
            const next = this.captures.find((o) => o.plan === c.plan && o.moment === c.moment && o.revision === c.revision + 1);
            if (next && !next.assembler.rowCount) this.sink.onIncomplete?.({ elevationId: c.plan.id, moment: c.moment });
        }
    }
}
