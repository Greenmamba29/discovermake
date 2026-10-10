import type { Config } from '@netlify/functions';
import { triggerCronRoute } from '../lib/cron.mjs';

export default async function run(): Promise<Response> {
    return triggerCronRoute('/api/admin/creator-payouts/run');
}

// Literal on purpose: Netlify reads `config` statically at deploy time. UTC, as in vercel.json.
export const config: Config = { schedule: '45 6 * * *' };
