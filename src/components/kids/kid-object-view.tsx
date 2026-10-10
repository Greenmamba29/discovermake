'use client';

/**
 * The 3D Object View for a kid design when the workshop returned a GLB (the workspace viewer,
 * reused as is); otherwise, or without WebGL, the drawing.
 */
import dynamic from 'next/dynamic';
import { Component, useEffect, useState, type ReactNode } from 'react';
import type { KidDesignOptions } from '@/contracts/kids';
import type { KidTemplateId } from '@/contracts/text-to-cad';
import { webglAvailable } from '@/components/workspace/object-view/static-preview';
import { KidPreview } from './kid-preview';

const ObjectViewport3D = dynamic(() => import('@/components/workspace/object-view/object-viewport-3d'), {
    ssr: false,
    loading: () => <div className="h-full w-full animate-pulse rounded-3xl bg-paper" aria-hidden />,
});

class Boundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
    state = { failed: false };
    static getDerivedStateFromError() {
        return { failed: true };
    }
    render() {
        return this.state.failed ? this.props.fallback : this.props.children;
    }
}

export function KidObjectView({ template, options, glbUrl, title }: { template: KidTemplateId; options: KidDesignOptions; glbUrl: string | null; title: string }) {
    const [webgl, setWebgl] = useState<boolean | null>(null);
    useEffect(() => setWebgl(webglAvailable()), []);
    const drawing = <KidPreview template={template} options={options} title={`Drawing of your ${title}`} />;
    if (!glbUrl || !webgl) return drawing;
    return (
        <div className="relative h-[280px] overflow-hidden rounded-3xl bg-paper-raised ring-1 ring-paper-line" data-testid="kid-3d-view">
            <Boundary fallback={drawing}>
                <ObjectViewport3D
                    url={glbUrl}
                    expectedBboxMm={null}
                    unit="mm"
                    showBox={false}
                    wireframe={false}
                    measuring={false}
                    points={[]}
                    resetSignal={0}
                    label={`3D view of your ${title}. Drag to turn it.`}
                    onPick={() => {}}
                    onLoaded={() => {}}
                />
            </Boundary>
        </div>
    );
}
