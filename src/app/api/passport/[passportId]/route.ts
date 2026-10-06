/**
 * GET /api/passport/:passportId -> PassportPublicView (+ qrCodeDataUrl)
 * Public, no buyer PII. `verified` is recomputed from the stored snapshot on every read.
 * `qrCodeDataUrl` (additive field) is a PNG data URL encoding `verifyUrl` for packaging labels.
 */
import { PassportId } from '@/contracts/common';
import { ApiError, json, route } from '@/server/http';
import { getPublicPassport, passportQrCodeDataUrl } from '@/server/passport';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route<{ passportId: string }>(async (_request, { params }) => {
    const id = PassportId.safeParse((await params).passportId);
    if (!id.success) throw new ApiError('NOT_FOUND', 'Passport not found');
    const view = await getPublicPassport(id.data);
    if (!view) throw new ApiError('NOT_FOUND', 'Passport not found');
    return json({ ...view, qrCodeDataUrl: await passportQrCodeDataUrl(view.id) });
});
