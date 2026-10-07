'use client';

import { useId, useState, type FormEvent } from 'react';
import { INCOTERMS, NEGOTIATION_STATUSES, SubmitOfferInput, SubmitSupplierInput, type SourcingJobView } from '@/contracts';
import { Button } from '@/components/ui/button';
import { Field, SelectInput, TextArea, TextInput } from '@/components/ui/field';
import { Notice } from '@/components/ui/state';
import { errorMessage } from '@/lib/api';
import { idFromResponse, sourcingApi } from '../api';
import { dollarsToCents, splitList } from '../money-input';
import { NEGOTIATION_LABEL } from './labels';

const DeskSupplier = SubmitSupplierInput.omit({ lease_id: true });
const DeskOffer = SubmitOfferInput.omit({ lease_id: true });

const PLATFORMS = ['alibaba', '1688', 'made-in-china', 'global-sources', 'direct', 'other'] as const;
const EVIDENCE_KINDS = ['platform_profile', 'verified_badge', 'certificate', 'factory_photo', 'transaction_history', 'website', 'other'] as const;

function firstIssue(err: { issues: { path: (string | number)[]; message: string }[] }): string {
    const i = err.issues[0];
    return `${i.path.join('.') || 'Form'}: ${i.message}`;
}

function newKey(): string {
    try {
        return `desk-${crypto.randomUUID()}`;
    } catch {
        return `desk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }
}

/** Desk fallback: register a supplier on this job (POST /api/admin/sourcing/jobs/:jobId/suppliers). */
export function DeskSupplierForm({ token, job, onCreated }: { token: string; job: SourcingJobView; onCreated: (s: { id: string; name: string }) => void }) {
    const [f, setF] = useState({ name: '', platform: 'alibaba', platformRef: '', country: '', verified: false, profileUrl: '', capabilities: '', evidenceKind: 'platform_profile', evidenceUrl: '', evidenceNote: '' });
    const [error, setError] = useState<string | null>(null);
    const [ok, setOk] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        setError(null);
        setOk(null);
        const parsed = DeskSupplier.safeParse({
            sourcing_request_id: job.id,
            name: f.name,
            platform: f.platform,
            ...(f.platformRef.trim() ? { platform_ref: f.platformRef.trim() } : {}),
            country: f.country,
            verified: f.verified,
            ...(f.profileUrl.trim() ? { profile_url: f.profileUrl.trim() } : {}),
            capabilities: splitList(f.capabilities),
            evidence: f.evidenceNote.trim() ? [{ kind: f.evidenceKind, note: f.evidenceNote.trim(), ...(f.evidenceUrl.trim() ? { url: f.evidenceUrl.trim() } : {}) }] : [],
        });
        if (!parsed.success) return setError(firstIssue(parsed.error));
        setBusy(true);
        try {
            const res = await sourcingApi.adminAddSupplier(token, job.id, parsed.data);
            const id = idFromResponse(res, 'supplier');
            setOk(id ? `Supplier saved as ${id}. Add its offer below.` : 'Supplier saved.');
            if (id) onCreated({ id, name: parsed.data.name });
            setF((s) => ({ ...s, name: '', platformRef: '', profileUrl: '', capabilities: '', evidenceUrl: '', evidenceNote: '' }));
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <form onSubmit={submit} noValidate className="space-y-4" data-testid="desk-supplier-form" aria-label="Add supplier">
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Supplier name">{({ id }) => <TextInput id={id} value={f.name} maxLength={200} onChange={set('name')} data-testid="desk-supplier-name" />}</Field>
                <Field label="Platform">
                    {({ id }) => (
                        <SelectInput id={id} value={f.platform} onChange={set('platform')}>
                            {PLATFORMS.map((p) => (
                                <option key={p} value={p}>
                                    {p}
                                </option>
                            ))}
                        </SelectInput>
                    )}
                </Field>
                <Field label="Platform supplier ref" optional hint="Used to de-duplicate suppliers">{({ id, describedBy }) => <TextInput id={id} className="font-mono" value={f.platformRef} onChange={set('platformRef')} aria-describedby={describedBy} />}</Field>
                <Field label="Country" hint="2-letter code, e.g. CN">{({ id, describedBy }) => <TextInput id={id} className="font-mono uppercase" maxLength={2} value={f.country} onChange={set('country')} aria-describedby={describedBy} data-testid="desk-supplier-country" />}</Field>
                <Field label="Profile URL" optional>{({ id }) => <TextInput id={id} type="url" value={f.profileUrl} onChange={set('profileUrl')} />}</Field>
                <Field label="Capabilities" optional hint="Comma separated">{({ id, describedBy }) => <TextInput id={id} value={f.capabilities} onChange={set('capabilities')} aria-describedby={describedBy} />}</Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-signal" checked={f.verified} onChange={(e) => setF((s) => ({ ...s, verified: e.target.checked }))} />
                Verified on the platform
            </label>
            <fieldset className="grid gap-4 rounded-xl bg-graphite-850 p-3 ring-1 ring-graphite-700 sm:grid-cols-3">
                <legend className="px-1 text-sm font-medium">Evidence <span className="text-xs font-normal text-fg-subtle">Optional</span></legend>
                <Field label="Kind">
                    {({ id }) => (
                        <SelectInput id={id} value={f.evidenceKind} onChange={set('evidenceKind')}>
                            {EVIDENCE_KINDS.map((k) => (
                                <option key={k} value={k}>
                                    {k.replace(/_/g, ' ')}
                                </option>
                            ))}
                        </SelectInput>
                    )}
                </Field>
                <Field label="URL" optional>{({ id }) => <TextInput id={id} type="url" value={f.evidenceUrl} onChange={set('evidenceUrl')} />}</Field>
                <Field label="Note">{({ id }) => <TextInput id={id} value={f.evidenceNote} maxLength={500} onChange={set('evidenceNote')} />}</Field>
            </fieldset>
            {error && <Notice tone="error">{error}</Notice>}
            {ok && <Notice tone="success">{ok}</Notice>}
            <Button type="submit" loading={busy} data-testid="desk-supplier-submit">
                Add supplier
            </Button>
        </form>
    );
}

/** Desk fallback: record a normalized offer (POST /api/admin/sourcing/jobs/:jobId/offers). Amounts typed in dollars, sent as cents. */
export function DeskOfferForm({ token, job, suppliers, onCreated }: { token: string; job: SourcingJobView; suppliers: { id: string; name: string }[]; onCreated: () => void }) {
    const listId = useId();
    const [f, setF] = useState({
        supplierId: '',
        quantity: String(job.request.quantity),
        unitPrice: '',
        tooling: '',
        sampleCost: '',
        shipping: '',
        moq: '1',
        productionLeadDays: '',
        shippingLeadDays: '',
        incoterm: 'FOB',
        material: job.request.material,
        processes: job.request.process.join(', '),
        certifications: '',
        exceptions: '',
        confidence: '0.8',
        negotiationStatus: 'supplier-estimate',
        validUntil: '',
    });
    const [key, setKey] = useState(newKey);
    const [error, setError] = useState<string | null>(null);
    const [ok, setOk] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        setError(null);
        setOk(null);
        const unit = dollarsToCents(f.unitPrice);
        const tooling = dollarsToCents(f.tooling);
        const sample = dollarsToCents(f.sampleCost);
        const shipping = dollarsToCents(f.shipping);
        for (const [label, v] of [
            ['Unit price', unit],
            ['Tooling', tooling],
            ['Sample cost', sample],
            ['Shipping', shipping],
        ] as const) {
            if (v !== null && !Number.isFinite(v)) return setError(`${label} must be an amount like 12.50.`);
        }
        if (unit === null) return setError('Enter the unit price.');
        const parsed = DeskOffer.safeParse({
            sourcing_request_id: job.id,
            idempotency_key: key,
            supplier_id: f.supplierId.trim(),
            design_version: job.designVersion,
            quantity: Number(f.quantity),
            currency: 'usd',
            unit_price_cents: unit,
            tooling_cents: tooling ?? 0,
            sample_cost_cents: sample,
            shipping_cents: shipping,
            moq: Number(f.moq),
            production_lead_days: Number(f.productionLeadDays),
            shipping_lead_days: Number(f.shippingLeadDays),
            incoterm: f.incoterm,
            material: f.material,
            processes: splitList(f.processes),
            certifications_claimed: splitList(f.certifications),
            exceptions: splitList(f.exceptions, /\n/),
            confidence: Number(f.confidence),
            negotiation_status: f.negotiationStatus,
            valid_until: f.validUntil ? `${f.validUntil}T23:59:59.000Z` : null,
        });
        if (!parsed.success) return setError(firstIssue(parsed.error));
        setBusy(true);
        try {
            await sourcingApi.adminAddOffer(token, job.id, parsed.data);
            setOk('Offer recorded.');
            setKey(newKey());
            setF((s) => ({ ...s, unitPrice: '', tooling: '', sampleCost: '', shipping: '', exceptions: '' }));
            onCreated();
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <form onSubmit={submit} noValidate className="space-y-4" data-testid="desk-offer-form" aria-label="Add offer">
            <p className="text-xs text-fg-subtle">
                Design version {job.designVersion}. Any exception makes the offer a supplier estimate that needs a human decision before a buyer can select it.
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Supplier id" hint="Pick a known supplier or paste sup_…">
                    {({ id, describedBy }) => (
                        <>
                            <TextInput id={id} list={listId} className="font-mono" value={f.supplierId} onChange={set('supplierId')} aria-describedby={describedBy} data-testid="desk-offer-supplier" />
                            <datalist id={listId}>
                                {suppliers.map((s) => (
                                    <option key={s.id} value={s.id}>
                                        {s.name}
                                    </option>
                                ))}
                            </datalist>
                        </>
                    )}
                </Field>
                <Field label="Quantity">{({ id }) => <TextInput id={id} type="number" min={1} className="font-mono" value={f.quantity} onChange={set('quantity')} />}</Field>
                <Field label="MOQ">{({ id }) => <TextInput id={id} type="number" min={1} className="font-mono" value={f.moq} onChange={set('moq')} />}</Field>
                <Field label="Unit price (USD)">{({ id }) => <TextInput id={id} inputMode="decimal" className="font-mono" value={f.unitPrice} onChange={set('unitPrice')} placeholder="3.20" data-testid="desk-offer-unit" />}</Field>
                <Field label="Tooling (USD)" optional>{({ id }) => <TextInput id={id} inputMode="decimal" className="font-mono" value={f.tooling} onChange={set('tooling')} />}</Field>
                <Field label="Sample cost (USD)" optional>{({ id }) => <TextInput id={id} inputMode="decimal" className="font-mono" value={f.sampleCost} onChange={set('sampleCost')} />}</Field>
                <Field label="Freight (USD)" optional hint="Under the incoterm; empty if not quoted">{({ id, describedBy }) => <TextInput id={id} inputMode="decimal" className="font-mono" value={f.shipping} onChange={set('shipping')} aria-describedby={describedBy} />}</Field>
                <Field label="Production days">{({ id }) => <TextInput id={id} type="number" min={1} className="font-mono" value={f.productionLeadDays} onChange={set('productionLeadDays')} data-testid="desk-offer-prod-days" />}</Field>
                <Field label="Shipping days">{({ id }) => <TextInput id={id} type="number" min={0} className="font-mono" value={f.shippingLeadDays} onChange={set('shippingLeadDays')} data-testid="desk-offer-ship-days" />}</Field>
                <Field label="Incoterm">
                    {({ id }) => (
                        <SelectInput id={id} value={f.incoterm} onChange={set('incoterm')}>
                            {INCOTERMS.map((i) => (
                                <option key={i} value={i}>
                                    {i}
                                </option>
                            ))}
                        </SelectInput>
                    )}
                </Field>
                <Field label="Negotiation status">
                    {({ id }) => (
                        <SelectInput id={id} value={f.negotiationStatus} onChange={set('negotiationStatus')}>
                            {NEGOTIATION_STATUSES.map((n) => (
                                <option key={n} value={n}>
                                    {NEGOTIATION_LABEL[n]}
                                </option>
                            ))}
                        </SelectInput>
                    )}
                </Field>
                <Field label="Confidence (0–1)">{({ id }) => <TextInput id={id} inputMode="decimal" className="font-mono" value={f.confidence} onChange={set('confidence')} />}</Field>
                <Field label="Valid until" optional>{({ id }) => <TextInput id={id} type="date" value={f.validUntil} onChange={set('validUntil')} />}</Field>
                <Field label="Material">{({ id }) => <TextInput id={id} value={f.material} onChange={set('material')} />}</Field>
                <Field label="Processes" hint="Comma separated">{({ id, describedBy }) => <TextInput id={id} value={f.processes} onChange={set('processes')} aria-describedby={describedBy} />}</Field>
                <Field label="Certifications claimed" optional hint="Comma separated">{({ id, describedBy }) => <TextInput id={id} value={f.certifications} onChange={set('certifications')} aria-describedby={describedBy} />}</Field>
            </div>
            <Field label="Exceptions" optional hint="One per line: anything that differs from the request (material, tolerance, finish).">
                {({ id, describedBy }) => <TextArea id={id} value={f.exceptions} onChange={set('exceptions')} aria-describedby={describedBy} />}
            </Field>
            {error && <Notice tone="error">{error}</Notice>}
            {ok && <Notice tone="success">{ok}</Notice>}
            <Button type="submit" loading={busy} data-testid="desk-offer-submit">
                Add offer
            </Button>
        </form>
    );
}
