import Link from 'next/link';
import { forwardRef, type ButtonHTMLAttributes, type ComponentProps } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'caution' | 'ink' | 'paper';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
    // the ONE signal color drives every primary action
    primary: 'bg-signal text-signal-ink hover:bg-signal-strong disabled:bg-graphite-600 disabled:text-fg-subtle',
    secondary: 'bg-graphite-750 text-fg ring-1 ring-inset ring-graphite-600 hover:bg-graphite-700 disabled:text-fg-subtle',
    ghost: 'text-fg-muted hover:bg-graphite-800 hover:text-fg disabled:text-fg-subtle',
    caution: 'bg-ember/15 text-ember ring-1 ring-inset ring-ember/40 hover:bg-ember/25',
    ink: 'bg-ink text-paper hover:bg-black disabled:bg-ink-subtle',
    paper: 'bg-paper-raised text-ink ring-1 ring-inset ring-paper-line hover:bg-white',
};

const SIZES: Record<Size, string> = {
    sm: 'h-9 px-3 text-sm gap-1.5',
    md: 'h-11 px-4 text-[15px] gap-2',
    lg: 'h-14 px-6 text-base gap-2.5',
};

export function buttonClass(variant: Variant = 'primary', size: Size = 'md', className?: string) {
    return cn(
        'inline-flex select-none items-center justify-center rounded-xl font-semibold transition-colors disabled:cursor-not-allowed',
        VARIANTS[variant],
        SIZES[size],
        className,
    );
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: Variant;
    size?: Size;
    loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    { variant = 'primary', size = 'md', loading = false, className, children, disabled, type = 'button', ...rest },
    ref,
) {
    return (
        <button ref={ref} type={type} className={buttonClass(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {children}
        </button>
    );
});

export function ButtonLink({
    variant = 'primary',
    size = 'md',
    className,
    ...rest
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
    return <Link className={buttonClass(variant, size, className)} {...rest} />;
}
