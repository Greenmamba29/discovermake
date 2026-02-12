import type { Metadata } from 'next'
import { SalesTicker } from '@/components/marketing/trust-signals'
import './globals.css'

export const metadata: Metadata = {
    title: 'DiscoverMake | Premium AI Automation Templates',
    description: 'The marketplace for professional AI-powered Make.com automation templates.',
}

import { Navbar } from '@/components/navbar';
import { AuthProvider } from '@/components/auth-provider';
import { Toaster } from 'sonner';

export default function RootLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <html lang="en">
            <body className="antialiased min-h-screen flex flex-col" suppressHydrationWarning>
                <AuthProvider>
                    {children}
                </AuthProvider>
                <Toaster position="bottom-right" richColors theme="dark" />
            </body>
        </html>
    )
}
