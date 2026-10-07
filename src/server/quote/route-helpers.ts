/**
 * Small helpers for the quote engine's route handlers (src/app/api/{parts,quotes,builds,catalog}).
 */
import type { ZodType, ZodTypeDef } from 'zod';
import { ApiError, MAX_JSON_BODY_BYTES, readBodyText } from '../http';

/** Read a JSON body; an empty body becomes `{}` (for endpoints whose fields are all optional). */
export async function readJsonBody(request: Request, opts: { allowEmpty?: boolean } = {}): Promise<unknown> {
    const text = await readBodyText(request, MAX_JSON_BODY_BYTES);
    if (!text.trim()) {
        if (opts.allowEmpty) return {};
        throw new ApiError('BAD_REQUEST', 'Request body must be valid JSON');
    }
    try {
        return JSON.parse(text);
    } catch {
        throw new ApiError('BAD_REQUEST', 'Request body must be valid JSON');
    }
}

export function validate<Output, Input = Output>(raw: unknown, schema: ZodType<Output, ZodTypeDef, Input>): Output {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) throw new ApiError('VALIDATION_FAILED', 'Request validation failed', 400, parsed.error.flatten());
    return parsed.data;
}

/** Validate a path id; malformed ids are reported as 404 (never hit the database). */
export function pathId<T>(value: string, schema: ZodType<T>, what: string): T {
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new ApiError('NOT_FOUND', `${what} not found`);
    return parsed.data;
}
