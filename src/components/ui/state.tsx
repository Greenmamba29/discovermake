import type { ReactNode } from 'react';
import { AlertTriangle, CircleAlert, Info, PackageOpen } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Notice({
    tone = 'info',
    title,
    children,
    action,
    className,
    testId,
}: {
    tone?: 'info' | 'warning' | 'error' | 'success';
    title?: string;
    children?: ReactNode;
    action?: ReactNode;
    className?: string;
    testId?: string;
}) {
    const styles = {
        info: 'bg-graphite-800 ring-graphite-600 text-fg',
        warning: 'bg-amber/10 ring-amber/30 text-fg',
        error: 'bg-ember/10 ring-ember/40 text-fg',
        success: 'bg-signal/10 ring-signal/30 text-fg',
    }[tone];
    const Icon = tone === 'error' ? CircleAlert : tone === 'warning' ? AlertTriangle : Info;
    const iconColor = { info: 'text-fg-muted', warning: 'text-amber', error: 'text-ember', success: 'text-signal' }[tone];
    return (
        <div className={cn('flex gap-3 rounded-xl p-4 ring-1 ring-inset', styles, className)} role={tone === 'error' ? 'alert' : 'status'} data-testid={testId}>
            <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', iconColor)} aria-hidden />
            <div className="min-w-0 flex-1 text-sm">
                {title && <p className="font-semibold">{title}</p>}
                {children && <div className={cn('text-fg-muted', title && 'mt-0.5')}>{children}</div>}
                {action && <div className="mt-3">{action}</div>}
            </div>
        </div>
    );
}

export function EmptyState({ title, children, action, icon }: { title: string; children?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
    return (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-graphite-600 px-6 py-12 text-center">
            <div className="mb-3 text-fg-subtle">{icon ?? <PackageOpen className="h-8 w-8" aria-hidden />}</div>
            <p className="font-display text-lg font-semibold">{title}</p>
            {children && <div className="mt-1 max-w-sm text-sm text-fg-muted">{children}</div>}
            {action && <div className="mt-5">{action}</div>}
        </div>
    );
}

export function ErrorState({ title = 'Something went wrong', message, action }: { title?: string; message: string; action?: ReactNode }) {
    return (
        <div className="mx-auto flex w-full max-w-lg flex-col items-center px-4 py-16 text-center" role="alert">
            <div className="mb-4 rounded-2xl bg-ember/10 p-3 text-ember ring-1 ring-ember/30">
                <CircleAlert className="h-7 w-7" aria-hidden />
            </div>
            <h1 className="font-display text-2xl font-bold">{title}</h1>
            <p className="mt-2 text-fg-muted">{message}</p>
            {action && <div className="mt-6 flex flex-wrap justify-center gap-3">{action}</div>}
        </div>
    );
}
