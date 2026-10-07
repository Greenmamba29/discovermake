/** GET /api/passport/:passportId/verify -> PassportVerifyResponse (recomputes hash + HMAC signature). Public. */
import { PassportId } from '@/contracts/common';
import { ApiError, json, route } from '@/server/http';
import { verifyPassport } from '@/server/passport';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route<{ passportId: string }>(async (_request, { params }) => {
    const id = PassportId.safeParse((await params).passportId);
    if (!id.success) throw new ApiError('NOT_FOUND', 'Passport not found');
    const result = await verifyPassport(id.data);
    if (!result) throw new ApiError('NOT_FOUND', 'Passport not found');
    return json(result);
});
