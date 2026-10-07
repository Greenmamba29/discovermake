import type { TimelineEntry } from '@/contracts';
import { dateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

const ACTOR: Record<string, string> = { shop: 'Shop', system: 'DiscoverMake', buyer: 'You', admin: 'DiscoverMake ops', carrier: 'Carrier', payment_provider: 'Payment' };

/** Live updates from real domain events, newest first. */
export function Timeline({ entries, limit }: { entries: TimelineEntry[]; limit?: number }) {
    const list = [...entries].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit ?? entries.length);
    if (list.length === 0) return <p className="text-sm text-fg-subtle">Updates appear here as your order moves.</p>;
    return (
        <ol className="relative space-y-4 border-l border-graphite-700 pl-5" data-testid="order-timeline">
            {list.map((e, i) => (
                <li key={e.eventId} className="relative">
                    <span className={cn('absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-graphite-900', i === 0 ? 'bg-signal' : 'bg-graphite-500')} aria-hidden />
                    <p className="text-sm text-fg">{e.label}</p>
                    <p className="font-mono text-[11px] text-fg-subtle">
                        <time dateTime={e.at}>{dateTime(e.at)}</time> · {ACTOR[e.actorKind] ?? e.actorKind}
                    </p>
                </li>
            ))}
        </ol>
    );
}
