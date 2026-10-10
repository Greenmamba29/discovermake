import { CheckCircle2, Circle } from 'lucide-react';
import type { GoLiveChecklist as Checklist } from '@/contracts/live';
import { cn } from '@/lib/utils';

/** Whatnot "Get started · Go live · Step 3 of 4" checklist. */
export function GoLiveChecklist({ checklist, className }: { checklist: Checklist; className?: string }) {
    const done = checklist.items.filter((i) => i.done).length;
    return (
        <section aria-labelledby="checklist-heading" className={cn('rounded-2xl bg-graphite-900 p-4 ring-1 ring-graphite-700', className)} data-testid="go-live-checklist" data-ready={checklist.ready}>
            <p className="eyebrow">
                Get started · Step {Math.min(done + 1, checklist.items.length)} of {checklist.items.length}
            </p>
            <h2 id="checklist-heading" className="mt-1 font-display text-lg font-bold">
                Go-live checklist
            </h2>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-graphite-700" aria-hidden>
                <div className="h-full rounded-full bg-signal" style={{ width: `${Math.round((done / checklist.items.length) * 100)}%` }} />
            </div>
            <ul className="mt-3 space-y-2.5">
                {checklist.items.map((item) => (
                    <li key={item.key} className="flex gap-2.5 text-sm" data-testid={`checklist-${item.key}`} data-done={item.done}>
                        {item.done ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-signal" aria-label="Done" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-fg-subtle" aria-label="To do" />}
                        <span>
                            <span className={cn('font-medium', item.done ? 'text-fg' : 'text-fg-muted')}>{item.label}</span>
                            {item.hint && <span className="block text-xs text-fg-subtle">{item.hint}</span>}
                        </span>
                    </li>
                ))}
            </ul>
            <p className="mt-3 text-xs text-fg-muted">{checklist.ready ? 'Ready to go live.' : 'Finish the required steps (channel and a featured product) to go live.'}</p>
        </section>
    );
}
