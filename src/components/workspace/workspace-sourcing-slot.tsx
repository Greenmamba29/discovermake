'use client';

/**
 * Integration slot for the sourcing panel (ADR-0005). The sourcing bridge owns
 * `src/components/sourcing/build-sourcing-panel.tsx`; the lead wires it in here.
 * Renders nothing until then: no placeholder posing as a feature.
 */
export type WorkspaceSourcingSlotProps = {
    buildId: string;
    /** The design version the workspace is showing. */
    designVersion: number;
};

export function WorkspaceSourcingSlot(props: WorkspaceSourcingSlotProps): null {
    void props;
    return null;
}
