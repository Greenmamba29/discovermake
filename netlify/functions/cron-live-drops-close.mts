import type { Config } from '@netlify/functions';
import { triggerCronRoute } from '../lib/cron.mjs';

export default async function run(): Promise<Response> {
    return triggerCronRoute('/api/admin/live/drops/close');
}

// Literal on purpose: Netlify reads `config` statically at deploy time. UTC, as in vercel.json.
export const config: Config = { schedule: '30 6 * * *' };
