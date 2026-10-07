/**
 * Sourcing errors (ADR-0005).
 *
 * `SourcingError` carries a `SourcingErrorCode` (the code an MCP agent sees in its
 * `SourcingToolError` body) and extends `ApiError`, so the same error thrown from a
 * sourcing service also renders correctly through `route()` on the HTTP side
 * (admin desk, buyer routes): the HTTP status comes from the mapping below and the
 * sourcing code + approval kind travel in `error.details`.
 */
import type { ApiErrorCode } from '../../contracts/common';
import type { ApprovalKind } from '../../contracts/enums';
import type { SourcingErrorCode, SourcingToolError } from '../../contracts/sourcing';
import { ApiError, statusForCode } from '../http';

/** HTTP mapping for sourcing codes (exhaustive). */
export function apiCodeFor(code: SourcingErrorCode): ApiErrorCode {
    switch (code) {
        case 'APPROVAL_REQUIRED':
            return 'FORBIDDEN';
        case 'STALE_DESIGN_VERSION':
        case 'LEASE_INVALID':
        case 'CONFLICT':
            return 'CONFLICT';
        case 'NOT_FOUND':
            return 'NOT_FOUND';
        case 'VALIDATION_FAILED':
            return 'VALIDATION_FAILED';
        case 'RATE_LIMITED':
            return 'RATE_LIMITED';
        case 'UNAUTHORIZED':
            return 'UNAUTHORIZED';
        default: {
            const never: never = code;
            throw new Error(`Unknown sourcing error code ${String(never)}`);
        }
    }
}

export class SourcingError extends ApiError {
    constructor(
        public readonly sourcingCode: SourcingErrorCode,
        message: string,
        public readonly approvalKind?: ApprovalKind,
    ) {
        const apiCode = apiCodeFor(sourcingCode);
        super(apiCode, message, statusForCode(apiCode), { sourcingCode, ...(approvalKind ? { approvalKind } : {}) });
        this.name = 'SourcingError';
    }

    /** The `structuredContent` body of an MCP tool error. */
    toToolError(): SourcingToolError {
        return { error: { code: this.sourcingCode, message: this.message, ...(this.approvalKind ? { approval_kind: this.approvalKind } : {}) } };
    }
}

export const notFound = (what: string) => new SourcingError('NOT_FOUND', `${what} not found`);
export const invalid = (message: string) => new SourcingError('VALIDATION_FAILED', message);
export const conflict = (message: string) => new SourcingError('CONFLICT', message);
