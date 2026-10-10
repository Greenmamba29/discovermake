'use client';

import { useQuery } from '@tanstack/react-query';
import { EmptyState, Notice } from '@/components/ui/state';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';
import { sourcingApi } from '../api';
import { ApprovalCard } from './approval-card';

/** Pending approvals across every job (GET /api/admin/sourcing/approvals?status=PENDING). */
export function ApprovalsInbox({ token }: { token: string }) {
    const list = useQuery({ queryKey: ['sourcing-approvals', token, 'PENDING'], queryFn: () => sourcingApi.adminApprovals(token, 'PENDING'), refetchInterval: 15_000 });
    if (list.isLoading)
        return (
            <div className="space-y-2">
                <Skeleton className="h-28" />
                <Skeleton className="h-28" />
            </div>
        );
    if (list.error) return <Notice tone="error">{errorMessage(list.error)}</Notice>;
    if (!list.data || list.data.length === 0) return <EmptyState title="Inbox zero">No decisions are waiting at the approval boundary.</EmptyState>;
    const sorted = [...list.data].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return (
        <ul className="space-y-3" data-testid="approvals-inbox">
            {sorted.map((a) => (
                <li key={a.id}>
                    <ApprovalCard token={token} approval={a} showJobLink />
                </li>
            ))}
        </ul>
    );
}
