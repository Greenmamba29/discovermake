'use client'

import { useEffect } from 'react'
import { IronButton, GlassPanel, AnimatedText } from '@/components/ui/DesignSystem'
import { AlertCircle, RotateCcw, Home } from 'lucide-react'
import Link from 'next/link'

export default function Error({
    error,
    reset,
}: {
    error: Error & { digest?: string }
    reset: () => void
}) {
    useEffect(() => {
        // Log the error to an error reporting service
        console.error('Unhandled Runtime Error:', error)
    }, [error])

    return (
        <div className="min-h-screen bg-[#0B1120] flex items-center justify-center p-6 relative overflow-hidden">
            {/* Background Aura */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-danger/10 rounded-full blur-[120px] pointer-events-none" />

            <GlassPanel variant="glow" className="max-w-md w-full p-8 text-center space-y-8 border-danger/20 relative z-10">
                <div className="flex justify-center">
                    <div className="p-4 bg-danger/10 rounded-2xl border border-danger/20">
                        <AlertCircle className="w-12 h-12 text-danger" />
                    </div>
                </div>

                <div className="space-y-2">
                    <AnimatedText
                        text="Protocol Breakdown"
                        className="text-3xl font-black text-white italic tracking-tighter uppercase"
                    />
                    <p className="text-gray-500 font-medium italic">
                        The neural link has been severed. An unexpected error has occurred in the system kernel.
                    </p>
                </div>

                {error.digest && (
                    <div className="p-3 bg-black/40 rounded-xl border border-white/5">
                        <p className="text-[10px] font-mono font-bold text-gray-600 uppercase tracking-widest mb-1">Error Digest</p>
                        <p className="text-[10px] font-mono text-danger/80 break-all uppercase">{error.digest}</p>
                    </div>
                )}

                <div className="flex flex-col gap-3">
                    <IronButton
                        onClick={() => reset()}
                        variant="primary"
                        className="w-full h-12 text-xs uppercase italic font-black"
                        icon={<RotateCcw className="w-4 h-4" />}
                    >
                        Attempt Re-Sync
                    </IronButton>
                    <Link href="/" className="w-full">
                        <IronButton
                            variant="secondary"
                            className="w-full h-12 text-xs uppercase italic font-black"
                            icon={<Home className="w-4 h-4" />}
                        >
                            Return to Nexus
                        </IronButton>
                    </Link>
                </div>
            </GlassPanel>
        </div>
    )
}
