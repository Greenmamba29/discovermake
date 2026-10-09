import type { Metadata } from 'next'
import { BuildWorkspace } from '@/components/workspace/build-workspace'

export const metadata: Metadata = { title: 'Build workspace', robots: { index: false } }

type Props = { params: Promise<{ buildId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

/**
 * /build/:buildId/workspace: the Build Workspace (EPIC-300, workflow 10) for graph builds
 * (Make AI, remix, clone). Public like the other R1 build pages: builds are addressed by
 * unguessable ids (ADR-0008). TODO(R2 accounts): owner-only edits.
 */
export default async function BuildWorkspacePage({ params, searchParams }: Props) {
    const { buildId } = await params
    const { section } = await searchParams
    return <BuildWorkspace buildId={buildId} initialSection={typeof section === 'string' ? section : null} />
}
