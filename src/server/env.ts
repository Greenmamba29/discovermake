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

    // ---- R2 accounts (ADR-0009) ----
    /** HMAC key for email sign-in codes. Dev fallback outside production; required in production. */
    AUTH_SECRET: optionalString,
    /** Comma-separated emails that get the `ops` + `admin` roles at sign-in. */
    ADMIN_EMAILS: optionalString,
    /** Google sign-in (OIDC). Enabled only when both are set. */
    GOOGLE_CLIENT_ID: optionalString,
    GOOGLE_CLIENT_SECRET: optionalString,
    /** Sign in with Apple. Enabled only when all four are set. APPLE_PRIVATE_KEY is the .p8 PEM (\n escapes allowed). */
    APPLE_CLIENT_ID: optionalString,
    APPLE_TEAM_ID: optionalString,
    APPLE_KEY_ID: optionalString,
    APPLE_PRIVATE_KEY: optionalString,

    /** CAD worker (services/cad-worker) base URL, e.g. https://cad.internal.example. CAD generation answers 503 when unset. */
    CAD_WORKER_URL: optionalString,
    /** Bearer token the CAD worker expects (its CAD_WORKER_TOKEN). */
    CAD_WORKER_TOKEN: optionalString,
    /** R6 optional GPU reconstruction worker (SAM 2 -> OpenCV -> COLMAP / Open3D). Unset = no "Auto-detect". */
    RECONSTRUCT_WORKER_URL: optionalString,
    /** Bearer token the reconstruction worker expects. */
    RECONSTRUCT_WORKER_TOKEN: optionalString,

    /** Rate-limit store: "postgres" (shared table, default in production) or "memory" (per instance, default elsewhere). */
    RATE_LIMIT_STORE: optionalString.pipe(z.enum(['postgres', 'memory']).optional()),
    /** Which proxy header carries the client IP: vercel | real-ip | xff | none (default vercel on Vercel, else xff). */
    TRUSTED_PROXY: optionalString.pipe(z.enum(['vercel', 'real-ip', 'xff', 'none']).optional()),
    /** R4 Live: HMAC key for server-signed Live Build Protocol events. Required in production. */
    LIVE_EVENT_SIGNING_SECRET: optionalString,
    /** R4 Live: LiveKit server URL (wss://<project>.livekit.cloud). All three LIVEKIT_* must be set to use LiveKit rooms. */
    LIVEKIT_URL: optionalString,
    LIVEKIT_API_KEY: optionalString,
    LIVEKIT_API_SECRET: optionalString,
    // ---- R3 Prime (docs/architecture/r3-prime.md). Unset = the documented default. ----
    /** Share of a supplier-route order total charged at checkout, 0..1 (default 0.5). */
    SUPPLIER_DEPOSIT_PCT: optionalString,
    /** DiscoverMake margin on the supplier landed cost, 0..1 (default 0.18). */
    SUPPLIER_MARGIN_PCT: optionalString,
    /** Risk reserve % by risk tier LOW,MEDIUM,HIGH,VERY_HIGH (default "0.03,0.06,0.10,0.15"). */
    SUPPLIER_RISK_RESERVE_PCTS: optionalString,
    /** Supplier deposit paid with the PO, as a share of the landed cost, 0..1 (default 0.3). */
    SUPPLIER_PO_DEPOSIT_PCT: optionalString,
    /** Missed-promise credit as a share of the order subtotal, 0..1 (default 0.10). */
    PROMISE_CREDIT_PCT: optionalString,
    /** Missed-promise credit cap in cents (default 25000 = $250). */
    PROMISE_CREDIT_CAP_CENTS: optionalString,
    /** Mouser Search API key (catalog distributor provider). Unset = the distributor provider is disabled and never called. */
    MOUSER_API_KEY: optionalString,
    // ---- R3 Prime experience (docs/architecture/r3-prime-experience.md) ----
    /** Prime prices in cents (owner input). */
    PRIME_MONTHLY_PRICE_CENTS: z.coerce.number().int().positive().default(999),
    PRIME_ANNUAL_PRICE_CENTS: z.coerce.number().int().positive().default(9900),
    PRIME_TRIAL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
    /** Free standard shipping for members when the order (or cart) subtotal reaches this. */
    PRIME_FREE_SHIPPING_THRESHOLD_CENTS: z.coerce.number().int().nonnegative().default(7500),
    /** Pooled material pricing: % off MATERIAL line items for members (never below cost). */
    PRIME_MATERIAL_DISCOUNT_PCT: z.coerce.number().min(0).max(50).default(10),
    /** Stripe Billing recurring Price ids for the two plans (subscription mode Checkout). */
    STRIPE_PRIME_MONTHLY_PRICE_ID: optionalString,
    STRIPE_PRIME_ANNUAL_PRICE_ID: optionalString,
    /** MapLibre style URL for order tracking; unset = offline SVG map (no network). */
    NEXT_PUBLIC_MAP_STYLE_URL: optionalString,
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
export function requireSecret(name: 'ORDER_LINK_SECRET' | 'PASSPORT_SIGNING_SECRET' | 'JOB_PACKET_SIGNING_SECRET' | 'STORAGE_SIGNING_SECRET' | 'AUTH_SECRET' | 'LIVE_EVENT_SIGNING_SECRET'): string {
    const value = env()[name];
    if (value) return value;
    if (isProduction()) throw new Error(`Missing required secret ${name}`);
    return `dev-insecure-${name.toLowerCase()}`;
}
