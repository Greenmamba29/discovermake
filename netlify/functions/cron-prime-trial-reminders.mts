import { cronJob } from '../lib/cron.mjs';

const job = cronJob('/api/admin/prime/trial-reminders', '45 6 * * *'); // UTC, as in vercel.json
export default job.handler;
export const config = job.config;
