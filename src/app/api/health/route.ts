/**
 * GET /api/health: liveness + readiness for uptime checks and load balancers.
 * 200 when the database answers within 2 s, else 503. Never exposes config values,
 * only whether each dependency is configured.
 */
import { sql } from 'drizzle-orm'
import { getDb } from '@/server/db'
import { env } from '@/server/env'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
    const started = Date.now()
    let database: 'ok' | 'down' = 'down'
    try {
        await Promise.race([
            getDb().execute(sql`select 1`),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
        ])
        database = 'ok'
    } catch {
        database = 'down'
    }
    const e = env()
    const body = {
        status: database === 'ok' ? 'ok' : 'degraded',
        checks: { database },
        configured: {
            payments: e.PAYMENT_PROVIDER === 'dev' ? 'dev' : Boolean(e.STRIPE_SECRET_KEY),
            storage: e.STORAGE_DRIVER,
            email: Boolean(e.RESEND_API_KEY),
            makeAi: e.MAKE_AI_ENABLED && Boolean(e.GOOGLE_GENERATIVE_AI_API_KEY),
            cadWorker: Boolean(e.CAD_WORKER_URL),
        },
        version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local',
        latencyMs: Date.now() - started,
    }
    return Response.json(body, { status: database === 'ok' ? 200 : 503, headers: { 'cache-control': 'no-store' } })
}
