import { describe, expect, it } from 'vitest';
import { KidTemplateBuildRequest, TEXT_TO_CAD_MAX_BODY_BYTES, TEXT_TO_CAD_MAX_SCRIPT_BYTES, TextToCadBuildRequest } from '@/contracts/text-to-cad';

describe('text-to-CAD contract', () => {
    it('validates kid template params against the named template', () => {
        expect(KidTemplateBuildRequest.parse({ template: 'name_keychain', params: { label: 'MIA', color: 'blue' } })).toMatchObject({ params: { size: 'small' } });
        expect(() => KidTemplateBuildRequest.parse({ template: 'desk_tidy', params: { color: 'blue', cups: 9 } })).toThrow();
        expect(() => KidTemplateBuildRequest.parse({ template: 'name_keychain', params: { label: 'mia@x.com', color: 'blue' } })).toThrow();
        expect(() => KidTemplateBuildRequest.parse({ template: 'name_keychain', params: { label: 'MIA', color: 'pink' } })).toThrow();
        expect(() => KidTemplateBuildRequest.parse({ template: 'rocket', params: {} })).toThrow();
    });

    it('keeps the largest valid script well inside the worker body cap, even fully escaped', () => {
        const script = '"'.repeat(TEXT_TO_CAD_MAX_SCRIPT_BYTES);
        const body = JSON.stringify(TextToCadBuildRequest.parse({ script }));
        expect(Buffer.byteLength(body)).toBeLessThan(TEXT_TO_CAD_MAX_BODY_BYTES);
        expect(() => TextToCadBuildRequest.parse({ script: 'x'.repeat(TEXT_TO_CAD_MAX_SCRIPT_BYTES + 1) })).toThrow();
    });
});
