"use client";

import React, { useState } from 'react';
import { GlassPanel, IronButton } from '@/components/ui/DesignSystem';
import { toast } from 'sonner';

export function StripeTestDashboard() {
    const [loading, setLoading] = useState(false);
    const [sessionUrl, setSessionUrl] = useState<string | null>(null);

    const handleTestPurchase = async () => {
        setLoading(true);
        try {
            const response = await fetch('/api/checkout', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    templateId: 'test-template-premium',
                    price: 49.99,
                    userId: 'test-user-123',
                    email: 'paco@example.com',
                    plan: 'standard',
                }),
            });

            const data = await response.json();
            if (data.url) {
                setSessionUrl(data.url);
                toast.success("Checkout session created!");
            } else {
                toast.error(data.error || "Failed to create checkout session");
            }
        } catch (error) {
            console.error('Test Purchase Error:', error);
            toast.error("Internal Server Error");
        } finally {
            setLoading(false);
        }
    };

    return (
        <GlassPanel variant="glow" className="p-6 max-w-2xl mx-auto mt-8 border-t-2 border-primary/50">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h2 className="text-2xl font-bold text-white tracking-wider uppercase">Stripe Genesis Console</h2>
                    <p className="text-muted-foreground text-sm italic">Simulating Protocol Transactions</p>
                </div>
                <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse shadow-[0_0_10px_rgba(34,197,94,0.8)]" />
            </div>

            <div className="grid gap-6">
                <div className="space-y-2">
                    <span className="text-blue-400 font-black uppercase text-[10px] tracking-widest italic">Transaction Protocol</span>
                    <div className="bg-black/40 rounded p-4 border border-white/10 font-mono text-xs text-green-400">
                        [SYS] Initializing payment simulation...
                        <br />
                        [AUTH] Test User: paco@example.com
                        <br />
                        [TARGET] Template: test-template-premium
                        <br />
                        [VALUE] $49.99
                    </div>
                </div>

                <div className="flex flex-wrap gap-4">
                    <IronButton
                        onClick={handleTestPurchase}
                        disabled={loading}
                        className="italic uppercase"
                    >
                        {loading ? "INITIALIZING..." : "EXECUTE TEST PURCHASE"}
                    </IronButton>

                    {sessionUrl && (
                        <IronButton
                            variant="secondary"
                            asChild
                            className="text-green-400 italic uppercase"
                        >
                            <a href={sessionUrl} target="_blank" rel="noopener noreferrer">
                                OPEN STRIPE CHECKOUT
                            </a>
                        </IronButton>
                    )}
                </div>

                <div className="pt-4 border-t border-white/10">
                    <p className="text-xs text-muted-foreground mb-4">
                        MCP TOOL INTEGRATION: Use the Stripe MCP tool `list_checkout_sessions` to verify status.
                    </p>
                    <div className="flex gap-2">
                        <div className="px-2 py-1 rounded bg-blue-500/10 border border-blue-500/20 text-[10px] text-blue-400 font-mono">
                            MCP: READY
                        </div>
                        <div className="px-2 py-1 rounded bg-purple-500/10 border border-purple-500/20 text-[10px] text-purple-400 font-mono">
                            WEBHOOK: LISTENING
                        </div>
                    </div>
                </div>
            </div>
        </GlassPanel>
    );
}
