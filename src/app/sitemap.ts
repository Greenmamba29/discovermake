import type { MetadataRoute } from 'next'
import { LEGAL_SLUGS } from '@/lib/legal'
import { env } from '@/server/env'

/** The public pages a visitor can open without an account. */
export default function sitemap(): MetadataRoute.Sitemap {
    const base = env().APP_URL.replace(/\/$/, '')
    const paths = ['/', '/make', '/discover', '/live', '/prime', '/reconstruct', ...LEGAL_SLUGS.map((s) => `/legal/${s}`)]
    return paths.map((p) => ({ url: p === '/' ? `${base}/` : `${base}${p}`, changeFrequency: p.startsWith('/legal') ? 'yearly' : 'weekly' }))
}
