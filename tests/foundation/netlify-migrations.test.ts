import { describe, expect, it } from 'vitest';
import { netlifyMigrations, staleNetlifyMigrations } from '../../scripts/ops/netlify-migrations';

describe('netlify/database/migrations mirror', () => {
    it('matches database/migrations (run bun run db:netlify after db:generate)', () => {
        expect(staleNetlifyMigrations()).toEqual([]);
    });

    it('sorts manual and data files after the migration they follow', () => {
        const names = [...netlifyMigrations().keys()].sort();
        expect(names.indexOf('00051_manual_approved_graph_immutable.sql')).toBe(names.indexOf('00050_r2_attachments.sql') + 1);
        expect(names.at(-1)).toBe('00111_data_catalog_seed.sql');
        const versions = names.map((n) => n.split('_')[0]);
        expect(new Set(versions).size).toBe(versions.length);
    });
});
