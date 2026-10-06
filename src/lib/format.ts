/** Display formatting shared by every surface. Amounts are integer cents from the server. */

export function money(cents: number, currency = 'usd', opts: { compact?: boolean } = {}): string {
    const value = cents / 100;
    const whole = opts.compact && Number.isInteger(value);
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency.toUpperCase(),
        minimumFractionDigits: whole ? 0 : 2,
        maximumFractionDigits: whole ? 0 : 2,
    }).format(value);
}

/** Parse a calendar date (YYYY-MM-DD) as a local date, never shifting by timezone. */
function parseDate(value: string): Date {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const [y, m, d] = value.split('-').map(Number);
        return new Date(y, m - 1, d);
    }
    return new Date(value);
}

/** "Thu, Oct 9" */
export function shortDate(value: string | null | undefined): string {
    if (!value) return '—';
    return parseDate(value).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** "Thu" */
export function weekday(value: string): string {
    return parseDate(value).toLocaleDateString('en-US', { weekday: 'short' });
}

/** "Oct 9, 2026" */
export function longDate(value: string | null | undefined): string {
    if (!value) return '—';
    return parseDate(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** "Oct 9, 2:14 PM" */
export function dateTime(value: string | null | undefined): string {
    if (!value) return '—';
    return new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** "2:14 PM" */
export function timeOnly(value: string): string {
    return new Date(value).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function relativeTime(value: string, now: number = Date.now()): string {
    const diff = Math.round((new Date(value).getTime() - now) / 1000);
    const abs = Math.abs(diff);
    const rtf = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' });
    if (abs < 60) return rtf.format(diff, 'second');
    if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
    return rtf.format(Math.round(diff / 86400), 'day');
}

export function mm(value: number, digits = 1): string {
    return `${value.toFixed(digits)} mm`;
}

export function inches(valueMm: number, digits = 2): string {
    return `${(valueMm / 25.4).toFixed(digits)} in`;
}

/** "120.0 × 80.0 mm" */
export function dims(widthMm: number, heightMm: number): string {
    return `${widthMm.toFixed(1)} × ${heightMm.toFixed(1)} mm`;
}

export function grams(g: number): string {
    return g >= 1000 ? `${(g / 1000).toFixed(2)} kg` : `${Math.round(g)} g`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
    return `${n} ${n === 1 ? one : many}`;
}

export function humanize(code: string): string {
    const s = code.replace(/_/g, ' ').toLowerCase();
    return s.charAt(0).toUpperCase() + s.slice(1);
}
