/**
 * Stripe Connect onboarding for partner shops (ported from the pre-pivot
 * `src/app/api/payouts/connect/route.ts`, rebuilt on Postgres + the shared Stripe client).
 *
 * - `createShopOnboardingLink`: creates the shop's Express account once (US, `transfers`
 *   capability, metadata.shop_id), stores it in `shops.stripe_account_id` and emits
 *   `shop.connect_account_created` in the same transaction; then returns a fresh hosted
 *   `account_onboarding` link. Used by the Shop Console and by ops (admin route).
 * - `getShopPayoutStatus`: live (uncached) account flags from Stripe.
 * - `processConnectWebhook`: verifies STRIPE_CONNECT_WEBHOOK_SECRET over the raw body,
 *   dedupes in `webhook_events` (provider `stripe_connect`) and emits
 *   `shop.connect_account_updated` for `account.updated`.
 *
 * `shops.stripe_payouts_enabled` mirrors Stripe's `payouts_enabled` (set by the webhook
 * and by every live status read). Only when it is true does the ledger pay the shop by
 * Connect transfer (src/server/ledger `executePendingPayouts`); a shop that started but
 * did not finish onboarding keeps being paid manually. Without STRIPE_SECRET_KEY the shop
 * and admin entry points answer 503 and ops keep settling payouts manually.
 */
import { and, eq, isNull } from 'drizzle-orm';
import Stripe from 'stripe';
import { z } from 'zod';
import type { Actor } from '../../contracts/common';
import type { AdminShopConnectLinkResponse, ShopPayoutStatusResponse } from '../../contracts/connect';
import { getDb, withTx } from '../db';
import { creatorAccounts, shops, webhookEvents } from '../db/schema';
import { env } from '../env';
import { emitEvent } from '../events/outbox';
import { ApiError } from '../http';
import { getStripeClient, isStripeConfigured } from '../payments/stripe';

/** `webhook_events.provider` for Connect events (separate from platform `stripe` events). */
export const CONNECT_WEBHOOK_PROVIDER = 'stripe_connect';

/** Thrown when the Connect webhook signature (or its header) is missing or invalid; the route answers 400. */
export class ConnectWebhookSignatureError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ConnectWebhookSignatureError';
    }
}

function stripeNotConfigured(): ApiError {
    return new ApiError('INTERNAL', 'Stripe is not configured', 503);
}

/** 503 unless STRIPE_SECRET_KEY is set. */
export function assertStripeConfigured(): void {
    if (!isStripeConfigured()) throw stripeNotConfigured();
}

/** Turn a Stripe API failure into a 502 with a plain message (never leaks keys or raw responses). */
export function stripeFailure(err: unknown, what: string): never {
    if (err instanceof Stripe.errors.StripeError) {
        console.error(`[connect] Stripe ${what} failed`, err.type, err.code ?? '', err.requestId ?? '');
        throw new ApiError('PAYMENT_ERROR', `Stripe could not ${what}. Try again in a moment.`, 502);
    }
    throw err;
}

export function appUrl(path: string): string {
    return new URL(path, env().APP_URL).toString();
}

/** Stripe rejects non-public business URLs (localhost, plain http), so only send a real https origin. */
export function publicBusinessUrl(): string | undefined {
    try {
        const u = new URL(env().APP_URL);
        if (u.protocol !== 'https:' || u.hostname === 'localhost' || u.hostname.endsWith('.local') || /^[\d.]+$/.test(u.hostname)) return undefined;
        return u.origin;
    } catch {
        return undefined;
    }
}

export function isStripeHostedUrl(raw: string): boolean {
    try {
        const u = new URL(raw);
        return u.protocol === 'https:' && (u.hostname === 'stripe.com' || u.hostname.endsWith('.stripe.com'));
    } catch {
        return false;
    }
}

export const SHOP_PAYOUTS_RETURN_PATH = '/shop/payouts?status=return';
export const SHOP_PAYOUTS_REFRESH_PATH = '/shop/payouts?status=refresh';

type ShopRow = typeof shops.$inferSelect;

async function loadShop(shopId: string): Promise<ShopRow> {
    const [shop] = await getDb().select().from(shops).where(eq(shops.id, shopId)).limit(1);
    if (!shop) throw new ApiError('NOT_FOUND', 'Shop not found');
    return shop;
}

