"use client";

import { useAuth } from "@/components/auth-provider";
import { useRouter, usePathname } from "next/navigation";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
    const { user, loading } = useAuth();
    const router = useRouter();
    const pathname = usePathname();

    useEffect(() => {
        if (!loading && !user) {
            router.push(`/login?redirect=${encodeURIComponent(pathname)}`);
        }
    }, [user, loading, router, pathname]);

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-black">
                <div className="flex flex-col items-center gap-4">
                    <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
                    <p className="text-slate-500 font-medium">Authenticating...</p>
                </div>
            </div>
        );
    }

    if (!user) {
        return null;
    }

    return <>{children}</>;
}
