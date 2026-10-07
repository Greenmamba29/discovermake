/**
 * Typed, lazily-validated server environment.
 *
 * Read config through `env()` at call time (never at module load) so `next build`
 * works without secrets. Every variable here is documented in `.env.local.example`
 * and in docs/architecture/r1-implementation.md.
 */
import { z } from 'zod';

const optionalString = z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()));

/** Boolean feature flag: true only for "true" (trimmed, case-insensitive); any other value, or unset, is false and never fails env parsing. */
const flag = z
    .string()
    .optional()
    .transform((v) => v?.trim().toLowerCase() === 'true');

const EnvSchema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_URL: z.string().url().default('http://localhost:3000'),
    DATABASE_URL: z.string().default('postgresql://dm:dm@localhost:5432/discovermake'),

    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_DIR: z.string().default('.data/storage'),
    /** HMAC key for local-driver signed URLs. Falls back to a dev-only constant outside production. */
    STORAGE_SIGNING_SECRET: optionalString,
    S3_ENDPOINT: optionalString,
    S3_REGION: z.string().default('auto'),
    S3_BUCKET: optionalString,
    S3_ACCESS_KEY_ID: optionalString,
    S3_SECRET_ACCESS_KEY: optionalString,
    S3_FORCE_PATH_STYLE: z
        .enum(['true', 'false'])
        .default('true')
        .transform((v) => v === 'true'),

    PAYMENT_PROVIDER: z.enum(['stripe', 'dev']).default('stripe'),
    STRIPE_SECRET_KEY: optionalString,
    STRIPE_WEBHOOK_SECRET: optionalString,
    /** Signing secret of the Connect webhook endpoint (/api/webhooks/stripe-connect, "events on connected accounts"). */
    STRIPE_CONNECT_WEBHOOK_SECRET: optionalString,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: optionalString,

    CARRIER: z.enum(['easypost', 'manual']).default('easypost'),
    EASYPOST_API_KEY: optionalString,
    EASYPOST_WEBHOOK_SECRET: optionalString,

    ORDER_LINK_SECRET: optionalString,
    PASSPORT_SIGNING_SECRET: optionalString,
    JOB_PACKET_SIGNING_SECRET: optionalString,
    ADMIN_TOKEN: optionalString,
    /** Bearer secret for scheduled jobs (Vercel Cron sends `Authorization: Bearer $CRON_SECRET`). Cron routes only. */
    CRON_SECRET: optionalString,

    RESEND_API_KEY: optionalString,
    EMAIL_FROM: z.string().default('DiscoverMake <orders@discovermake.com>'),
    OPS_EMAIL: optionalString,

    /** Dev/e2e only: deterministic Shop Console token created by the seed. */
    SEED_SHOP_TOKEN: optionalString,

    /** Make AI intake (/api/make-ai/intake). Off unless "true" (case-insensitive). */
    MAKE_AI_ENABLED: flag,
    /** Shows the /make/ai page. Inlined into client bundles at build time. */
    NEXT_PUBLIC_MAKE_AI_ENABLED: flag,
    /** Gemini model id for Make AI (any id the @ai-sdk/google provider accepts). */
    MAKE_AI_MODEL: optionalString.transform((v) => v ?? 'gemini-3.5-flash'),
    /** Google AI Studio key for Make AI. Make AI answers 503 when unset. */
    GOOGLE_GENERATIVE_AI_API_KEY: optionalString,

    /** CAD worker (services/cad-worker) base URL, e.g. https://cad.internal.example. CAD generation answers 503 when unset. */
    CAD_WORKER_URL: optionalString,
    /** Bearer token the CAD worker expects (its CAD_WORKER_TOKEN). */
    CAD_WORKER_TOKEN: optionalString,
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

/** Parsed environment. Cached; call `resetEnvCache()` in tests after mutating process.env. */
export function env(): Env {
    if (!cached) cached = EnvSchema.parse(process.env);
    return cached;
}

export function resetEnvCache(): void {
    cached = null;
}

export function isProduction(): boolean {
    return env().NODE_ENV === 'production';
}

/**
 * Guard for test doubles (dev payment provider, manual carrier, ...).
 * Throws when NODE_ENV=production so a misconfigured deploy can never fake state.
 */
export function assertNotProduction(feature: string): void {
    if (process.env.NODE_ENV === 'production') {
        throw new Error(`${feature} is a development/test double and refuses to run when NODE_ENV=production`);
    }
}

/**
 * Read a required secret. In production a missing secret throws; outside
 * production a clearly-labelled dev fallback is returned so local dev works
 * without ceremony.
 */
export function requireSecret(name: 'ORDER_LINK_SECRET' | 'PASSPORT_SIGNING_SECRET' | 'JOB_PACKET_SIGNING_SECRET' | 'STORAGE_SIGNING_SECRET'): string {
    const value = env()[name];
    if (value) return value;
    if (isProduction()) throw new Error(`Missing required secret ${name}`);
    return `dev-insecure-${name.toLowerCase()}`;
}
