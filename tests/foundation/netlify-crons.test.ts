import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Netlify scheduled functions', () => {
    it('cover every vercel.json cron with the same route and schedule', () => {
        const crons = (JSON.parse(readFileSync('vercel.json', 'utf8')) as { crons: { path: string; schedule: string }[] }).crons;
        const jobs = readdirSync('netlify/functions')
            .filter((f) => f.startsWith('cron-'))
            .map((f) => {
                const src = readFileSync(`netlify/functions/${f}`, 'utf8');
                // Netlify parses `config` statically, so the schedule must be a string literal.
                return { path: /triggerCronRoute\('([^']+)'\)/.exec(src)?.[1], schedule: /export const config: Config = \{ schedule: '([^']+)' \};/.exec(src)?.[1] };
            });
        expect(jobs.sort((a, b) => String(a.path).localeCompare(String(b.path)))).toEqual([...crons].sort((a, b) => a.path.localeCompare(b.path)));
    });
});
