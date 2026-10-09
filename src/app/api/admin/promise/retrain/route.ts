/**
 * POST|GET /api/admin/promise/retrain -> RetrainPromiseResponse
 * Weekly Delivery Promise retraining: recompute the per-leg P90 slip models from
 * `promise_observations`, report the holdout hit rate, and recheck active promises (at risk).
 * Auth: Bearer ADMIN_TOKEN or CRON_SECRET (GET is what Vercel Cron calls; see vercel.json).
 */
import type { RetrainPromiseResponse } from '@/contracts/promise';
import { requireAdminOrCron } from '@/server/auth/admin';
import { json, route } from '@/server/http';
import { retrainPromiseModels } from '@/server/promise/retrain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handler = route(async (request) => {
    await requireAdminOrCron(request);
    return json<RetrainPromiseResponse>(await retrainPromiseModels());
});

export const POST = handler;
export const GET = handler;
