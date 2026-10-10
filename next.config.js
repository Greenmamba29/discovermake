const path = require('path');

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Content Security Policy (workflow 11). Static, so pages stay cacheable:
 * - scripts: same origin only. Next's inline bootstrap scripts need 'unsafe-inline'
 *   without per-request nonces; nothing else may inject script (no third-party origins,
 *   no eval outside dev).
 * - connect/img/media: same origin plus HTTPS (signed storage URLs, live/replay video).
 * - no framing, no plugins, no foreign form posts, no base-tag hijacking.
 */
const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' https: wss:${isDev ? ' ws:' : ''}`,
    "media-src 'self' blob: https:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://checkout.stripe.com",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ['upgrade-insecure-requests']),
].join('; ');

const securityHeaders = [
    { key: 'Content-Security-Policy', value: csp },
    { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    // Camera + microphone: photo capture (Reconstruct) and going live, same origin only.
    { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=(), payment=(self), usb=(), interest-cohort=()' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
    poweredByHeader: false,
    // The dev route badge sits over the phone bottom nav; compile/runtime errors still surface.
    devIndicators: false,
    // postgres-js and the AWS SDK are server-only runtime deps; keep them out of the bundle.
    serverExternalPackages: ['postgres', '@aws-sdk/client-s3', '@aws-sdk/s3-request-presigner'],
    turbopack: {
        root: path.resolve('.'),
    },
    // "Make it in 3D" reads the vendored text-to-cad guide (src/server/text-to-cad/guide) at runtime.
    outputFileTracingIncludes: {
        '/api/builds/*/text-to-cad': ['./src/server/text-to-cad/guide/**/*'],
    },
    async headers() {
        return [{ source: '/:path*', headers: securityHeaders }];
    },
};

module.exports = nextConfig;
