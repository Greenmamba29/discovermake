"use client";

import { createContext, useContext, useState, useEffect, useRef } from "react";
import { User, onAuthStateChanged, signOut as firebaseSignOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { syncUserProfile, UserProfile } from "@/lib/firestore";
import { useRouter, usePathname } from "next/navigation";

interface AuthContextType {
    user: User | null;
    userData: UserProfile | null;
    loading: boolean;
    signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    userData: null,
    loading: true,
    signOut: async () => { },
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [userData, setUserData] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const router = useRouter();
    const pathname = usePathname();
    const pathnameRef = useRef(pathname);

    // Keep the ref in sync so the auth callback always has the latest pathname
    useEffect(() => {
        pathnameRef.current = pathname;
    }, [pathname]);

    // Auth listener — subscribe ONCE, not on every pathname change
    useEffect(() => {
        const searchParams = new URLSearchParams(window.location.search);
        const isDemo = searchParams.get('demo') === 'true';

        if (isDemo) {
            setUser({
                uid: 'demo-user-123',
                displayName: 'Demo Architect',
                email: 'demo@discovermake.com',
            } as User);
            setUserData({
                uid: 'demo-user-123',
                onboardingCompleted: true,
                verificationStatus: 'verified',
                role: 'user',
                displayName: 'Demo Architect',
                email: 'demo@discovermake.com',
                createdAt: new Date().toISOString(),
                lastLogin: new Date().toISOString()
            });
            setLoading(false);
            return;
        }

        if (!auth) {
            setLoading(false);
            return;
        }

        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            setUser(currentUser);
            if (currentUser) {
                try {
                    const profile = await syncUserProfile(currentUser);
                    setUserData(profile);

                    // Gating: redirect to onboarding only if needed
                    const currentPath = pathnameRef.current;
                    const isExempt = currentPath === "/onboarding" ||
                        currentPath?.startsWith("/dashboard") ||
                        currentPath?.startsWith("/admin");
                    if (profile && !profile.onboardingCompleted && !isExempt) {
                        router.push("/onboarding");
                    }
                } catch (error) {
                    console.error("Auth: Failed to sync user profile", error);
                }
            } else {
                setUserData(null);
            }
            setLoading(false);
        });
        return () => unsubscribe();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Subscribe once on mount — pathnameRef handles dynamic path checks

    const signOut = async () => {
        if (auth) {
            await firebaseSignOut(auth);
            router.push("/login");
        }
    };

    return (
        <AuthContext.Provider value={{ user, userData, loading, signOut }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);
