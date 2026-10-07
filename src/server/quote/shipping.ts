/**
 * Binding shipping options for a quote (checkout reads them from the snapshot).
 *
 * R1 has no live carrier rating at quote time, so options come from a
 * versioned rate table on billable weight (max of actual and dimensional
 * weight). The platform absorbs carrier variance against these prices.
 * ALL rates are uncalibrated defaults (see PRICING_VERSION).
 */
import type { ShippingOption } from '../../contracts/quotes';
import type { ShippingMethod } from '../../contracts/enums';
import { addBusinessDays } from './leadtime';

type Rate = { method: ShippingMethod; label: string; baseCents: number; perKgCents: number; transitDays: number };

export const SHIPPING_RATES: Rate[] = [
    { method: 'STANDARD', label: 'Standard ground (1–5 business days)', baseCents: 1200, perKgCents: 150, transitDays: 5 },
    { method: 'EXPEDITED', label: 'Expedited 2-day', baseCents: 2600, perKgCents: 380, transitDays: 2 },
    { method: 'EXPRESS', label: 'Express overnight', baseCents: 4500, perKgCents: 700, transitDays: 1 },
];

/** Parcel limits (UPS/FedEx ground): above these the order ships LTL freight (standard only). */
export const PARCEL_MAX_KG = 68;
export const OVERSIZE_LONGEST_MM = 1000;
export const OVERSIZE_SURCHARGE_CENTS = 3500;
export const FREIGHT = { baseCents: 9500, perKgCents: 120, transitDays: 6 };
/** Dimensional weight divisor (cm³ per kg). */
export const DIM_DIVISOR_CM3_PER_KG = 5000;

export type ShippingInput = {
    shipDate: string;
    unitMassG: number;
    quantity: number;
    bboxWidthMm: number;
    bboxHeightMm: number;
    thicknessMm: number;
};

const roundUp50 = (cents: number) => Math.ceil(cents / 50) * 50;

export function billableWeightKg(input: ShippingInput): number {
    const actual = (input.unitMassG * input.quantity * 1.1) / 1000 + 0.3; // +10% dunnage, + box
    const lengthCm = (Math.max(input.bboxWidthMm, input.bboxHeightMm) + 50) / 10;
    const widthCm = (Math.min(input.bboxWidthMm, input.bboxHeightMm) + 50) / 10;
    const heightCm = (input.thicknessMm * input.quantity * 1.2 + 40) / 10;
    const dim = (lengthCm * widthCm * heightCm) / DIM_DIVISOR_CM3_PER_KG;
    return Math.max(actual, dim);
}

export function shippingOptions(input: ShippingInput): ShippingOption[] {
    const kg = billableWeightKg(input);
    const oversize = Math.max(input.bboxWidthMm, input.bboxHeightMm) > OVERSIZE_LONGEST_MM;
    if (kg > PARCEL_MAX_KG) {
        return [
            {
                method: 'STANDARD',
                label: 'Freight (LTL, liftgate)',
                priceCents: roundUp50(FREIGHT.baseCents + FREIGHT.perKgCents * kg),
                transitDays: FREIGHT.transitDays,
                deliveryDate: addBusinessDays(input.shipDate, FREIGHT.transitDays),
            },
        ];
    }
    return SHIPPING_RATES.map((r) => ({
        method: r.method,
        label: r.label,
        priceCents: roundUp50(r.baseCents + r.perKgCents * kg + (oversize ? OVERSIZE_SURCHARGE_CENTS : 0)),
        transitDays: r.transitDays,
        deliveryDate: addBusinessDays(input.shipDate, r.transitDays),
    }));
}
