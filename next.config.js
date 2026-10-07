const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
    // postgres-js and the AWS SDK are server-only runtime deps; keep them out of the bundle.
    serverExternalPackages: ['postgres', '@aws-sdk/client-s3', '@aws-sdk/s3-request-presigner'],
    turbopack: {
        root: path.resolve('.'),
    },
};

module.exports = nextConfig;
