/**
 * Lead time + ship date (workflow 02 "Lead time"), business days in the shop's timezone.
 *
 *   lead days = shop queue + production days(machine hours) + service days + QA/pack day
 *   ship date = order day (today before the cutoff, else next business day) + lead business days
 *
 * Business days skip weekends and US federal holidays most shops close for (observed dates).
 */

/** Orders placed after this local hour start counting from the next business day. */
export const ORDER_CUTOFF_HOUR = 12;
/** Productive machine hours per shop day used to turn machine time into production days. */
export const PRODUCTIVE_HOURS_PER_DAY = 6;
/** QA + packing (one business day). */
export const QA_PACK_DAYS = 1;

const pad = (n: number) => String(n).padStart(2, '0');
export const isoDate = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

function utcDate(iso: string): Date {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
}

function toIso(d: Date): string {
    return isoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

function nthWeekday(year: number, month: number, weekday: number, n: number): string {
    const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    const day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
    return isoDate(year, month, day);
}

function lastWeekday(year: number, month: number, weekday: number): string {
    const last = new Date(Date.UTC(year, month, 0));
    const day = last.getUTCDate() - ((last.getUTCDay() - weekday + 7) % 7);
    return isoDate(year, month, day);
}

function observed(year: number, month: number, day: number): string {
    const d = new Date(Date.UTC(year, month - 1, day));
    const dow = d.getUTCDay();
    if (dow === 6) d.setUTCDate(d.getUTCDate() - 1);
    if (dow === 0) d.setUTCDate(d.getUTCDate() + 1);
    return toIso(d);
}

const holidayCache = new Map<number, Set<string>>();

/** Observed US federal holidays shops typically close for (no Columbus / Veterans Day). */
export function usHolidays(year: number): Set<string> {
    const cached = holidayCache.get(year);
    if (cached) return cached;
    const set = new Set<string>([
        observed(year, 1, 1),
        nthWeekday(year, 1, 1, 3), // MLK Day
        nthWeekday(year, 2, 1, 3), // Presidents' Day
        lastWeekday(year, 5, 1), // Memorial Day
        observed(year, 6, 19), // Juneteenth
        observed(year, 7, 4),
        nthWeekday(year, 9, 1, 1), // Labor Day
        nthWeekday(year, 11, 4, 4), // Thanksgiving
        observed(year, 12, 25),
        observed(year + 1, 1, 1), // New Year observed on Dec 31
    ]);
    holidayCache.set(year, set);
    return set;
}

export function isBusinessDay(iso: string): boolean {
    const d = utcDate(iso);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) return false;
    return !usHolidays(d.getUTCFullYear()).has(iso);
}

export function nextBusinessDay(iso: string): string {
    const d = utcDate(iso);
    do d.setUTCDate(d.getUTCDate() + 1);
    while (!isBusinessDay(toIso(d)));
    return toIso(d);
}

/** Add `days` business days to an ISO date. */
export function addBusinessDays(iso: string, days: number): string {
    let cur = iso;
    for (let i = 0; i < days; i++) cur = nextBusinessDay(cur);
    return cur;
}

/** Local calendar date + hour in an IANA timezone. */
export function localDateTime(now: Date, timeZone: string): { date: string; hour: number } {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    return { date: isoDate(get('year'), get('month'), get('day')), hour: get('hour') };
}

/** First business day production can start for an order placed at `now`. */
export function orderStartDate(now: Date, timeZone: string): string {
    const { date, hour } = localDateTime(now, timeZone);
    if (!isBusinessDay(date) || hour >= ORDER_CUTOFF_HOUR) return nextBusinessDay(date);
    return date;
}

export type LeadTimeInput = {
    now: Date;
    timeZone: string;
    queueDays: number;
    machineHours: number;
    /** Sum of `services.lead_time_days_added` for the selected services + finish. */
    serviceDays: number;
};

export type LeadTime = { leadTimeDays: number; shipDate: string; startDate: string };

export function computeLeadTime(input: LeadTimeInput): LeadTime {
    const productionDays = Math.max(1, Math.ceil(input.machineHours / PRODUCTIVE_HOURS_PER_DAY));
    const leadTimeDays = Math.max(1, Math.round(input.queueDays) + productionDays + Math.max(0, input.serviceDays) + QA_PACK_DAYS);
    const startDate = orderStartDate(input.now, input.timeZone);
    return { leadTimeDays, startDate, shipDate: addBusinessDays(startDate, leadTimeDays) };
}
