/**
 * Route comparison (pure, no I/O): score every candidate route (partner shops from the matcher,
 * supplier offers) on cost, P90 arrival date, quality and CO₂, and pick one Recommended route
 * deterministically. Lower score is better.
 *
 *   score = w_cost x norm(total) + w_date x norm(arrival) + w_quality x norm(1 - quality) + w_co2 x norm(co2)
 *
 * Each metric is min-max normalized across the candidates (0 when all are equal). Only routes
 * that can be ordered or confirmed (BINDING or SUPPLIER_CONFIRMED) can be Recommended; ties go to
 * the cheaper, then the earlier, then the lower id.
 */
import type { TrustLevel } from '../../contracts/enums';
import type { RouteCandidateView } from '../../contracts/promise';

export const ROUTE_WEIGHTS = { cost: 0.45, date: 0.3, quality: 0.15, co2: 0.1 } as const;

export type RouteCandidateInput = Omit<RouteCandidateView, 'score' | 'recommended'>;

const RECOMMENDABLE: ReadonlySet<TrustLevel> = new Set<TrustLevel>(['BINDING', 'SUPPLIER_CONFIRMED']);

function dayNumber(iso: string): number {
    return Math.round(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);
}

function normalizer(values: number[]): (v: number) => number {
    const min = Math.min(...values);
    const max = Math.max(...values);
    return (v) => (max === min ? 0 : (v - min) / (max - min));
}

export function scoreRoutes(candidates: readonly RouteCandidateInput[], weights: { cost: number; date: number; quality: number; co2: number } = ROUTE_WEIGHTS): RouteCandidateView[] {
    if (!candidates.length) return [];
    const cost = normalizer(candidates.map((c) => c.totalCents));
    const date = normalizer(candidates.map((c) => dayNumber(c.arrivesBy)));
    const quality = normalizer(candidates.map((c) => 1 - c.quality));
    const co2 = normalizer(candidates.map((c) => c.co2Kg));
    const scored = candidates.map((c) => ({
        ...c,
        score: Math.round((weights.cost * cost(c.totalCents) + weights.date * date(dayNumber(c.arrivesBy)) + weights.quality * quality(1 - c.quality) + weights.co2 * co2(c.co2Kg)) * 10_000) / 10_000,
        recommended: false,
    }));
    const order = (a: RouteCandidateView, b: RouteCandidateView) => a.score - b.score || a.totalCents - b.totalCents || a.arrivesBy.localeCompare(b.arrivesBy) || a.id.localeCompare(b.id);
    const best = scored.filter((c) => RECOMMENDABLE.has(c.trustLevel)).sort(order)[0];
    if (best) best.recommended = true;
    return scored.sort((a, b) => Number(b.recommended) - Number(a.recommended) || order(a, b));
}

// ---------------------------------------------------------------------------
// CO₂ estimate (cradle-to-gate material + freight). Labelled an estimate in the UI.
// ---------------------------------------------------------------------------

/** kg CO₂e per kg of material (typical published averages; primary production mix). */
export const MATERIAL_KG_CO2E_PER_KG: readonly { match: RegExp; factor: number }[] = [
    { match: /stainless/i, factor: 6.2 },
    { match: /alumin/i, factor: 8.6 },
    { match: /steel|iron/i, factor: 1.9 },
    { match: /copper|brass/i, factor: 3.8 },
    { match: /acrylic|pmma|plastic|polycarbonate|hdpe|abs/i, factor: 3.5 },
    { match: /wood|plywood|mdf|birch/i, factor: 0.5 },
];
export const DEFAULT_MATERIAL_FACTOR = 3;
/** kg CO₂e per tonne-km. */
export const FREIGHT_KG_CO2E_PER_TKM = { truck: 0.105, ocean: 0.016, air: 0.6 } as const;
const ASIA = new Set(['CN', 'VN', 'TW', 'TH', 'MY', 'IN', 'KR', 'JP', 'ID', 'PH']);

export function materialFactor(materialName: string): number {
    return MATERIAL_KG_CO2E_PER_KG.find((m) => m.match.test(materialName))?.factor ?? DEFAULT_MATERIAL_FACTOR;
}

/** Freight legs (km) from an origin country to a US buyer, through a US partner when not direct. */
export function freightLegs(originCountry: string): { truckKm: number; oceanKm: number } {
    const c = originCountry.toUpperCase();
    if (c === 'US') return { truckKm: 1500, oceanKm: 0 };
    if (c === 'MX' || c === 'CA') return { truckKm: 4000, oceanKm: 0 };
    if (ASIA.has(c)) return { truckKm: 2500, oceanKm: 12_000 };
    return { truckKm: 2500, oceanKm: 8000 };
}

export function estimateCo2Kg(input: { massKg: number; materialName: string; originCountry: string }): number {
    const mass = Math.max(0, input.massKg);
    const legs = freightLegs(input.originCountry);
    const tonnes = mass / 1000;
    const freight = tonnes * (legs.truckKm * FREIGHT_KG_CO2E_PER_TKM.truck + legs.oceanKm * FREIGHT_KG_CO2E_PER_TKM.ocean);
    return Math.round((mass * materialFactor(input.materialName) + freight) * 10) / 10;
}
