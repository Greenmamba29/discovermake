"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { TimeSavedToast } from "@/components/TimeSavedToast";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { recordPurchase } from "@/lib/firestore";
import { checkPurchaseStatus, getSecureDownloadUrl } from "@/lib/storage";
import { Download, CheckCircle2, Loader2 } from "lucide-react";

interface TemplateActionsProps {
    hoursSaved: number;
    price: number;
    templateId: string;
}

export function TemplateActions({ hoursSaved, price, templateId }: TemplateActionsProps) {
    const [showToast, setShowToast] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [hasAccess, setHasAccess] = useState(false);
    const [checkingAccess, setCheckingAccess] = useState(true);

    const { user } = useAuth();
    const router = useRouter();

    useEffect(() => {
        const verifyAccess = async () => {
            if (user && templateId) {
                const purchased = await checkPurchaseStatus(user.uid, templateId);
                setHasAccess(purchased || price === 0);
            }
            setCheckingAccess(false);
        };
        verifyAccess();
    }, [user, templateId, price]);

    const handleAction = async () => {
        if (!user) {
            router.push(`/login?redirect=/templates/${templateId}`);
            return;
        }

        if (hasAccess) {
            // Trigger Download
            setIsLoading(true);
            try {
                const url = await getSecureDownloadUrl(templateId);
                window.open(url, '_blank');
                setShowToast(true);
            } catch (error) {
                console.error("Download failed:", error);
            } finally {
                setIsLoading(false);
            }
            return;
        }

        // Processing Purchase
        setIsLoading(true);
        try {
            if (price === 0) {
                await recordPurchase(user.uid, templateId, 0);
                setHasAccess(true);
                setShowToast(true);
            } else {
                // Call Stripe Checkout API
                const response = await fetch('/api/checkout', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        templateId,
                        price,
                        userId: user.uid,
                        email: user.email,
                    }),
                });

                const data = await response.json();
                if (data.url) {
                    window.location.href = data.url;
                } else {
                    throw new Error(data.error || 'Failed to create checkout session');
                }
            }
        } catch (error) {
            console.error("Action failed:", error);
        } finally {
            setIsLoading(false);
        }
    };

    if (checkingAccess) {
        return <Button disabled className="w-full h-12"><Loader2 className="animate-spin mr-2" /> Checking Access...</Button>;
    }

    return (
        <div className="space-y-4">
            <Button
                onClick={handleAction}
                disabled={isLoading}
                variant={hasAccess ? "outline" : "default"}
                className={`w-full h-12 text-lg font-bold transition-all duration-300 ${!hasAccess ? "bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white shadow-lg shadow-blue-500/20" : "border-green-500 text-green-600 hover:bg-green-50"}`}
            >
                {isLoading ? (
                    <Loader2 className="animate-spin mr-2 h-5 w-5" />
                ) : hasAccess ? (
                    <>
                        <Download className="mr-2 h-5 w-5" /> Download Blueprint
                    </>
                ) : (
                    <>
                        {price === 0 ? "Get Template Free" : `Buy for $${price}`}
                    </>
                )}
            </Button>

            {hasAccess && (
                <div className="flex items-center justify-center gap-2 text-xs text-green-600 font-medium">
                    <CheckCircle2 className="w-4 h-4" /> You own this template
                </div>
            )}

            <p className="text-xs text-center text-slate-500 dark:text-slate-400">
                Instant download JSON • Lifetime updates
            </p>

            <TimeSavedToast
                hoursSaved={hoursSaved}
                isOpen={showToast}
                onClose={() => setShowToast(false)}
            />
        </div>
    );
}
