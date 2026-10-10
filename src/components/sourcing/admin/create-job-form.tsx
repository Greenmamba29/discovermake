'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BuildId, CreateSourcingRequest } from '@/contracts';
import { Button } from '@/components/ui/button';
import { Field, TextArea, TextInput } from '@/components/ui/field';
import { Notice } from '@/components/ui/state';
import { errorMessage } from '@/lib/api';
import { sourcingApi } from '../api';
import { dollarsToCents, splitList } from '../money-input';

/** Ops: open a sourcing job for a build (POST /api/admin/sourcing/jobs). */
export function CreateJobForm({ token }: { token: string }) {
    const router = useRouter();
    const qc = useQueryClient();
    const [f, setF] = useState({ buildId: '', partId: '', quantity: '100', material: '', process: '', surfaceFinish: '', targetUnit: '', date: '', regions: '', notes: '' });
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        setError(null);
        if (!BuildId.safeParse(f.buildId.trim()).success) return setError('Enter a build id (bld_…).');
        const cents = dollarsToCents(f.targetUnit);
        if (cents !== null && !Number.isFinite(cents)) return setError('Target unit price must be an amount like 4.50.');
        const process = splitList(f.process);
        const regions = splitList(f.regions).map((r) => r.toUpperCase());
        const parsed = CreateSourcingRequest.safeParse({
            ...(f.partId.trim() ? { partId: f.partId.trim() } : {}),
            quantity: Number(f.quantity),
            ...(f.material.trim() ? { material: f.material.trim() } : {}),
            ...(process.length ? { process } : {}),
            ...(f.surfaceFinish.trim() ? { surfaceFinish: f.surfaceFinish.trim() } : {}),
            ...(cents ? { targetUnitCostCents: cents } : {}),
            ...(f.date ? { targetDeliveryDate: f.date } : {}),
            ...(regions.length ? { targetRegions: regions } : {}),
            ...(f.notes.trim() ? { notes: f.notes.trim() } : {}),
        });
        if (!parsed.success) {
            const issue = parsed.error.issues[0];
            return setError(`${issue.path.join('.') || 'Request'}: ${issue.message}`);
        }
        setBusy(true);
        try {
            const job = await sourcingApi.adminCreateJob(token, { buildId: f.buildId.trim(), ...parsed.data });
            await qc.invalidateQueries({ queryKey: ['sourcing-jobs'] });
            if (job?.id) router.push(`/admin/sourcing/jobs/${encodeURIComponent(job.id)}`);
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <form onSubmit={submit} noValidate className="space-y-4 rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700 sm:p-5" data-testid="create-job-form">
            <div>
                <h2 className="font-display text-lg font-bold">New sourcing job</h2>
                <p className="text-sm text-fg-muted">Empty fields are filled from the build&apos;s current design version.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Build id">{({ id }) => <TextInput id={id} className="font-mono" value={f.buildId} onChange={set('buildId')} placeholder="bld_…" data-testid="create-job-build" />}</Field>
                <Field label="Part id" optional>{({ id }) => <TextInput id={id} className="font-mono" value={f.partId} onChange={set('partId')} placeholder="prt_…" />}</Field>
                <Field label="Quantity">{({ id }) => <TextInput id={id} type="number" min={1} inputMode="numeric" className="font-mono" value={f.quantity} onChange={set('quantity')} data-testid="create-job-quantity" />}</Field>
                <Field label="Target unit price (USD)" optional>{({ id }) => <TextInput id={id} inputMode="decimal" className="font-mono" value={f.targetUnit} onChange={set('targetUnit')} placeholder="4.50" />}</Field>
                <Field label="Material" optional>{({ id }) => <TextInput id={id} value={f.material} onChange={set('material')} />}</Field>
                <Field label="Processes" optional hint="Comma separated">{({ id, describedBy }) => <TextInput id={id} value={f.process} onChange={set('process')} aria-describedby={describedBy} />}</Field>
                <Field label="Surface finish" optional>{({ id }) => <TextInput id={id} value={f.surfaceFinish} onChange={set('surfaceFinish')} />}</Field>
                <Field label="Needed by" optional>{({ id }) => <TextInput id={id} type="date" value={f.date} onChange={set('date')} />}</Field>
                <Field label="Regions" optional hint="2-letter country codes, comma separated">{({ id, describedBy }) => <TextInput id={id} value={f.regions} onChange={set('regions')} aria-describedby={describedBy} placeholder="CN, VN, MX" />}</Field>
            </div>
            <Field label="Notes" optional>{({ id }) => <TextArea id={id} value={f.notes} maxLength={2000} onChange={set('notes')} />}</Field>
            {error && <Notice tone="error">{error}</Notice>}
            <Button type="submit" loading={busy} data-testid="create-job-submit">
                Create job
            </Button>
        </form>
    );
}
