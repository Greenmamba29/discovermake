import type { MetadataRoute } from 'next'
import { env } from '@/server/env'

/** Public marketing and catalog pages are indexable; accounts, consoles, orders and Kids mode are not. */
export default function robots(): MetadataRoute.Robots {
    const base = env().APP_URL.replace(/\/$/, '')
    return {
        rules: [
            {
                userAgent: '*',
                allow: '/',
                disallow: ['/api/', '/admin', '/shop', '/studio', '/me', '/orders', '/checkout', '/cart', '/builds', '/build/', '/parts/', '/family', '/kids', '/signin', '/passport/'],
            },
        ],
        sitemap: `${base}/sitemap.xml`,
    }
}
