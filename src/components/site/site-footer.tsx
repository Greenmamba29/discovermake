import Link from 'next/link';
import { cn } from '@/lib/utils';
import { LogoMark } from './logo';

export function SiteFooter({ surface = 'graphite' }: { surface?: 'graphite' | 'paper' }) {
    const paper = surface === 'paper';
    const muted = paper ? 'text-ink-muted' : 'text-fg-muted';
    const link = cn('rounded transition-colors', paper ? 'text-ink-muted hover:text-ink' : 'text-fg-muted hover:text-fg');
    return (
        <footer className={cn('mt-auto border-t', paper ? 'border-paper-line bg-paper' : 'border-graphite-700 bg-graphite-950')}>
            <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 sm:grid-cols-[1.4fr_1fr_1fr] sm:px-6">
                <div>
                    <div className="flex items-center gap-2">
                        <LogoMark className={paper ? 'text-ink' : 'text-fg'} />
                        <span className={cn('font-display font-wide font-bold', paper ? 'text-ink' : 'text-fg')}>DiscoverMake</span>
                    </div>
                    <p className={cn('mt-3 font-display text-lg font-semibold', paper ? 'text-ink' : 'text-fg')}>Discover. Make. Build.</p>
                    <p className={cn('mt-2 max-w-xs text-sm', muted)}>Real parts from vetted partner shops. Every order is inspected before it ships.</p>
                </div>
                <nav aria-label="Make">
                    <p className={cn('eyebrow mb-3')}>Make</p>
                    <ul className="space-y-2 text-sm">
                        <li><Link className={link} href="/make">Upload a DXF</Link></li>
                        <li><Link className={link} href="/#materials">Materials</Link></li>
                        <li><Link className={link} href="/#how-it-works">How it works</Link></li>
                    </ul>
                </nav>
                <nav aria-label="Account">
                    <p className={cn('eyebrow mb-3')}>Orders</p>
                    <ul className="space-y-2 text-sm">
                        <li><Link className={link} href="/orders">Track an order</Link></li>
                        <li><Link className={link} href="/shop">Partner shop login</Link></li>
                    </ul>
                </nav>
            </div>
            <div className={cn('border-t', paper ? 'border-paper-line' : 'border-graphite-800')}>
                <p className={cn('mx-auto w-full max-w-6xl px-4 py-4 text-xs sm:px-6', muted)}>© {new Date().getFullYear()} DiscoverMake. Prices are quoted in USD and ship within the US.</p>
            </div>
        </footer>
    );
}
