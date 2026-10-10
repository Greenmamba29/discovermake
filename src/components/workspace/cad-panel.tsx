'use client';

/**
 * CAD for an approved design (EPIC-100-4). Make AI proposes a parametric spec from the
 * approved version, or the buyer enters dimensions; the CAD worker builds STEP / DXF /
 * GLB. Sheet parts go straight to the instant quote; anything else goes to sourcing.
 * Missing dimensions come back as questions, never as guesses.
 */
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Box, Download, Sparkles } from 'lucide-react';
import type { BuildGraphView } from '@/contracts';
import { CadSpec, type BuildCadGenerated, type BuildCadResponse, type CadFamily } from '@/contracts/cad';
import { Button, ButtonLink } from '@/components/ui/button';
import { Field, SelectInput, TextInput } from '@/components/ui/field';
import { Notice } from '@/components/ui/state';
import { ApiClientError, errorMessage } from '@/lib/api';
import { PanelCard } from './panels';
import { cadQueryKey, workspaceApi } from './workspace-api';
import { approvedVersion, latestVersion, openUnknowns } from './workspace-model';

const FAMILY_LABEL: Record<CadFamily, string> = {
    sheet_panel: 'Flat sheet panel',
    l_bracket: 'Bent L-bracket',
    enclosure: 'Enclosure with lid',
    u_channel: 'Bent U-channel',
    multi_bend_bracket: 'Multi-bend bracket (Z / hat)',
    slotted_plate: 'Plate with slots and countersinks',
    sheet_enclosure: 'Sheet-metal enclosure',
    round_knob: 'Printed round knob',
    spacer_bushing: 'Printed spacer / bushing',
};

/** Families the buyer can size with plain numbers (multi-bend and slotted plates need Make AI or the API). */
const FIELDS: Partial<Record<CadFamily, { key: string; label: string }[]>> = {
    sheet_panel: [
        { key: 'width_mm', label: 'Width (mm)' },
        { key: 'height_mm', label: 'Height (mm)' },
        { key: 'thickness_mm', label: 'Thickness (mm)' },
    ],
    l_bracket: [
        { key: 'leg_a_mm', label: 'Leg A, outside (mm)' },
        { key: 'leg_b_mm', label: 'Leg B, outside (mm)' },
        { key: 'width_mm', label: 'Width (mm)' },
        { key: 'thickness_mm', label: 'Thickness (mm)' },
        { key: 'inside_bend_radius_mm', label: 'Inside bend radius (mm)' },
    ],
    enclosure: [
        { key: 'inner_x_mm', label: 'Inside length (mm)' },
        { key: 'inner_y_mm', label: 'Inside width (mm)' },
        { key: 'inner_z_mm', label: 'Inside height (mm)' },
        { key: 'wall_mm', label: 'Wall (mm)' },
    ],
    u_channel: [
        { key: 'flange_a_mm', label: 'Flange A, outside (mm)' },
        { key: 'base_mm', label: 'Base, outside (mm)' },
        { key: 'flange_b_mm', label: 'Flange B, outside (mm)' },
        { key: 'length_mm', label: 'Length (mm)' },
        { key: 'thickness_mm', label: 'Thickness (mm)' },
        { key: 'inside_bend_radius_mm', label: 'Inside bend radius (mm)' },
    ],
    sheet_enclosure: [
        { key: 'inner_x_mm', label: 'Inside length (mm)' },
        { key: 'inner_y_mm', label: 'Inside width (mm)' },
        { key: 'inner_z_mm', label: 'Inside height (mm)' },
        { key: 'thickness_mm', label: 'Sheet thickness (mm)' },
        { key: 'inside_bend_radius_mm', label: 'Inside bend radius (mm)' },
    ],
};
const MANUAL_FAMILIES = Object.keys(FIELDS) as CadFamily[];

export function CadPanel({ view, isCurrent }: { view: BuildGraphView; isCurrent: boolean }) {
    const buildId = view.build.id;
    const queryClient = useQueryClient();
    const cad = useQuery({ queryKey: cadQueryKey(buildId), queryFn: ({ signal }) => workspaceApi.cad(buildId, signal) });
    const [outcome, setOutcome] = useState<Exclude<BuildCadResponse, BuildCadGenerated> | null>(null);
    const [manual, setManual] = useState(false);

    const generate = useMutation({
        mutationFn: (spec?: CadSpec) => workspaceApi.generateCad(buildId, spec),
        onSuccess: async (res) => {
            setOutcome(res.status === 'generated' ? null : res);
            if (res.status === 'generated') setManual(false);
            await Promise.all([queryClient.invalidateQueries({ queryKey: cadQueryKey(buildId) }), queryClient.invalidateQueries({ queryKey: ['build-graph', buildId] })]);
        },
    });

    const unavailable = generate.error instanceof ApiClientError && generate.error.status === 501;
    const ready = isCurrent && approvedVersion(view) === latestVersion(view) && openUnknowns(view).length === 0;
    const record = cad.data ?? null;

    return (
        <PanelCard title="CAD" icon={<Box className="h-5 w-5" />} testId="workspace-cad">
            {record ? <CadResult record={record} /> : <p className="text-sm text-fg-muted">No geometry yet. Generate CAD from the approved plan, or upload your own flat-pattern DXF.</p>}

            {outcome?.status === 'needs_input' && (
                <Notice tone="warning" title="Make AI needs a few dimensions" >
                    <span data-testid="cad-needs-input">We added {outcome.questions.length === 1 ? 'a question' : `${outcome.questions.length} questions`} instead of guessing. Answer {outcome.questions.length === 1 ? 'it' : 'them'} in Questions, approve the new version, then generate again.</span>
                </Notice>
            )}
            {outcome?.status === 'not_supported' && (
                <Notice tone="info" title="Not a shape we generate yet">
                    <span data-testid="cad-not-supported">{outcome.reason} Upload a DXF, or ask our manufacturing partners to quote it below.</span>
                </Notice>
            )}
            {generate.error && !unavailable && <Notice tone="error">{errorMessage(generate.error)}</Notice>}
            {unavailable && <Notice tone="info">CAD generation is not switched on yet. Upload a flat-pattern DXF to get a binding quote.</Notice>}

            {ready && !unavailable && (
                <div className="mt-4 flex flex-wrap gap-2">
                    <Button onClick={() => generate.mutate(undefined)} loading={generate.isPending && !manual} disabled={generate.isPending} data-testid="cad-generate-ai">
                        <Sparkles className="h-4 w-4" aria-hidden />
                        {record ? 'Regenerate with Make AI' : 'Generate CAD with Make AI'}
                    </Button>
                    <Button variant="secondary" onClick={() => setManual((m) => !m)} aria-expanded={manual} data-testid="cad-manual-toggle">
                        Enter dimensions
                    </Button>
                </div>
            )}
            {!ready && isCurrent && !record && <p className="mt-3 text-xs text-fg-subtle">Answer the open questions and approve the latest version to generate CAD.</p>}
            {manual && ready && <ManualSpecForm busy={generate.isPending} onSubmit={(spec) => generate.mutate(spec)} />}
        </PanelCard>
    );
}

