import { cronJob } from '../lib/cron.mjs';

const job = cronJob('/api/admin/outbox/publish', '15 6 * * *'); // UTC, as in vercel.json
export default job.handler;
export const config = job.config;
