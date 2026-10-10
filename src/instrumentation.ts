/**
 * Server error reporting (GA observability). Every error Next captures on the server
 * becomes one structured JSON log line: path (query stripped, it can carry order
 * tokens), method, route, render source and digest. No headers, bodies or cookies are
 * logged. Log drains (Vercel, Datadog, Grafana) index these lines by `event`.
 */
import type { Instrumentation } from 'next'

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
    const e = err instanceof Error ? err : new Error(String(err))
    const digest = typeof err === 'object' && err !== null && 'digest' in err ? String((err as { digest: unknown }).digest) : undefined
    console.error(
        JSON.stringify({
            event: 'server.request_error',
            at: new Date().toISOString(),
            message: e.message.slice(0, 500),
            name: e.name,
            digest,
            path: request.path.split('?')[0],
            method: request.method,
            routePath: context.routePath,
            routeType: context.routeType,
            renderSource: context.renderSource,
        }),
    )
}
