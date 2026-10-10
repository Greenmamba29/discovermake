/** "My things": each request with simple progress art from the grown-up's real order. */
import { CheckCircle2, Clock, Hammer, Home, Truck } from 'lucide-react';
import type { KidStage, KidThingView } from '@/contracts/kids';
import { cn } from '@/lib/utils';
import { KidPreview } from './kid-preview';

const TRACK: { stage: KidStage; label: string; icon: typeof Clock }[] = [
    { stage: 'waiting', label: 'Waiting', icon: Clock },
    { stage: 'making', label: 'Being made', icon: Hammer },
    { stage: 'on_its_way', label: 'On its way', icon: Truck },
    { stage: 'here', label: 'Here!', icon: Home },
];

function KidTrack({ stage }: { stage: KidStage }) {
    const at = TRACK.findIndex((t) => t.stage === stage);
    return (
        <ol className="grid grid-cols-4 gap-1" aria-label="How far it got">
            {TRACK.map((t, i) => {
                const done = i <= at;
                const Icon = i < at ? CheckCircle2 : t.icon;
                return (
                    <li key={t.stage} className="flex flex-col items-center gap-1 text-center" aria-current={i === at ? 'step' : undefined}>
                        <span className={cn('flex h-11 w-11 items-center justify-center rounded-full', done ? 'bg-ink text-paper' : 'bg-paper-line text-ink-muted')}>
                            <Icon className="h-6 w-6" aria-hidden />
                        </span>
                        <span className={cn('text-xs font-bold', done ? 'text-ink' : 'text-ink-muted')}>{t.label}</span>
                    </li>
                );
            })}
        </ol>
    );
}

export function KidThings({ items }: { items: KidThingView[] }) {
    if (!items.length) {
        return (
            <p className="rounded-3xl bg-paper-raised p-6 text-xl font-bold text-ink ring-2 ring-inset ring-paper-line" data-testid="kid-things-empty">
                Nothing yet. Make something and ask a grown-up!
            </p>
        );
    }
    return (
        <ul className="flex flex-col gap-4" data-testid="kid-things">
            {items.map((t) => (
                <li key={t.id} className="flex flex-col gap-4 rounded-3xl bg-paper-raised p-4 ring-2 ring-inset ring-paper-line" data-testid="kid-thing" data-stage={t.stage}>
                    <div className="flex items-center gap-4">
                        <div className="w-28 shrink-0">
                            <KidPreview template={t.template} options={t.options} title={`Drawing of your ${t.templateTitle.toLowerCase()}`} />
                        </div>
                        <div className="min-w-0">
                            <h2 className="text-xl font-extrabold text-ink">{t.templateTitle}</h2>
                            <p className="text-lg font-bold text-ink" data-testid="kid-thing-stage">
                                {t.stageText}
                            </p>
                        </div>
                    </div>
                    {t.stage === 'not_this_time' || t.stage === 'stopped' ? (
                        t.note && (
                            <p className="rounded-2xl bg-paper p-3 text-base text-ink" data-testid="kid-thing-note">
                                Your grown-up says: “{t.note}”
                            </p>
                        )
                    ) : (
                        <KidTrack stage={t.stage} />
                    )}
                </li>
            ))}
        </ul>
    );
}
