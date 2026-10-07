/**
 * Global vitest setup: deterministic test env. Individual suites call
 * `createTestDb()` and `setDb()` for an isolated database.
 */
process.env.DATABASE_URL ||= 'postgresql://dm:dm@localhost:5432/discovermake';
process.env.APP_URL ||= 'http://localhost:3100';
process.env.STORAGE_DRIVER ||= 'local';
process.env.STORAGE_LOCAL_DIR ||= '.data/test-storage';
process.env.PAYMENT_PROVIDER ||= 'dev';
process.env.CARRIER ||= 'manual';
process.env.ORDER_LINK_SECRET ||= 'test-order-link-secret';
process.env.PASSPORT_SIGNING_SECRET ||= 'test-passport-secret';
process.env.JOB_PACKET_SIGNING_SECRET ||= 'test-job-packet-secret';
process.env.STORAGE_SIGNING_SECRET ||= 'test-storage-secret';
process.env.ADMIN_TOKEN ||= 'test-admin-token';
process.env.CRON_SECRET ||= 'test-cron-secret';
