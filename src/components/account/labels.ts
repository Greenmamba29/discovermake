import type { InterestSlug, MyBuildsTab, OnboardingIntent, UserRole } from '@/contracts/account';
import type { BuildOrigin } from '@/contracts';

export const ROLE_LABELS: Record<UserRole, string> = { buyer: 'Buyer', creator: 'Creator', shop: 'Shop', ops: 'Ops', admin: 'Admin' };

export const INTENT_LABELS: Record<OnboardingIntent, string> = { make: 'Make something', discover: 'Discover things', sell: 'Sell my designs', shop: 'Run a shop' };

export function interestLabel(slug: InterestSlug): string {
    const s = slug.replace(/-/g, ' ');
    return s.charAt(0).toUpperCase() + s.slice(1);
}

export const TAB_LABELS: Record<MyBuildsTab, string> = { all: 'All', created: 'Created', remixed: 'Remixed', ordered: 'Ordered', following: 'Following' };

export const ORIGIN_LABELS: Record<BuildOrigin, string> = { upload: 'Uploaded', make_ai: 'Made with Make AI', remix: 'Remix', clone: 'Made from a build', reconstruct: 'Rebuilt from a photo', kids: 'Kids project' };