/**
 * Return the shop's Connect account id, creating the Express account on first use.
 * Safe under concurrent calls: the Stripe create is idempotent per shop and the row is
 * only written while `stripe_account_id` is still null (the first writer wins).
 */
async function ensureConnectAccount(shop: ShopRow, actor: Actor): Promise<{ accountId: string; created: boolean }> {
    if (shop.stripeAccountId) return { accountId: shop.stripeAccountId, created: false };
    const stripe = getStripeClient();
    const url = publicBusinessUrl();
    let account: Stripe.Account;
    try {
        account = await stripe.accounts.create(
            {
                type: 'express',
                country: 'US',
                email: shop.contactEmail,
                capabilities: { transfers: { requested: true } },
                business_profile: {
                    name: shop.legalName ?? shop.name,
                    ...(url ? { url } : {}),
                    product_description: 'Contract sheet-metal manufacturing for DiscoverMake orders',
                },
                metadata: { shop_id: shop.id, dm_app: new URL(env().APP_URL).host },
            },
            { idempotencyKey: `connect-account:${shop.id}` },
        );
    } catch (err) {
        stripeFailure(err, 'create the payout account');
    }

    return withTx(async (tx) => {
        const [updated] = await tx
            .update(shops)
            .set({ stripeAccountId: account.id, stripePayoutsEnabled: account.payouts_enabled === true, updatedAt: new Date() })
            .where(and(eq(shops.id, shop.id), isNull(shops.stripeAccountId)))
            .returning({ id: shops.id });
        if (!updated) {
            // Another request stored an account first; use that one.
            const [current] = await tx.select({ stripeAccountId: shops.stripeAccountId }).from(shops).where(eq(shops.id, shop.id));
            if (!current?.stripeAccountId) throw new ApiError('NOT_FOUND', 'Shop not found');
            return { accountId: current.stripeAccountId, created: false };
        }
        await emitEvent(tx, {
            type: 'shop.connect_account_created',
            payload: { shopId: shop.id, accountId: account.id },
            actor,
            correlationId: shop.id,
        });
        return { accountId: account.id, created: true };
    });
}

/**
 * Create (once) the shop's Express account and a fresh hosted onboarding link.
 * Links are single-use and short-lived, so a new one is minted on every call.
 */
export async function createShopOnboardingLink(shopId: string, actor: Actor): Promise<AdminShopConnectLinkResponse> {
    assertStripeConfigured();
    const shop = await loadShop(shopId);
    const { accountId, created } = await ensureConnectAccount(shop, actor);
    let link: Stripe.AccountLink;
    try {
        link = await getStripeClient().accountLinks.create({
            account: accountId,
            type: 'account_onboarding',
            return_url: appUrl(SHOP_PAYOUTS_RETURN_PATH),
            refresh_url: appUrl(SHOP_PAYOUTS_REFRESH_PATH),
        });
    } catch (err) {
        stripeFailure(err, 'start payout setup');
    }
    // The browser is sent straight to this URL: only ever hand out a Stripe-hosted https link.
    if (!isStripeHostedUrl(link.url)) {
        console.error('[connect] Stripe returned an unexpected onboarding URL host');
        throw new ApiError('PAYMENT_ERROR', 'Stripe could not start payout setup. Try again in a moment.', 502);
    }
    return { url: link.url, accountId, created };
}

/** Live Connect status for a shop (retrieved from Stripe on every call, never cached). */
export async function getShopPayoutStatus(shopId: string): Promise<ShopPayoutStatusResponse> {
    assertStripeConfigured();
    const shop = await loadShop(shopId);
    if (!shop.stripeAccountId) return { connected: false };
    let account: Stripe.Account;
    try {
        account = await getStripeClient().accounts.retrieve(shop.stripeAccountId);
    } catch (err) {
        stripeFailure(err, 'load the payout account');
    }
    const payoutsEnabled = account.payouts_enabled === true;
    if (payoutsEnabled !== shop.stripePayoutsEnabled) {
        // Keep the ledger's routing flag in step with Stripe even if a webhook was missed.
        await getDb()
            .update(shops)
            .set({ stripePayoutsEnabled: payoutsEnabled, updatedAt: new Date() })
            .where(and(eq(shops.id, shop.id), eq(shops.stripeAccountId, shop.stripeAccountId)));
    }
    return {
        connected: true,
        chargesEnabled: account.charges_enabled === true,
        payoutsEnabled,
        detailsSubmitted: account.details_submitted === true,
    };
}

