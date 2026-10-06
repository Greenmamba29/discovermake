import Link from 'next/link';
import { cn } from '@/lib/utils';

/** DiscoverMake mark: a flat sheet with one cut corner and a pierce hole (the first thing every part gets). */
export function LogoMark({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 32 32" className={cn('h-7 w-7', className)} aria-hidden>
            <path d="M4 4h18l6 6v18H4z" fill="currentColor" />
            <path d="M22 4v6h6" fill="none" stroke="#5fe08a" strokeWidth="2.2" strokeLinejoin="round" />
            <circle cx="11" cy="21" r="3" fill="#5fe08a" />
        </svg>
    );
}

export function Logo({ surface = 'graphite', className }: { surface?: 'graphite' | 'paper'; className?: string }) {
    return (
        <Link href="/" className={cn('inline-flex items-center gap-2 rounded-md', className)} aria-label="DiscoverMake home">
            <LogoMark className={surface === 'paper' ? 'text-ink' : 'text-fg'} />
            <span className={cn('font-display font-wide text-[17px] font-bold tracking-tight', surface === 'paper' ? 'text-ink' : 'text-fg')}>DiscoverMake</span>
        </Link>
    );
}
