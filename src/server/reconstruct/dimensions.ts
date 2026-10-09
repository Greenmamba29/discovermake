/**
 * Reconstruct dimensions in the Build Graph (pure).
 *
 * Every required dimension is a REQUIREMENT node `dim:<param>` with `data.category = 'dimension'`:
 *
 *   caliper (confirmed)   source 'user', data.requirementSource 'user', data.source 'caliper',
 *                         data.valueMm, data.enteredValue / enteredUnit, data.confirmedAt
 *   photo estimate only   source 'system', data.source 'photo_estimate', data.confirmedAt null
 *                         (NOT buyer-stated: the CAD agent and the planner never read it)
 *
 * So the existing CAD agent rule ("only buyer-stated numbers") applies unchanged: only caliper
 * readings are buyer-stated. Photo estimates ride along as `photoEstimateMm` for the record.
 */
import type { BgNode, BgNodeInput } from '@/contracts/build-graph';
import { requiredDimensions, type DimensionView, type LengthUnit, type ReconstructOptions, type ReconstructPartType } from '@/contracts/reconstruct';
import { deltaPct, deltaWarning } from '@/lib/reconstruct/measure';

export const DIM_KEY_PREFIX = 'dim:';
export const dimKey = (param: string) => `${DIM_KEY_PREFIX}${param}`;

export type ConfirmedDim = { param: string; label: string; valueMm: number; enteredValue: number; enteredUnit: LengthUnit; confirmedAt: string; photoEstimateMm: number | null };
export type Estimate = { mm: number; uncertaintyMm: number | null };

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Confirmed caliper readings on a graph version: user-sourced dim nodes with a confirmation time. */
export function confirmedDims(nodes: Pick<BgNode, 'key' | 'type' | 'source' | 'data'>[]): Map<string, ConfirmedDim> {
    const out = new Map<string, ConfirmedDim>();
    for (const n of nodes) {
        if (n.type !== 'REQUIREMENT' || !n.key.startsWith(DIM_KEY_PREFIX)) continue;
        const d = n.data;
        if (n.source !== 'user' || d.requirementSource !== 'user' || d.source !== 'caliper' || typeof d.confirmedAt !== 'string') continue;
        const valueMm = num(d.valueMm);
        if (valueMm === null || valueMm <= 0) continue;
        out.set(String(d.param), {
            param: String(d.param),
            label: String(d.label ?? d.param),
            valueMm,
            enteredValue: num(d.enteredValue) ?? valueMm,
            enteredUnit: d.enteredUnit === 'in' ? 'in' : 'mm',
            confirmedAt: d.confirmedAt,
            photoEstimateMm: num(d.photoEstimateMm),
        });
    }
    return out;
}

const fmt = (mm: number) => mm.toFixed(2);

export function caliperNode(c: ConfirmedDim, estimate: Estimate | null): BgNodeInput {
    const delta = estimate ? deltaPct(estimate.mm, c.valueMm) : null;
    return {
        key: dimKey(c.param),
        type: 'REQUIREMENT',
        label: `${c.label}: ${fmt(c.valueMm)} mm (caliper)`.slice(0, 200),
        data: {
            category: 'dimension',
            param: c.param,
            label: c.label,
            text: `${c.label} ${fmt(c.valueMm)} mm (caliper reading)`,
            valueMm: c.valueMm,
            enteredValue: c.enteredValue,
            enteredUnit: c.enteredUnit,
            source: 'caliper',
            requirementSource: 'user',
            confirmedAt: c.confirmedAt,
            photoEstimateMm: estimate?.mm ?? c.photoEstimateMm ?? null,
            photoUncertaintyMm: estimate?.uncertaintyMm ?? null,
            deltaPct: delta,
        },
        confidence: null,
        source: 'user',
        provenance: 'reconstruct:caliper',
    };
}

export function estimateNode(param: string, label: string, estimate: Estimate): BgNodeInput {
    return {
        key: dimKey(param),
        type: 'REQUIREMENT',
        label: `${label}: about ${fmt(estimate.mm)} mm (estimate from photo, unconfirmed)`.slice(0, 200),
        data: { category: 'dimension', param, label, source: 'photo_estimate', estimateMm: estimate.mm, uncertaintyMm: estimate.uncertaintyMm, confirmedAt: null },
        confidence: null,
        source: 'system',
        provenance: 'reconstruct:photo-estimate',
    };
}

/** The confirmation table: one row per required dimension (estimate vs caliper, delta warning). */
export function dimensionViews(partType: ReconstructPartType, options: ReconstructOptions, confirmed: Map<string, ConfirmedDim>, estimates: Map<string, Estimate>): DimensionView[] {
    return requiredDimensions(partType, options).map((def) => {
        const c = confirmed.get(def.param) ?? null;
        const e = estimates.get(def.param) ?? null;
        const estimateMm = e?.mm ?? c?.photoEstimateMm ?? null;
        return {
            param: def.param,
            label: def.label,
            kind: def.kind,
            hint: def.hint,
            estimateMm,
            estimateUncertaintyMm: e?.uncertaintyMm ?? null,
            caliperMm: c?.valueMm ?? null,
            enteredValue: c?.enteredValue ?? null,
            enteredUnit: c?.enteredUnit ?? null,
            confirmedAt: c?.confirmedAt ?? null,
            source: c ? 'caliper' : e ? 'photo_estimate' : null,
            deltaPct: estimateMm !== null && c ? deltaPct(estimateMm, c.valueMm) : null,
            deltaWarning: deltaWarning(estimateMm, c?.valueMm ?? null),
        };
    });
}
