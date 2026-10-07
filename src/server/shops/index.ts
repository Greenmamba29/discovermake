/**
 * Shop Console domain: auth, job inbox, accept/decline, milestones, QA, shipment.
 *
 * OWNER: shop agent. Owns src/server/{dispatch,shops,shipping,passport}/**,
 * src/app/api/{shop,passport,admin}/**, src/app/api/webhooks/easypost/**, tests/shop/**.
 * Signatures FINAL.
 *
 * Order transitions driven from here (always via advanceOrder in the same tx as the job change):
 *   acceptJob                  DISPATCHED -> ACCEPTED (sets orders.shop_id), `job.accepted`
 *   declineJob                 `job.declined`; DISPATCHED -> PAID, then dispatchOrder(excluding this shop)
 *   recordMilestone (first)    ACCEPTED -> IN_PRODUCTION, `production.started`; every call `production.milestone`
 *                              (on a rework job: QA_FAILED -> IN_PRODUCTION)
 *   submitInspection PASS      IN_PRODUCTION -> QA_PASSED, `inspection.passed`, `production.completed`
 *   submitInspection FAIL      IN_PRODUCTION -> QA_FAILED, job QA_FAILED, NEW rework job (ACCEPTED, same shop),
 *                              `inspection.failed`
 *   createShipment             requires order QA_PASSED (else ApiError CONFLICT): QA_PASSED -> SHIPPED, `shipment.created`
 */
export { SHOP_SESSION_TTL_SECONDS, authenticateShop, createShopSession, getShopSession, revokeShopSession, resolveShopSession, toPrincipal } from './auth';
export {
    listJobs,
    getJob,
    acceptJob,
    declineJob,
    recordMilestone,
    createQaUpload,
    submitInspection,
    createShipment,
    evaluateInspection,
    DEFAULT_JOB_LIST_STATUSES,
} from './jobs';
export { requireShop, requireShopSession, readShopSessionSecret, readCookie, assertSameOrigin, sessionCookieOptions } from './request';
export { MILESTONE_LABELS, nextActionFor, toJobSummary } from './views';
