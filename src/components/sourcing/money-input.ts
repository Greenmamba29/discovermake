/**
 * Form helpers: people type dollars, the wire carries integer cents.
 * Returns `null` for an empty field and `NaN` for something that is not a non-negative amount.
 */
export function dollarsToCents(input: string): number | null {
    const s = input.trim().replace(/[$,\s]/g, '');
    if (!s) return null;
    if (!/^\d+(\.\d{0,2})?$/.test(s)) return Number.NaN;
    const [whole, frac = ''] = s.split('.');
    return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

/** Comma/newline separated list → trimmed, non-empty entries. */
export function splitList(input: string, sep: RegExp = /[,\n]/): string[] {
    return input
        .split(sep)
        .map((s) => s.trim())
        .filter(Boolean);
}

/** Local calendar date (YYYY-MM-DD) for `min` on date inputs. */
export function todayIso(now: Date = new Date()): string {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}
