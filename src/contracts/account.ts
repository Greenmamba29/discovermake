/**
 * R2 accounts (ADR-0009): self-hosted sign-in (email code, passkeys, optional Google /
 * Apple OIDC), deferred signup, guest device ownership, onboarding preferences and
 * My Builds.
 *
 * Principals:
 * - **Guest device.** Every browser gets an opaque `dm_device` cookie (HttpOnly, 1 year).
 *   Builds created on that device are owned by its hash until someone signs in on it.
 * - **User.** A signed-in person (`dm_session` cookie, HttpOnly, 30 days, sliding).
 *   Signing in claims the device's guest builds, and orders whose buyer email equals the
 *   user's verified email.
 *
 * Roles: every user is a `buyer`. `creator` is self-service (onboarding "Sell");
 * `shop` comes from a shop membership; `ops` / `admin` come from `ADMIN_EMAILS`.
 */
import { z } from 'zod';
import { BuildDisplayId, BuildId, IsoDateTime, OrderId, PartId, QuoteId, UserId } from './common';
import { BuildOrigin, BuildStatus, BuildTrustState, OrderStatus } from './enums';

export const SESSION_COOKIE = 'dm_session';
export const DEVICE_COOKIE = 'dm_device';

export const USER_ROLES = ['buyer', 'creator', 'shop', 'ops', 'admin'] as const;
export const UserRole = z.enum(USER_ROLES);
export type UserRole = z.infer<typeof UserRole>;

/** Onboarding step 1 ("What brings you here?"). */
export const ONBOARDING_INTENTS = ['make', 'discover', 'sell', 'shop'] as const;
export const OnboardingIntent = z.enum(ONBOARDING_INTENTS);
export type OnboardingIntent = z.infer<typeof OnboardingIntent>;

/** Onboarding step 2 ("Pick 5"): interest slugs. Seeds Discover (Stage 4). */
export const INTEREST_SLUGS = [
    'brackets-mounts',
    'enclosures',
    'signage',
    'furniture',
    'automotive',
    'robotics',
    'drones',
    'home-repair',
    'lighting',
    'audio',
    'cosplay-props',
    'garden',
    'bikes',
    'camping',
    'desk-setup',
    'jewelry',
] as const;
export const InterestSlug = z.enum(INTEREST_SLUGS);
export type InterestSlug = z.infer<typeof InterestSlug>;

export const AUTH_PROVIDERS = ['email', 'passkey', 'google', 'apple'] as const;
export const AuthProvider = z.enum(AUTH_PROVIDERS);
export type AuthProvider = z.infer<typeof AuthProvider>;

export const Viewer = z.object({
    id: UserId,
    email: z.string().email(),
    emailVerified: z.boolean(),
    displayName: z.string().nullable(),
    /** Public creator handle (`@handle`), set when the user becomes a creator. */
    handle: z.string().nullable(),
    roles: z.array(UserRole).min(1),
    onboardedAt: IsoDateTime.nullable(),
    createdAt: IsoDateTime,
});
export type Viewer = z.infer<typeof Viewer>;

export const Preferences = z.object({
    intent: OnboardingIntent.nullable(),
    interests: z.array(InterestSlug).max(16),
});
export type Preferences = z.infer<typeof Preferences>;

/** GET /api/me — works signed out (viewer null; guest preferences come from the device). */
export const MeResponse = z.object({
    viewer: Viewer.nullable(),
    preferences: Preferences,
    /** Providers this deployment can use (google/apple only when configured). */
    providers: z.array(AuthProvider),
    passkeys: z.array(
        z.object({
            id: z.string(),
            name: z.string(),
            createdAt: IsoDateTime,
            lastUsedAt: IsoDateTime.nullable(),
        }),
    ),
});
export type MeResponse = z.infer<typeof MeResponse>;

/** PUT /api/me/preferences (guest or signed in). Marks onboarding complete when `complete`. */
export const UpdatePreferencesRequest = z.object({
    intent: OnboardingIntent.optional(),
    interests: z.array(InterestSlug).max(16).optional(),
    complete: z.boolean().optional(),
});
export type UpdatePreferencesRequest = z.infer<typeof UpdatePreferencesRequest>;

/** PATCH /api/me */
export const UpdateProfileRequest = z.object({
    displayName: z.string().trim().min(1).max(80).optional(),
    handle: z
        .string()
        .trim()
        .regex(/^[a-z0-9_]{3,24}$/, 'Use 3–24 lowercase letters, numbers or underscores')
        .optional(),
    becomeCreator: z.boolean().optional(),
});
export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequest>;

// ---------------------------------------------------------------------------
// Sign-in
// ---------------------------------------------------------------------------

