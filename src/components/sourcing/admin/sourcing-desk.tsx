'use client';

import { useRef, useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/state';
import { cn } from '@/lib/utils';
import { sourcingApi } from '../api';
import { AdminGate, isUnauthorized } from './admin-gate';
import { ApprovalsInbox } from './approvals-inbox';
import { ClientsPanel } from './clients-panel';
import { CreateJobForm } from './create-job-form';
import { DeskHeader } from './desk-header';
import { JobQueue } from './job-queue';

const TABS = [
    { id: 'queue', label: 'Job queue' },
    { id: 'approvals', label: 'Approvals' },
    { id: 'new', label: 'New job' },
    { id: 'clients', label: 'Accio clients' },
] as const;
type TabId = (typeof TABS)[number]['id'];

/** Ops sourcing desk (ADR-0005): job queue, pending approvals, desk-created jobs and Accio clients. */
export function SourcingDesk() {
    return <AdminGate>{(token, signOut) => <Desk token={token} onSignOut={signOut} />}</AdminGate>;
}

function Desk({ token, onSignOut }: { token: string; onSignOut: () => void }) {
    const [tab, setTab] = useState<TabId>('queue');
    const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
    const pending = useQuery({ queryKey: ['sourcing-approvals', token, 'PENDING'], queryFn: () => sourcingApi.adminApprovals(token, 'PENDING'), refetchInterval: 15_000 });

    if (isUnauthorized(pending.error)) {
        return <ErrorState title="Admin token rejected" message="Sign in again with a valid token." action={<Button onClick={onSignOut}>Sign in again</Button>} />;
    }

    const onKey = (e: KeyboardEvent, i: number) => {
        const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!dir && e.key !== 'Home' && e.key !== 'End') return;
        e.preventDefault();
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : (i + dir + TABS.length) % TABS.length;
        setTab(TABS[next].id);
        tabRefs.current[next]?.focus();
    };
    const count = pending.data?.length ?? 0;

    return (
        <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
            <DeskHeader title="Sourcing desk" back={{ href: '/admin', label: 'Ops board' }} onSignOut={onSignOut} />
            <div className="-mx-4 mt-6 overflow-x-auto px-4 sm:mx-0 sm:px-0">
                <div className="flex w-max gap-1 rounded-xl bg-graphite-900 p-1 ring-1 ring-graphite-700 sm:w-full" role="tablist" aria-label="Sourcing desk sections">
                    {TABS.map((t, i) => (
                        <button
                            key={t.id}
                            ref={(el) => {
                                tabRefs.current[i] = el;
                            }}
                            type="button"
                            role="tab"
                            id={`desk-tab-${t.id}`}
                            aria-selected={tab === t.id}
                            aria-controls={`desk-panel-${t.id}`}
                            tabIndex={tab === t.id ? 0 : -1}
                            onClick={() => setTab(t.id)}
                            onKeyDown={(e) => onKey(e, i)}
                            className={cn(
                                'inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-signal sm:flex-1',
                                tab === t.id ? 'bg-graphite-700 text-fg' : 'text-fg-muted hover:text-fg',
                            )}
                            data-testid={`desk-tab-${t.id}`}
                        >
                            {t.label}
                            {t.id === 'approvals' && count > 0 && (
                                <span className="rounded-full bg-amber/20 px-1.5 text-[11px] font-bold text-amber" aria-label={`${count} pending`}>
                                    {count}
                                </span>
                            )}
                        </button>
                    ))}
                </div>
            </div>
            <div className="mt-4" role="tabpanel" id={`desk-panel-${tab}`} aria-labelledby={`desk-tab-${tab}`}>
                {tab === 'queue' && <JobQueue token={token} />}
                {tab === 'approvals' && <ApprovalsInbox token={token} />}
                {tab === 'new' && <CreateJobForm token={token} />}
                {tab === 'clients' && <ClientsPanel token={token} />}
            </div>
        </div>
    );
}
