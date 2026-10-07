import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowLeft, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function DeskHeader({ title, back, onSignOut, actions }: { title: ReactNode; back: { href: string; label: string }; onSignOut: () => void; actions?: ReactNode }) {
    return (
        <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
                <Link href={back.href} className="inline-flex items-center gap-1 rounded text-sm text-fg-muted hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-signal">
                    <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> {back.label}
                </Link>
                <h1 className="mt-1 font-display font-wide text-3xl font-extrabold">{title}</h1>
            </div>
            <div className="flex flex-wrap gap-2">
                {actions}
                <Button variant="ghost" size="sm" onClick={onSignOut}>
                    <LogOut className="h-4 w-4" aria-hidden /> Sign out
                </Button>
            </div>
        </div>
    );
}
