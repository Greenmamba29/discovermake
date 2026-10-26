import { describe, expect, it } from 'vitest';
import { sameOriginUploadUrl } from './api';

describe('sameOriginUploadUrl', () => {
    it('sends the app signed storage route to the current origin, whatever host minted it', () => {
        const minted = 'https://discovermake.netlify.app/api/storage/local/parts/prt_1/source.dxf?m=PUT&exp=1&sig=abc';
        expect(sameOriginUploadUrl(minted, 'https://discovermake.com')).toBe('/api/storage/local/parts/prt_1/source.dxf?m=PUT&exp=1&sig=abc');
    });

    it('leaves S3 presigned URLs and unparseable input untouched', () => {
        const s3 = 'https://bucket.s3.amazonaws.com/parts/prt_1/source.dxf?X-Amz-Signature=x';
        expect(sameOriginUploadUrl(s3, 'https://discovermake.com')).toBe(s3);
        expect(sameOriginUploadUrl('http://[bad', 'https://discovermake.com')).toBe('http://[bad');
    });
});
