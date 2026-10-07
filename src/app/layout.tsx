import type { Metadata, Viewport } from 'next'
import { Archivo, JetBrains_Mono } from 'next/font/google'
import { Toaster } from 'sonner'
import { Providers } from './providers'
import './globals.css'

const archivo = Archivo({
    subsets: ['latin'],
    axes: ['wdth'],
    variable: '--font-archivo',
    display: 'swap',
})

const jetbrains = JetBrains_Mono({
    subsets: ['latin'],
    variable: '--font-jetbrains',
    display: 'swap',
})

export const metadata: Metadata = {
    title: {
        default: 'DiscoverMake · Discover. Make. Build.',
        template: '%s · DiscoverMake',
    },
    description: 'Upload a DXF, get an instant binding quote, and get real laser-cut, bent and finished parts from a vetted partner shop.',
}

export const viewport: Viewport = {
    themeColor: '#0c0e0d',
    width: 'device-width',
    initialScale: 1,
}

export default function RootLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <html lang="en" className={`${archivo.variable} ${jetbrains.variable}`}>
            <body className="flex min-h-screen flex-col antialiased" suppressHydrationWarning>
                <Providers>{children}</Providers>
                <Toaster position="bottom-center" theme="dark" toastOptions={{ className: 'font-sans' }} />
            </body>
        </html>
    )
}
