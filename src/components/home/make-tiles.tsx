import Link from 'next/link';
import { ArrowRight, Box, Cog, Layers, Printer, Scissors, Trees, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';
import { makeAiPromptHref } from './intake';

type Tile = {
    key: string;
    title: string;
    body: string;
    icon: typeof Box;
    /** Instant quote today, or planned by Make AI and sourced through partners. */
    route: { kind: 'upload' } | { kind: 'make-ai'; prompt: string; label: string } | { kind: 'link'; href: string; label: string };
};

/**
 * Make-anything tile grid (workflow 10: Uber "Suggestions" tiles → Laser cut · Bend · CNC ·
 * 3D print · Wood · Reconstruct). Every tile leads somewhere real: laser and bend go to the
 * instant-quote upload, Reconstruct to the photo capture (/reconstruct, R6); the others open
 * Make AI with a process-specific starter prompt, because the partner network sources them.
 */
export const MAKE_TILES: readonly Tile[] = [
    { key: 'laser', title: 'Laser cut', body: 'Metal, acrylic and wood from a DXF. Instant binding quote.', icon: Scissors, route: { kind: 'upload' } },
    { key: 'bend', title: 'Bend', body: 'Press-brake bends from the BEND layer in your DXF. Instant quote.', icon: Layers, route: { kind: 'upload' } },
    {
        key: 'cnc',
        title: 'CNC',
        body: 'Machined aluminum and steel through partner shops.',
        icon: Cog,
        route: {
            kind: 'make-ai',
            label: 'Plan with Make AI',
            prompt: 'A CNC-machined 6061 aluminum motor mount block, 40 × 40 × 20 mm, with four M4 tapped holes on a 30 mm square and a 22 mm bore through the middle. 2 pieces.',
        },
    },
    {
        key: 'print',
        title: '3D print',
        body: 'Printed plastic parts through partner print farms.',
        icon: Printer,
        route: {
            kind: 'make-ai',
            label: 'Plan with Make AI',
            prompt: 'A 3D-printed PETG cable clip that snaps onto a desk edge up to 25 mm thick and holds three USB-C cables. 10 pieces.',
        },
    },
    {
        key: 'wood',
        title: 'Wood',
        body: 'Birch plywood and walnut, laser cut and assembled.',
        icon: Trees,
        route: {
            kind: 'make-ai',
            label: 'Plan with Make AI',
            prompt: 'A laser-cut 6 mm Baltic birch plywood desk organizer with three pen slots, a phone stand and finger-joint corners, about 250 × 120 × 100 mm. 1 piece.',
        },
    },
    {
        key: 'reconstruct',
        title: 'Reconstruct',
        body: 'Photograph the broken part, confirm its sizes with a caliper, get a binding price for a new one.',
        icon: Wrench,
        route: { kind: 'link', href: '/reconstruct', label: 'Rebuild from a photo' },
    },
];

export function MakeTiles({ makeAiEnabled }: { makeAiEnabled: boolean }) {
    return (
        <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="make-tiles">
            {MAKE_TILES.map((t) => {
                const ai = t.route.kind === 'make-ai';
                const enabled = !ai || makeAiEnabled;
                const href = t.route.kind === 'make-ai' ? makeAiPromptHref(t.route.prompt) : t.route.kind === 'link' ? t.route.href : '/make';
                const cta = t.route.kind === 'make-ai' ? (makeAiEnabled ? t.route.label : 'Make AI preview') : t.route.kind === 'link' ? t.route.label : 'Upload a DXF';
                const inner = (
                    <>
                        <span className="flex items-start justify-between gap-2">
                            <span className={cn('flex h-10 w-10 items-center justify-center rounded-xl', enabled ? 'bg-ink text-paper' : 'bg-paper-line text-ink-muted')}>
                                <t.icon className="h-5 w-5" aria-hidden />
                            </span>
                            {enabled && <ArrowRight className="mt-1 h-4 w-4 text-ink-subtle transition-transform group-hover:translate-x-0.5" aria-hidden />}
                        </span>
                        <span className="mt-3 block font-display text-lg font-bold text-ink">{t.title}</span>
                        <span className="mt-1 block text-sm leading-snug text-ink-muted">{t.body}</span>
                        <span className="mt-3 block text-xs font-semibold text-ink">{cta}</span>
                    </>
                );
                return (
                    <li key={t.key} data-testid={`make-tile-${t.key}`}>
                        {enabled ? (
                            <Link href={href} className="group flex h-full flex-col rounded-2xl bg-paper-raised p-4 ring-1 ring-paper-line transition-shadow hover:shadow-lg sm:p-5">
                                {inner}
                            </Link>
                        ) : (
                            <div className="flex h-full flex-col rounded-2xl border border-dashed border-paper-line bg-paper/60 p-4 sm:p-5" aria-disabled="true">
                                {inner}
                            </div>
                        )}
                    </li>
                );
            })}
        </ul>
    );
}
