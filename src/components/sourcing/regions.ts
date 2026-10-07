/** Region choices on the "Find manufacturing partners" form (ISO 3166-1 alpha-2, the contract's `targetRegions`). */
export const SOURCING_REGIONS: readonly { code: string; label: string }[] = [
    { code: 'US', label: 'United States' },
    { code: 'CA', label: 'Canada' },
    { code: 'MX', label: 'Mexico' },
    { code: 'CN', label: 'China' },
    { code: 'VN', label: 'Vietnam' },
    { code: 'TW', label: 'Taiwan' },
    { code: 'IN', label: 'India' },
    { code: 'TH', label: 'Thailand' },
    { code: 'DE', label: 'Germany' },
];

export function regionName(code: string): string {
    const hit = SOURCING_REGIONS.find((r) => r.code === code.toUpperCase());
    if (hit) return hit.label;
    try {
        return new Intl.DisplayNames(['en'], { type: 'region' }).of(code.toUpperCase()) ?? code;
    } catch {
        return code;
    }
}
