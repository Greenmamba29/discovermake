import Link from 'next/link';
import { GitFork } from 'lucide-react';
import type { RemixNode } from '@/contracts/media';

/** Lineage below a build: public remixes link to their pages, private ones stay anonymous. */
export function RemixTreeView({ node, rootLabel = true }: { node: RemixNode; rootLabel?: boolean }) {
    return (
        <ul className="space-y-1.5 text-sm" data-testid="remix-tree">
            <TreeNode node={node} depth={0} rootLabel={rootLabel} />
        </ul>
    );
}

function TreeNode({ node, depth, rootLabel }: { node: RemixNode; depth: number; rootLabel: boolean }) {
    const label = node.public ? (
        <Link href={`/b/${node.buildId}`} className="font-semibold text-fg underline-offset-2 hover:underline">
            {node.title}
        </Link>
    ) : (
        <span className="text-fg-muted">{node.title}</span>
    );
    return (
        <li data-testid="remix-node" data-build-id={node.buildId} data-depth={depth}>
            {(depth > 0 || rootLabel) && (
                <span className="inline-flex flex-wrap items-center gap-1.5">
                    {depth > 0 && <GitFork className="h-3.5 w-3.5 text-fg-subtle" aria-hidden />}
                    {label}
                    {node.creatorName && <span className="text-xs text-fg-subtle">by {node.creatorName}</span>}
                    <span className="text-xs text-fg-subtle">
                        · {node.origin === 'clone' ? 'copy' : node.origin} · {node.orders} order{node.orders === 1 ? '' : 's'}
                    </span>
                </span>
            )}
            {node.children.length > 0 && (
                <ul className="mt-1.5 space-y-1.5 border-l border-graphite-700 pl-4">
                    {node.children.map((c) => (
                        <TreeNode key={c.buildId} node={c} depth={depth + 1} rootLabel />
                    ))}
                </ul>
            )}
        </li>
    );
}
