'use client';

/**
 * "Make it in 3D" building blocks shared by the Build Workspace and /make/ai: the description
 * form, the progress while Make AI writes and the CAD worker builds, and the failure states in
 * plain words. Only for adult buyers: Kids mode uses project templates and never sends what a
 * kid types to Make AI.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Box, Loader2 } from 'lucide-react';
import { MakeIt3dPrompt, type MakeIt3dResponse } from '@/contracts/make-it-3d';
import { Button } from '@/components/ui/button';
import { Field, TextArea } from '@/components/ui/field';
import { Notice } from '@/components/ui/state';

const STAGES = ['Make AI is writing the model…', 'Building it in 3D…', 'Checking the shape and sizes…'] as const;

export function MakeIt3dProgress() {
    const [stage, setStage] = useState(0);
    useEffect(() => {
        const t = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 9000);
        return () => clearInterval(t);
    }, []);
    return (
        <div className="flex items-start gap-3 rounded-xl bg-graphite-850 p-4 ring-1 ring-inset ring-graphite-700" role="status" aria-live="polite" data-testid="make3d-progress">
            <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-signal" aria-hidden />
            <div className="min-w-0 text-sm">
                <p className="font-semibold">{STAGES[stage]}</p>
                <p className="mt-0.5 text-fg-muted">This usually takes under a minute. You can keep this page open.</p>
                <ol className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-subtle" aria-label="Steps">
                    {STAGES.map((s, i) => (
                        <li key={s} className={i <= stage ? 'text-fg' : undefined}>
                            {i + 1}. {s.replace('…', '')}
                        </li>
                    ))}
                </ol>
            </div>
        </div>
    );
}

export type MakeIt3dFailure = Extract<MakeIt3dResponse, { status: 'failed' | 'unavailable' }>;

export function MakeIt3dFailureNotice({ outcome }: { outcome: MakeIt3dFailure }) {
    if (outcome.status === 'unavailable') {
        return (
            <Notice tone="info" title="Make it in 3D is not available" testId="make3d-unavailable">
                {outcome.reason}
            </Notice>
        );
    }
    const title = outcome.code === 'GATE_REJECTED' ? 'Not built, to keep things safe' : outcome.code === 'TIMEOUT' ? 'That took too long' : outcome.code === 'UNAVAILABLE' ? 'Not available right now' : 'Could not make that one';
    return (
        <Notice tone={outcome.code === 'UNAVAILABLE' ? 'info' : 'error'} title={title} testId="make3d-failed">
            <span data-testid={`make3d-failed-${outcome.code}`}>{outcome.message}</span>
            {outcome.code === 'BUILD_FAILED' && outcome.detail ? <span className="mt-1 block text-xs text-fg-subtle">Last try: {outcome.detail}</span> : null}
        </Notice>
    );
}

export function MakeIt3dForm({
    initialPrompt = '',
    busy,
    disabled,
    submitLabel = 'Make it in 3D',
    onSubmit,
}: {
    initialPrompt?: string;
    busy: boolean;
    disabled?: boolean;
    submitLabel?: string;
    onSubmit: (prompt: string) => void;
}) {
    const [prompt, setPrompt] = useState(initialPrompt);
    const [error, setError] = useState<string | null>(null);
    const submit = (e: FormEvent) => {
        e.preventDefault();
        const parsed = MakeIt3dPrompt.safeParse(prompt);
        if (!parsed.success) {
            setError(parsed.error.issues[0]?.message ?? 'Describe the object.');
            return;
        }
        setError(null);
        onSubmit(parsed.data);
    };
    return (
        <form onSubmit={submit} noValidate className="space-y-3" data-testid="make3d-form">
            <Field label="What should it be?" hint="Say what it is for and the sizes you know, in millimetres or inches. Make AI writes a 3D model you can check before you order." error={error}>
                {({ id, describedBy, invalid }) => (
                    <TextArea
                        id={id}
                        rows={3}
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        aria-describedby={describedBy}
                        aria-invalid={invalid}
                        placeholder="A desk cable holder with three slots, about 60 mm long"
                        disabled={busy || disabled}
                        data-testid="make3d-prompt"
                    />
                )}
            </Field>
            <Button type="submit" loading={busy} disabled={busy || disabled} data-testid="make3d-submit">
                <Box className="h-4 w-4" aria-hidden />
                {submitLabel}
            </Button>
        </form>
    );
}
