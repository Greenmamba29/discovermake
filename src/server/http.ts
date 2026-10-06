/**
 * Route-handler helpers shared by every `src/app/api/**` route.
 *
 *   export const POST = route(async (req) => {
 *       const body = await parseJson(req, CreateQuoteRequest);
 *       const quote = await createQuote(body);
 *       return json(quote, { status: 201 });
 *   });
 *
 * Errors: throw `ApiError` (or a ZodError) anywhere; `route()` turns it into the
 * `ApiErrorBody` contract shape. Unknown errors become 500 INTERNAL without
 * leaking messages in production.
 */
import { NextResponse } from 'next/server';
import { ZodError, type ZodType, type ZodTypeDef } from 'zod';
import type { ApiErrorBody, ApiErrorCode } from '../contracts/common';

export class ApiError extends Error {
    constructor(
        public readonly code: ApiErrorCode,
        message: string,
        public readonly status: number = statusForCode(code),
        public readonly details?: unknown,
    ) {
        super(message);
        this.name = 'ApiError';
    }
}

export function statusForCode(code: ApiErrorCode): number {
    switch (code) {
        case 'BAD_REQUEST':
        case 'VALIDATION_FAILED':
            return 400;
        case 'UNAUTHORIZED':
            return 401;
        case 'FORBIDDEN':
            return 403;
        case 'NOT_FOUND':
            return 404;
        case 'CONFLICT':
            return 409;
        case 'PAYLOAD_TOO_LARGE':
            return 413;
        case 'UNSUPPORTED_MEDIA_TYPE':
            return 415;
        case 'RATE_LIMITED':
            return 429;
        case 'PAYMENT_ERROR':
            return 402;
        case 'NOT_IMPLEMENTED':
            return 501;
        default:
            return 500;
    }
}

export function json<T>(data: T, init?: ResponseInit): NextResponse<T> {
    return NextResponse.json(data, {
        ...init,
        headers: { 'cache-control': 'no-store', ...(init?.headers ?? {}) },
    });
}

export function errorResponse(code: ApiErrorCode, message: string, status = statusForCode(code), details?: unknown) {
    const body: ApiErrorBody = { error: { code, message, ...(details !== undefined ? { details } : {}) } };
    return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

/** Parse + validate a JSON body. Throws ApiError(400) on malformed JSON or schema mismatch. */
export async function parseJson<Output, Input = Output>(request: Request, schema: ZodType<Output, ZodTypeDef, Input>): Promise<Output> {
    let raw: unknown;
    try {
        raw = await request.json();
    } catch {
        throw new ApiError('BAD_REQUEST', 'Request body must be valid JSON');
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
        throw new ApiError('VALIDATION_FAILED', 'Request validation failed', 400, parsed.error.flatten());
    }
    return parsed.data;
}

/** Validate query params (`Object.fromEntries(url.searchParams)`) against a schema. */
export function parseQuery<Output, Input = Output>(request: Request, schema: ZodType<Output, ZodTypeDef, Input>): Output {
    const params = Object.fromEntries(new URL(request.url).searchParams.entries());
    const parsed = schema.safeParse(params);
    if (!parsed.success) {
        throw new ApiError('VALIDATION_FAILED', 'Query validation failed', 400, parsed.error.flatten());
    }
    return parsed.data;
}

type RouteContext<P> = { params: Promise<P> };

/** Wrap a route handler with uniform error handling. Works with Next 16 async `params`. */
export function route<P = Record<string, string>>(
    handler: (request: Request, ctx: RouteContext<P>) => Promise<Response>,
): (request: Request, ctx: RouteContext<P>) => Promise<Response> {
    return async (request, ctx) => {
        try {
            return await handler(request, ctx);
        } catch (err) {
            return toErrorResponse(err);
        }
    };
}

export function toErrorResponse(err: unknown): Response {
    if (err instanceof ApiError) {
        return errorResponse(err.code, err.message, err.status, err.details);
    }
    if (err instanceof ZodError) {
        return errorResponse('VALIDATION_FAILED', 'Validation failed', 400, err.flatten());
    }
    const message = err instanceof Error ? err.message : String(err);
    // Domain errors from src/server/orders (matched by name to keep http.ts dependency-free).
    if (err instanceof Error && err.name === 'IllegalTransitionError') {
        return errorResponse('CONFLICT', message, 409);
    }
    if (err instanceof Error && err.name === 'OrderNotFoundError') {
        return errorResponse('NOT_FOUND', 'Order not found', 404);
    }
    if (message === 'not implemented') {
        return errorResponse('NOT_IMPLEMENTED', 'Not implemented yet', 501);
    }
    console.error('[api] unhandled error', err);
    return errorResponse('INTERNAL', process.env.NODE_ENV === 'production' ? 'Internal error' : message, 500);
}
