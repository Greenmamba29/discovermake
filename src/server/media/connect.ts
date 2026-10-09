/**
 * Creator Stripe Connect onboarding: the shop Express flow (src/server/shops/connect.ts),
 * keyed by user (`creator_accounts`). The same `account.updated` webhook keeps
 * `stripe_payouts_enabled` in step; creator payouts go by Connect transfer only when it is true.
 * Without STRIPE_SECRET_KEY the onboarding answers 503 and payouts are settled manually by ops.
 */
import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';
import type Stripe from 'stripe';
import type { ViewerContext } from '../auth/viewer';
import { getDb, withTx } from '../db';
import { creatorAccounts } from '../db/schema';
import { env } from '../env';
import { emitEvent } from '../events/outbox';
import { ApiError } from '../http';
import { getStripeClient } from '../payments/stripe';
import { appUrl, assertStripeConfigured, isStripeHostedUrl, publicBusinessUrl, stripeFailure } from '../shops/connect';

export const CREATOR_PAYOUTS_RETURN_PATH = '/studio/payouts?status=return';
export const CREATOR_PAYOUTS_REFRESH_PATH = '/studio/payouts?status=refresh';

async function ensureCreatorAccount(viewer: ViewerContext): Promise<string> {
    const db = getDb();
    const userId = viewer.user.id;
    await db.insert(creatorAccounts).values({ userId }).onConflictDoNothing();
    const [row] = await db.select().from(creatorAccounts).where(eq(creatorAccounts.userId, userId));
    if (row?.stripeAccountId) return row.stripeAccountId;
    const url = publicBusinessUrl();
    let account: Stripe.Account;
    try {
        account = await getStripeClient().accounts.create(
            {
                type: 'express',
                country: 'US',
                email: viewer.user.email,
                capabilities: { transfers: { requested: true } },
                business_profile: { ...(url ? { url } : {}), product_description: 'Creator royalties and live drop revenue from DiscoverMake' },
                metadata: { creator_user_id: userId, dm_app: new URL(env().APP_URL).host },
            },
            { idempotencyKey: `connect-account:creator:${userId}` },
        );
    } catch (err) {
        stripeFailure(err, 'create the payout account');
    }
    return withTx(async (tx) => {
        const [updated] = await tx
            .update(creatorAccounts)
            .set({ stripeAccountId: account.id, stripePayoutsEnabled: account.payouts_enabled === true, updatedAt: new Date() })
            .where(and(eq(creatorAccounts.userId, userId), isNull(creatorAccounts.stripeAccountId)))
            .returning({ id: creatorAccounts.stripeAccountId });
        if (!updated) {
            const [current] = await tx.select().from(creatorAccounts).where(eq(creatorAccounts.userId, userId));
            if (!current?.stripeAccountId) throw new ApiError('INTERNAL', 'Payout account could not be saved');
            return current.stripeAccountId;
        }
        await emitEvent(tx, { type: 'creator.connect_account_created', payload: { userId, accountId: account.id }, actor: { kind: 'buyer', id: userId }, correlationId: `creator:${userId}` });
        return account.id;
    });
}

/** A fresh hosted onboarding link for the signed-in creator (single use, short-lived). */
export async function createCreatorOnboardingLink(viewer: ViewerContext): Promise<{ url: string }> {
    assertStripeConfigured();
    const accountId = await ensureCreatorAccount(viewer);
    let link: Stripe.AccountLink;
    try {
        link = await getStripeClient().accountLinks.create({ account: accountId, type: 'account_onboarding', return_url: appUrl(CREATOR_PAYOUTS_RETURN_PATH), refresh_url: appUrl(CREATOR_PAYOUTS_REFRESH_PATH) });
    } catch (err) {
        stripeFailure(err, 'start payout setup');
    }
    if (!isStripeHostedUrl(link.url)) throw new ApiError('PAYMENT_ERROR', 'Stripe could not start payout setup. Try again in a moment.', 502);
    return { url: link.url };
}
