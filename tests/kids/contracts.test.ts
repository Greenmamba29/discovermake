/** Kids & Family contracts: what may be collected about a child, defaults by age band, kid stages. */
import { describe, expect, it } from 'vitest';
import { CreateKidProfileRequest, defaultControlsFor, defaultTemplatesFor, GrownUpPin, kidStageFor, kidStageForOrder, KidNickname, UpdateKidProfileRequest, KID_DEFAULT_SPENDING_LIMIT_CENTS } from '@/contracts/kids';
import { KidLabel } from '@/contracts/text-to-cad';

describe('kid profile validation', () => {
    it('accepts a nickname of letters, numbers and spaces up to 12 characters', () => {
        expect(KidNickname.parse('  Mia  ')).toBe('Mia');
        expect(KidNickname.parse('Kid 2')).toBe('Kid 2');
        expect(KidNickname.safeParse('ABCDEFGHIJKLM').success).toBe(false);
        expect(KidNickname.safeParse('').success).toBe(false);
        for (const bad of ['mia@x.com', 'Mia-Rose', "O'Neil", 'call 555-1234', 'http://x']) expect(KidNickname.safeParse(bad).success, bad).toBe(false);
    });

    it('collects nothing else about a child: email, phone, photo, address, school or birthday are rejected', () => {
        const base = { nickname: 'Mia', ageBand: '10-12', avatar: 'fox' };
        expect(CreateKidProfileRequest.safeParse(base).success).toBe(true);
        for (const extra of [{ email: 'mia@example.com' }, { phone: '5551234' }, { photoUrl: 'x' }, { address: '1 Main' }, { school: 'PS 1' }, { birthday: '2015-01-01' }, { fullName: 'Mia Smith' }]) {
            expect(CreateKidProfileRequest.safeParse({ ...base, ...extra }).success, JSON.stringify(extra)).toBe(false);
            expect(UpdateKidProfileRequest.safeParse(extra).success, JSON.stringify(extra)).toBe(false);
        }
        expect(CreateKidProfileRequest.safeParse({ ...base, avatar: 'selfie' }).success).toBe(false);
        expect(CreateKidProfileRequest.safeParse({ ...base, ageBand: '5' }).success).toBe(false);
    });

    it('bounds the spending limit and the PIN', () => {
        expect(UpdateKidProfileRequest.safeParse({ spendingLimitCents: 499 }).success).toBe(false);
        expect(UpdateKidProfileRequest.safeParse({ spendingLimitCents: 20_001 }).success).toBe(false);
        expect(UpdateKidProfileRequest.safeParse({ spendingLimitCents: 4000 }).success).toBe(true);
        expect(GrownUpPin.safeParse('1234').success).toBe(true);
        for (const bad of ['123', '12345', 'abcd', '12 4']) expect(GrownUpPin.safeParse(bad).success).toBe(false);
    });

    it('defaults: age-appropriate templates, $25 per request, Live and Discover off for under-13s', () => {
        expect(defaultTemplatesFor('6-9')).toEqual(['name_keychain', 'bookmark']);
        expect(defaultTemplatesFor('10-12')).toEqual(['name_keychain', 'phone_stand', 'bookmark', 'desk_tidy', 'bike_hook']);
        expect(defaultControlsFor('6-9')).toMatchObject({ liveViewing: false, discoverBrowsing: false, spendingLimitCents: KID_DEFAULT_SPENDING_LIMIT_CENTS });
        expect(defaultControlsFor('10-12')).toMatchObject({ liveViewing: false, discoverBrowsing: false });
        expect(defaultControlsFor('13-17')).toMatchObject({ liveViewing: true, discoverBrowsing: true });
        expect(KID_DEFAULT_SPENDING_LIMIT_CENTS).toBe(2500);
    });

    it('kid labels give kid-safe messages', () => {
        expect(KidLabel.safeParse('MIA').success).toBe(true);
        expect(KidLabel.safeParse('mia@home').error?.issues[0]?.message).toBe('Use letters, numbers and spaces only.');
        expect(KidLabel.safeParse('ABCDEFGHIJKLM').error?.issues[0]?.message).toBe('Use 12 letters or fewer.');
    });
});

describe('kid stages from the real order', () => {
    it('maps every order status', () => {
        expect(kidStageForOrder(null)).toBeNull();
        expect(kidStageForOrder('PENDING_PAYMENT')).toBeNull();
        expect(kidStageForOrder('PAID')).toBe('making');
        expect(kidStageForOrder('IN_PRODUCTION')).toBe('making');
        expect(kidStageForOrder('SHIPPED')).toBe('on_its_way');
        expect(kidStageForOrder('DELIVERED')).toBe('here');
        expect(kidStageForOrder('REFUNDED')).toBe('stopped');
        expect(kidStageFor({ status: 'pending' }, null)).toBe('waiting');
        expect(kidStageFor({ status: 'approved' }, 'PENDING_PAYMENT')).toBe('waiting');
        expect(kidStageFor({ status: 'approved' }, 'ACCEPTED')).toBe('making');
        expect(kidStageFor({ status: 'declined' }, null)).toBe('not_this_time');
    });
});
