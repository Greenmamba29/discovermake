/**
 * Module-mock factories shared by orders suites. Each suite declares (hoisted):
 *
 *   const { dispatchOrderMock } = vi.hoisted(() => ({ dispatchOrderMock: vi.fn(async (_id: string) => null) }));
 *   vi.mock('@/server/dispatch', () => ({ dispatchOrder: (id: string) => dispatchOrderMock(id), expireStaleOffers: async () => 0 }));
 *   vi.mock('@/server/quote', async (orig) => (await import('./mocks')).quoteModuleMock(orig));
 *
 * - dispatch is a spy so order suites stay deterministic (tests/shop covers dispatch).
 * - the REAL quote.markQuoteOrdered is used; only while it is still the foundation stub
 *   ("not implemented") do we fall back to the equivalent update, so these suites can
 *   run in parallel with the quote agent's work.
 */
export async function quoteModuleMock(importOriginal: <T>() => Promise<T>) {
    const actual = await importOriginal<typeof import('@/server/quote')>();
    const { eq } = await import('drizzle-orm');
    const { getDb } = await import('@/server/db');
    const { quotes } = await import('@/server/db/schema');
    return {
        ...actual,
        markQuoteOrdered: async (quoteId: string, tx?: Parameters<typeof actual.markQuoteOrdered>[1]) => {
            try {
                await actual.markQuoteOrdered(quoteId, tx);
            } catch (err) {
                if (!(err instanceof Error) || err.message !== 'not implemented') throw err;
                await (tx ?? getDb()).update(quotes).set({ status: 'ORDERED' }).where(eq(quotes.id, quoteId));
            }
        },
    };
}
