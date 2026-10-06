/**
 * CLI: `bun run db:seed` — idempotent R1 catalog + dev partner shop on DATABASE_URL.
 *
 *   bun run db:seed                     # catalog + "Philadelphia Precision Works" dev shop (+ console token)
 *   bun run db:seed -- --catalog-only   # catalog only (what production needs)
 *
 * With NODE_ENV=production the dev shop is never created: the seed runs catalog-only
 * unless --with-dev-shop is passed explicitly (e.g. a staging database).
 */
import { closeDb, getDb } from '../index';
import { seed } from '../seed';

const args = new Set(process.argv.slice(2));
const catalogOnly = args.has('--catalog-only') || (process.env.NODE_ENV === 'production' && !args.has('--with-dev-shop'));

seed(getDb(), { log: true, catalogOnly })
    .then(async (r) => {
        if (!r.shopId) {
            console.log(`[db:seed] catalog seeded (DFM ruleset ${r.rulesetVersion}); no dev shop. Onboard real shops with POST /api/admin/shops.`);
        } else {
            console.log(`[db:seed] shop "${r.shopId}" with rate card ${r.rateCardId}; DFM ruleset ${r.rulesetVersion}`);
            if (r.shopToken) {
                console.log('\n  Shop Console token for Philadelphia Precision Works (shown once, only its hash is stored):');
                console.log(`  ${r.shopToken}\n`);
            } else {
                console.log('[db:seed] existing dev shop token kept (set SEED_SHOP_TOKEN to replace it).');
            }
        }
        await closeDb();
        process.exit(0);
    })
    .catch(async (err) => {
        console.error('[db:seed] failed:', err);
        await closeDb();
        process.exit(1);
    });