/** POST /api/auth/email/start: sends a 6-digit code (dev: also returned as `devCode`). */
export const EmailStartRequest = z.object({ email: z.string().trim().toLowerCase().email().max(254) });
export const EmailStartResponse = z.object({
    challengeId: z.string(),
    expiresAt: IsoDateTime,
    /** Only outside production when no email provider is configured. */
    devCode: z.string().optional(),
});
export type EmailStartResponse = z.infer<typeof EmailStartResponse>;

/** POST /api/auth/email/verify → sets dm_session. */
export const EmailVerifyRequest = z.object({
    challengeId: z.string().min(1).max(64),
    code: z.string().regex(/^\d{6}$/),
});

export const SignInResponse = z.object({
    viewer: Viewer,
    /** True when this sign-in created the account. */
    created: z.boolean(),
    claimed: z.object({ builds: z.number().int().nonnegative(), orders: z.number().int().nonnegative() }),
});
export type SignInResponse = z.infer<typeof SignInResponse>;

/**
 * Passkeys (WebAuthn via SimpleWebAuthn):
 *   POST /api/auth/passkey/register/options   (signed in)  → PublicKeyCredentialCreationOptionsJSON
 *   POST /api/auth/passkey/register/verify    (signed in)  { response, name? } → { ok, passkeyId }
 *   POST /api/auth/passkey/login/options      (anyone)     → PublicKeyCredentialRequestOptionsJSON & { challengeId }
 *   POST /api/auth/passkey/login/verify       (anyone)     { challengeId, response } → SignInResponse + dm_session
 *   DELETE /api/me/passkeys/:id               (signed in)
 *
 * OIDC (only when configured):
 *   GET /api/auth/oauth/:provider?next=/path → 302 to the provider
 *   GET /api/auth/oauth/:provider/callback   → 302 to `next` with dm_session set
 *
 * POST /api/auth/signout → clears dm_session (the device cookie stays).
 */
export const PasskeyRegisterVerifyRequest = z.object({
    response: z.record(z.unknown()),
    name: z.string().trim().max(60).optional(),
});
export const PasskeyLoginVerifyRequest = z.object({
    challengeId: z.string().min(1).max(64),
    response: z.record(z.unknown()),
});

// ---------------------------------------------------------------------------
// My Builds (500-1, 500-4)
// ---------------------------------------------------------------------------

export const MY_BUILDS_TABS = ['all', 'created', 'remixed', 'ordered', 'following'] as const;
export const MyBuildsTab = z.enum(MY_BUILDS_TABS);
export type MyBuildsTab = z.infer<typeof MyBuildsTab>;

export const MyBuildRow = z.object({
    buildId: BuildId,
    displayId: BuildDisplayId,
    name: z.string(),
    origin: BuildOrigin,
    status: BuildStatus,
    trustState: BuildTrustState.nullable(),
    currentVersion: z.number().int().positive(),
    /** Part used by Reorder / Repair (latest analyzed part), when there is one. */
    partId: PartId.nullable(),
    /** Small preview (SVG path data from the part preview, or null). */
    previewSvg: z.string().nullable(),
    /** viewBox size for `previewSvg` (the path is drawn in 0..width x 0..height mm). Additive R2 field. */
    previewSize: z.object({ widthMm: z.number().nonnegative(), heightMm: z.number().nonnegative() }).nullable(),
    derivedFromBuildId: BuildId.nullable(),
    lastOrder: z
        .object({
            orderId: OrderId,
            orderNumber: z.string(),
            status: OrderStatus,
            quoteId: QuoteId,
            placedAt: IsoDateTime,
        })
        .nullable(),
    /** What the row's actions can do right now. */
    actions: z.object({ reorder: z.boolean(), remix: z.boolean(), repair: z.boolean() }),
    updatedAt: IsoDateTime,
});
export type MyBuildRow = z.infer<typeof MyBuildRow>;

/** GET /api/me/builds?tab=all&limit=50 — signed-in user's builds, else this device's guest builds. */
export const MyBuildsResponse = z.object({
    tab: MyBuildsTab,
    rows: z.array(MyBuildRow),
    counts: z.record(MyBuildsTab, z.number().int().nonnegative()),
    /** True when rows come from the guest device (prompt to sign in to keep them). */
    guest: z.boolean(),
});
export type MyBuildsResponse = z.infer<typeof MyBuildsResponse>;

/**
 * POST /api/me/builds/:buildId/reorder → { quoteId } — a fresh quote with the last
 * order's selections (same part, material, thickness, finish, quantity); 409 if the
 * part no longer quotes.
 */
export const ReorderResponse = z.object({ quoteId: QuoteId, checkoutUrl: z.string().url() });
export type ReorderResponse = z.infer<typeof ReorderResponse>;

/** POST /api/builds/:buildId/follow and DELETE (signed in). */
export const FollowResponse = z.object({ following: z.boolean() });