/** The fields of a Connect `account.updated` object we rely on (validated, everything else ignored). */
const ConnectAccountObject = z.object({
    id: z.string().regex(/^acct_[A-Za-z0-9]+$/),
    object: z.literal('account'),
    charges_enabled: z.boolean().nullish(),
    payouts_enabled: z.boolean().nullish(),
    details_submitted: z.boolean().nullish(),
    metadata: z.record(z.string()).nullish(),
});

export type ConnectWebhookOutcome =
    | { duplicate: true; type: string }
    | { duplicate: false; type: string; shopId: string | null; creatorUserId?: string | null };

/** Verify, dedupe and apply a Connect webhook. Throws ConnectWebhookSignatureError on a bad signature. */
export async function processConnectWebhook(rawBody: string, headers: Headers): Promise<ConnectWebhookOutcome> {
    const secret = env().STRIPE_CONNECT_WEBHOOK_SECRET;
    if (!secret) throw new ApiError('INTERNAL', 'Stripe Connect webhook is not configured', 503);
    const signature = headers.get('stripe-signature');
    if (!signature) throw new ConnectWebhookSignatureError('Missing stripe-signature header');
    let event: Stripe.Event;
    try {
        // Static verifier: no API key needed, constant-time HMAC compare, 5 min tolerance.
        event = await Stripe.webhooks.constructEventAsync(rawBody, signature, secret);
    } catch (err) {
        throw new ConnectWebhookSignatureError(err instanceof Error ? err.message : 'Invalid signature');
    }

    const db = getDb();
    await db
        .insert(webhookEvents)
        .values({ provider: CONNECT_WEBHOOK_PROVIDER, eventId: event.id, eventType: event.type, payload: JSON.parse(rawBody) as unknown })
        .onConflictDoNothing({ target: [webhookEvents.provider, webhookEvents.eventId] });

    const where = and(eq(webhookEvents.provider, CONNECT_WEBHOOK_PROVIDER), eq(webhookEvents.eventId, event.id));
    try {
        return await withTx(async (tx) => {
            // Row lock serialises concurrent duplicate deliveries; a processed event is a no-op.
            const [row] = await tx.select().from(webhookEvents).where(where).for('update');
            if (row?.processedAt) return { duplicate: true as const, type: event.type };

            let shopId: string | null = null;
            let creatorUserId: string | null = null;
            if (event.type === 'account.updated') {
                const account = ConnectAccountObject.parse(event.data.object);
                const appHost = new URL(env().APP_URL).host;
                const foreign = !!account.metadata?.dm_app && account.metadata.dm_app !== appHost;
                const [shop] = foreign ? [] : await tx.select({ id: shops.id }).from(shops).where(eq(shops.stripeAccountId, account.id)).limit(1);
                if (shop) {
                    shopId = shop.id;
                    await tx
                        .update(shops)
                        .set({ stripePayoutsEnabled: account.payouts_enabled === true, updatedAt: new Date() })
                        .where(and(eq(shops.id, shop.id), eq(shops.stripeAccountId, account.id)));
                    await emitEvent(tx, {
                        type: 'shop.connect_account_updated',
                        payload: {
                            shopId: shop.id,
                            accountId: account.id,
                            payoutsEnabled: account.payouts_enabled === true,
                            chargesEnabled: account.charges_enabled === true,
                            detailsSubmitted: account.details_submitted === true,
                        },
                        actor: { kind: 'payment_provider', id: 'stripe' },
                        correlationId: shop.id,
                    });
                } else if (!foreign) {
                    // R5: creators onboard with the same Express flow (src/server/media/connect.ts).
                    const [creator] = await tx
                        .update(creatorAccounts)
                        .set({ stripePayoutsEnabled: account.payouts_enabled === true, updatedAt: new Date() })
                        .where(eq(creatorAccounts.stripeAccountId, account.id))
                        .returning({ userId: creatorAccounts.userId });
                    creatorUserId = creator?.userId ?? null;
                }
            }
            await tx.update(webhookEvents).set({ processedAt: new Date(), error: null }).where(where);
            return { duplicate: false as const, type: event.type, shopId, creatorUserId };
        });
    } catch (err) {
        await db
            .update(webhookEvents)
            .set({ error: String(err instanceof Error ? err.message : err).slice(0, 1000) })
            .where(where);
        throw err;
    }
}
