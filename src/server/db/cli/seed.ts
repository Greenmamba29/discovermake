/** CLI: `bun run db:seed` — idempotent R1 catalog + dev partner shop on DATABASE_URL. */
import { closeDb, getDb } from '../index';
import { seed } from '../seed';

seed(getDb(), { log: true })
    .then(async (r) => {
        console.log(`[db:seed] shop "${r.shopId}" with rate card ${r.rateCardId}; DFM ruleset ${r.rulesetVersion}`);
        if (r.shopToken) {
            console.log('\n  Shop Console token for Philadelphia Precision Works (shown once, only its hash is stored):');
            console.log(`  ${r.shopToken}\n`);
        } else {
            console.log('[db:seed] existing dev shop token kept (set SEED_SHOP_TOKEN to replace it).');
        }
        await closeDb();
        process.exit(0);
    })
    .catch(async (err) => {
        console.error('[db:seed] failed:', err);
        await closeDb();
        process.exit(1);
    });
