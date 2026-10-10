'use client';

/**
 * Build Workspace (EPIC-300, workflow 10) at /build/:buildId/workspace.
 *
 * Reads the Build Graph through GET /api/builds/:buildId/graph (current version, or an older
 * one picked in Versions / Graph) and writes through the graph routes: answers (new version),
 * approve, remix and clone. Every change comes back as a server-validated BuildGraphView.
 */
import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye } from 'lucide-react';
import type { BuildGraphView } from '@/contracts';
import { Button, ButtonLink } from '@/components/ui/button';
import { PageSkeleton } from '@/components/ui/skeleton';
import { ErrorState, Notice } from '@/components/ui/state';
import { ApiClientError, errorMessage } from '@/lib/api';
import { AssistantPanel } from './assistant-panel';
import { AttachmentTray } from './attachment-tray';
import { BuildShell } from './build-shell';
import { ForkActions } from './fork-actions';
import { GraphPanel } from './graph-panel';
import { OverviewPanel } from './overview-panel';
import { ObjectView } from './object-view/object-view';
import { MaterialsPanel, PartsPanel, RequirementsPanel } from './panels';
import { QuestionCards } from './question-cards';
import { StatusStrip } from './status-strip';
import { VersionsPanel } from './versions-panel';
import { graphQueryKey, workspaceApi, type WorkspaceAnswer } from './workspace-api';
import { answeredUnknowns, approvedVersion, availableSections, isWorkspaceSection, latestVersion, openUnknowns, type WorkspaceSection } from './workspace-model';

export function BuildWorkspace({ buildId, initialSection }: { buildId: string; initialSection?: string | null }) {
    const qc = useQueryClient();
    const [section, setSection] = useState<WorkspaceSection>(isWorkspaceSection(initialSection) ? initialSection : 'overview');
    const [viewing, setViewing] = useState<number | null>(null);

    const current = useQuery({ queryKey: graphQueryKey(buildId, null), queryFn: ({ signal }) => workspaceApi.graph(buildId, null, signal) });
    const currentVersion = current.data?.version.version ?? null;
    const wantsOlder = viewing !== null && currentVersion !== null && viewing !== currentVersion;
    const older = useQuery({
        queryKey: graphQueryKey(buildId, viewing),
        queryFn: ({ signal }) => workspaceApi.graph(buildId, viewing, signal),
        enabled: wantsOlder,
    });

    const refresh = (view: BuildGraphView) => {
        qc.setQueryData(graphQueryKey(buildId, view.version.version), view);
        void qc.invalidateQueries({ queryKey: ['build-graph', buildId] });
    };

    const answer = useMutation({
        mutationFn: (answers: WorkspaceAnswer[]) => workspaceApi.answer(buildId, answers),
        onSuccess: (view) => {
            qc.setQueryData(graphQueryKey(buildId, null), view);
            refresh(view);
            setViewing(null);
        },
    });
    /** A confirmed Make AI change or a manual requirement: a new current version. */
    const onNewVersion = useCallback(
        (view: BuildGraphView) => {
            qc.setQueryData(graphQueryKey(buildId, null), view);
            refresh(view);
            setViewing(null);
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [buildId, qc],
    );
    const approve = useMutation({
        mutationFn: (version: number) => workspaceApi.approve(buildId, version),
        onSuccess: (view) => refresh(view),
    });

    if (current.isPending) return <PageSkeleton label="Loading the build workspace" />;
    if (current.isError) {
        const missing = current.error instanceof ApiClientError && current.error.status === 404;
        return (
            <ErrorState
                title={missing ? 'No workspace for this build' : 'Could not load this build'}
                message={missing ? 'This build has no Build Graph. Workspaces exist for builds planned with Make AI, remixes and copies.' : errorMessage(current.error)}
                action={
                    missing ? (
                        <>
                            <ButtonLink href="/make/ai">Plan with Make AI</ButtonLink>
                            <ButtonLink href="/make" variant="secondary">
                                Upload a DXF
                            </ButtonLink>
                        </>
                    ) : (
                        <Button onClick={() => current.refetch()}>Try again</Button>
                    )
                }
            />
        );
    }

    const base = current.data;
    const view = wantsOlder && older.data ? older.data : base;
    const isCurrent = view.version.version === latestVersion(base);
    const sections = availableSections(view);
    const active = sections.includes(section) ? section : 'overview';
    const go = (s: WorkspaceSection) => {
        setSection(s);
        // Keep the section in the URL (shareable, survives reload) without a Next navigation.
        if (typeof window !== 'undefined') {
            const url = new URL(window.location.href);
            if (s === 'overview') url.searchParams.delete('section');
            else url.searchParams.set('section', s);
            window.history.replaceState(window.history.state, '', url);
        }
    };

    const banner = wantsOlder ? (
        older.isError ? (
            <Notice tone="error" title={`Could not load version ${viewing}`} action={<Button size="sm" variant="secondary" onClick={() => setViewing(null)}>Back to the current version</Button>}>
                {errorMessage(older.error)}
            </Notice>
        ) : (
            <Notice
                tone="warning"
                title={older.isPending ? `Loading version ${viewing}…` : `Viewing version ${view.version.version} (read-only)`}
                action={
                    <Button size="sm" variant="secondary" onClick={() => setViewing(null)}>
                        <Eye className="h-4 w-4" aria-hidden />
                        Back to v{base.version.version}
                    </Button>
                }
            >
                Answers and approvals apply to the current version.
            </Notice>
        )
    ) : null;

    return (
        <BuildShell
            build={view.build}
            sections={sections}
            active={active}
            onSelect={go}
            actions={<ForkActions buildId={buildId} approvedVersion={approvedVersion(base)} />}
            statusStrip={<StatusStrip view={view} onOpenQuestions={sections.includes('questions') ? () => go('questions') : undefined} />}
            banner={banner}
        >
            {active === 'overview' && <OverviewPanel view={view} onGo={go} isCurrent={isCurrent} />}
            {active === 'object' && <ObjectView view={view} onGo={go} isCurrent={isCurrent} />}
            {active === 'requirements' && <RequirementsPanel view={view} />}
            {active === 'questions' && (
                <QuestionCards
                    open={openUnknowns(view)}
                    answered={answeredUnknowns(view)}
                    onAnswer={(answers) => answer.mutate(answers)}
                    pending={answer.isPending}
                    error={answer.isError ? errorMessage(answer.error) : null}
                    readOnly={!isCurrent}
                />
            )}
            {active === 'materials' && <MaterialsPanel view={view} />}
            {active === 'parts' && <PartsPanel view={view} />}
            {active === 'attachments' && <AttachmentTray buildId={buildId} />}
            {active === 'assistant' && <AssistantPanel view={base} isCurrent={isCurrent} onChanged={onNewVersion} />}
            {active === 'graph' && <GraphPanel view={view} />}
            {active === 'versions' && (
                <VersionsPanel
                    key={latestVersion(base)}
                    buildId={buildId}
                    view={base}
                    viewing={view.version.version}
                    onView={(v) => setViewing(v === base.version.version ? null : v)}
                    onApprove={async (v) => {
                        await approve.mutateAsync(v).catch(() => undefined);
                    }}
                    approving={approve.isPending}
                    approveError={approve.isError ? errorMessage(approve.error) : null}
                />
            )}
        </BuildShell>
    );
}
