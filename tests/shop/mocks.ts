/**
 * Keep shop suites independent of the quote agent's in-progress module: use the REAL
 * markQuoteOrdered, falling back to the equivalent update only while it is a stub.
 *
 *   vi.mock('@/server/quote', async (orig) => (await import('./mocks')).quoteModuleMock(orig));
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
