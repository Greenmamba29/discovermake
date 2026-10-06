import type { Metadata } from 'next'
import { Toaster } from 'sonner'
import './globals.css'

export const metadata: Metadata = {
    title: 'DiscoverMake · Discover. Make. Build.',
    description: 'Upload a part, get an instant binding quote, and get real laser-cut, bent and finished parts from a vetted partner shop.',
}

export default function RootLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <html lang="en">
            <body className="antialiased min-h-screen flex flex-col" suppressHydrationWarning>
                {children}
                <Toaster position="bottom-right" richColors theme="dark" />
            </body>
        </html>
    )
}