function CadResult({ record }: { record: BuildCadGenerated }) {
    const m = record.metrics;
    return (
        <div className="space-y-3" data-testid="cad-result">
            <p className="text-sm">
                <span className="font-semibold">{FAMILY_LABEL[record.family]}</span>
                <span className="text-fg-muted"> · version {record.version} · {m.bbox_mm.map((v) => Math.round(v * 10) / 10).join(' × ')} mm</span>
                {m.bend_count ? <span className="text-fg-muted"> · {m.bend_count} bend{m.bend_count === 1 ? '' : 's'}</span> : null}
            </p>
            {record.warnings.length > 0 && (
                <ul className="list-disc pl-5 text-sm text-amber">
                    {record.warnings.map((w) => (
                        <li key={w}>{w}</li>
                    ))}
                </ul>
            )}
            {record.dropped.length > 0 && <p className="text-xs text-fg-subtle">Left out because you did not specify them: {record.dropped.join('; ')}.</p>}
            <ul className="flex flex-wrap gap-2">
                {record.artifacts.map((a) => (
                    <li key={a.filename}>
                        <a href={a.url} download={a.filename} className="inline-flex items-center gap-1.5 rounded-lg bg-graphite-850 px-2.5 py-1.5 font-mono text-xs ring-1 ring-graphite-600 hover:ring-signal focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal" data-testid={`cad-download-${a.kind}`}>
                            <Download className="h-3.5 w-3.5" aria-hidden />
                            {a.kind} · {Math.max(1, Math.round(a.bytes / 1024))} KB
                        </a>
                    </li>
                ))}
            </ul>
            {record.quotable && record.partId ? (
                <ButtonLink href={`/parts/${record.partId}`} data-testid="cad-instant-quote">
                    Get an instant binding quote
                    <ArrowRight className="h-4 w-4" aria-hidden />
                </ButtonLink>
            ) : record.partId ? (
                <p className="text-sm text-fg-muted">The flat pattern needs a look before it can be quoted instantly. Ask our partners below.</p>
            ) : (
                <p className="text-sm text-fg-muted">{record.processes.join(' or ')} parts are quoted by manufacturing partners. Request offers below.</p>
            )}
        </div>
    );
}

function ManualSpecForm({ busy, onSubmit }: { busy: boolean; onSubmit: (spec: CadSpec) => void }) {
    const [family, setFamily] = useState<CadFamily>('l_bracket');
    const [values, setValues] = useState<Record<string, string>>({});
    const [error, setError] = useState<string | null>(null);

    const submit = (e: FormEvent) => {
        e.preventDefault();
        const numbers = Object.fromEntries((FIELDS[family] ?? []).filter((f) => values[f.key]?.trim()).map((f) => [f.key, Number(values[f.key])]));
        const parsed = CadSpec.safeParse({ family, ...numbers });
        if (!parsed.success) {
            const issue = parsed.error.issues[0];
            const field = (FIELDS[family] ?? []).find((f) => f.key === issue?.path[0]);
            setError(`${field?.label ?? 'A dimension'}: ${issue?.message ?? 'check the value'}`);
            return;
        }
        setError(null);
        onSubmit(parsed.data);
    };

    return (
        <form onSubmit={submit} noValidate className="mt-4 space-y-3 rounded-xl bg-graphite-850 p-4 ring-1 ring-graphite-600" data-testid="cad-manual-form">
            <Field label="Shape">
                {({ id }) => (
                    <SelectInput id={id} value={family} onChange={(e) => setFamily(e.target.value as CadFamily)} data-testid="cad-family">
                        {MANUAL_FAMILIES.map((f) => (
                            <option key={f} value={f}>
                                {FAMILY_LABEL[f]}
                            </option>
                        ))}
                    </SelectInput>
                )}
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
                {(FIELDS[family] ?? []).map((f) => (
                    <Field key={`${family}-${f.key}`} label={f.label}>
                        {({ id }) => (
                            <TextInput id={id} inputMode="decimal" value={values[f.key] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} data-testid={`cad-field-${f.key}`} />
                        )}
                    </Field>
                ))}
            </div>
            {error && (
                <p className="text-sm text-ember" role="alert">
                    {error}
                </p>
            )}
            <Button type="submit" loading={busy} data-testid="cad-manual-submit">
                Generate CAD
            </Button>
        </form>
    );
}
