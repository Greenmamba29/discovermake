import { cronJob } from '../lib/cron.mjs';

const job = cronJob('/api/admin/promise/retrain', '30 6 * * 1'); // UTC, as in vercel.json
export default job.handler;
export const config = job.config;
