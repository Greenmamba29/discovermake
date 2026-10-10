import { cronJob } from '../lib/cron.mjs';

const job = cronJob('/api/admin/live/drops/close', '30 6 * * *'); // UTC, as in vercel.json
export default job.handler;
export const config = job.config;
