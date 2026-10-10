/**
 * Kids & Family (docs/architecture/kids-family.md). Route handlers import from here.
 */
import type { KidAvatar, KidHomeView } from '@/contracts/kids';
import { KID_TEMPLATES } from '@/contracts/text-to-cad';
import { requireViewer, type ViewerContext } from '../auth/viewer';
import { allowedTemplatesOf } from './designs';
import { assertNotKidMode } from './session';
import type { KidSession } from './session';

export { assertCanDiscover, assertCanWatchLive, kidLiveShows, kidWatch, listKidSafeBuilds, setKidSafe } from './browse';
export { clearKidCookie, readKidCookie, setKidCookie, signKidCookie, verifyKidCookie, type KidCookieClaims } from './cookie';
export { createKidDesign, KID_MESSAGES, priceKidDesign, quoteDesign } from './designs';
export { createKidProfile, deleteKidProfile, exitKidsMode, getFamilyRow, getFamilyView, handOffToKid, setFamilyPin, updateKidProfile } from './family';
export { findSessionLock, lockSession, unlockSession } from './lock';
export { hashPin, pinAttemptLimiter, PIN_ATTEMPT_LIMIT, verifyPin } from './pin';
export { approveKidRequest, askGrownUp, declineKidRequest, listFamilyRequests, listKidThings, OverSpendingLimitError } from './requests';
export { assertNotKidMode, getKidSession, isKidMode, kidModeState, requireKidSession, type KidModeState, type KidSession } from './session';

export function kidHomeView(kid: KidSession): KidHomeView {
    return {
        kid: { nickname: kid.kid.nickname, avatar: kid.kid.avatar as KidAvatar },
        templates: allowedTemplatesOf(kid.kid).map((id) => ({ id, title: KID_TEMPLATES[id].title, blurb: KID_TEMPLATES[id].blurb })),
        canDiscover: kid.kid.discoverBrowsing,
        canWatchLive: kid.kid.liveViewing,
        spendingLimitCents: kid.kid.spendingLimitCents,
    };
}

/** A grown-up route: signed in, and this browser is not in Kids mode. */
export async function requireGrownUp(request: Request): Promise<ViewerContext> {
    await assertNotKidMode(request);
    return requireViewer(request);
}
