/**
 * The slice of the R1 catalog the Build Graph and the Materials Engineer reason over:
 * active materials, processes (with the materials each one cuts or bends) and services.
 * Read-only. Anything outside these rows is "needs sourcing" (sourcing bridge, ADR-0005).
 */
import { asc, eq } from 'drizzle-orm';
import type { MaterialCategory, ProcessKind, ServiceKind } from '../../contracts/enums';
import { getDb, type DbOrTx } from '../db';
import { materials, processes, services, thicknessOptions } from '../db/schema';

export type CatalogMaterial = { slug: string; name: string; category: MaterialCategory; description: string };
export type CatalogProcess = { slug: string; name: string; kind: ProcessKind; materialSlugs: string[] };
export type CatalogService = { slug: string; name: string; kind: ServiceKind; compatibleMaterialSlugs: string[] };
export type BuildCatalog = { materials: CatalogMaterial[]; processes: CatalogProcess[]; services: CatalogService[] };

export async function loadBuildCatalog(db: DbOrTx = getDb()): Promise<BuildCatalog> {
    const [materialRows, processRows, links, serviceRows] = await Promise.all([
        db
            .select({ slug: materials.slug, name: materials.name, category: materials.category, description: materials.description })
            .from(materials)
            .where(eq(materials.active, true))
            .orderBy(asc(materials.sortOrder), asc(materials.name)),
        db.select({ id: processes.id, slug: processes.slug, name: processes.name, kind: processes.kind }).from(processes).where(eq(processes.active, true)).orderBy(asc(processes.slug)),
        db
            .select({ processId: thicknessOptions.processId, materialSlug: materials.slug })
            .from(thicknessOptions)
            .innerJoin(materials, eq(materials.id, thicknessOptions.materialId))
            .where(eq(thicknessOptions.active, true)),
        db
            .select({ slug: services.slug, name: services.name, kind: services.kind, compatibleMaterialSlugs: services.compatibleMaterialSlugs })
            .from(services)
            .where(eq(services.active, true))
            .orderBy(asc(services.sortOrder), asc(services.name)),
    ]);
    const byProcess = new Map<string, Set<string>>();
    for (const l of links) {
        const set = byProcess.get(l.processId) ?? new Set<string>();
        set.add(l.materialSlug);
        byProcess.set(l.processId, set);
    }
    return {
        materials: materialRows,
        processes: processRows.map((p) => ({ slug: p.slug, name: p.name, kind: p.kind, materialSlugs: [...(byProcess.get(p.id) ?? [])].sort() })),
        services: serviceRows,
    };
}
