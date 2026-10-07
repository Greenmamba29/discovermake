'use client';

/**
 * Sourcing in the Build Workspace (ADR-0005): once a design version is approved, the buyer
 * can ask DiscoverMake's manufacturing partners (worked by Accio Work in the background)
 * for offers. Before approval there is nothing exact to send, so the panel stays hidden.
 */
import { BuildSourcingPanel } from '@/components/sourcing/build-sourcing-panel';

export type WorkspaceSourcingSlotProps = {
    buildId: string;
    /** The design version the workspace is showing. */
    designVersion: number;
    /** True when the latest version is approved and the workspace shows it. */
    approved: boolean;
    /** The CAD flat-pattern part, when one exists (sources against its exact geometry). */
    partId?: string | null;
};

export function WorkspaceSourcingSlot({ buildId, approved, partId }: WorkspaceSourcingSlotProps) {
    if (!approved) return null;
    return <BuildSourcingPanel buildId={buildId} partId={partId ?? undefined} />;
}
