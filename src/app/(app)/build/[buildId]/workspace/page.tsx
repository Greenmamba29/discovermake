import type { Metadata } from 'next'
import { ReadOnlyBuildBanner } from '@/components/account/read-only-banner'
import { BuildWorkspace } from '@/components/workspace/build-workspace'
import { canViewerEditBuild } from '@/server/auth/page'

export const metadata: Metadata = { title: 'Build workspace', robots: { index: false } }

type Props = { params: Promise<{ buildId: string }> }

/**
 * /build/:buildId/workspace: the Build Workspace (EPIC-300, workflow 10) for graph builds
 * (Make AI, remix, clone). Anyone with the unguessable id can view it (ADR-0008); only the
 * owner (signed-in user, or the guest device that made it) can change it (ADR-0009). The
 * write APIs enforce that with 403; viewers who are not the owner see a read-only notice.
 */
export default async function BuildWorkspacePage({ params }: Props) {
    const { buildId } = await params
    const canEdit = /^bld_[A-Za-z0-9_-]{1,60}$/.test(buildId) ? await canViewerEditBuild(buildId) : null
    return (
        <>
            {canEdit === false && <ReadOnlyBuildBanner buildId={buildId} />}
            <BuildWorkspace buildId={buildId} />
        </>
    )
}
