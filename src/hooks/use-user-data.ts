"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/components/auth-provider";
import { getUserProfile, syncUserProfile, UserProfile } from "@/lib/firestore";

export function useUserData() {
    const { user, loading: authLoading } = useAuth();
    const [userData, setUserData] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchData = async () => {
            if (authLoading) return;

            if (!user) {
                setUserData(null);
                setLoading(false);
                return;
            }

            try {
                const profile = await syncUserProfile(user);
                setUserData(profile);
            } catch (err: any) {
                console.error("Error fetching user data:", err);
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [user, authLoading]);

    return {
        userData, loading, error, refresh: async () => {
            if (user) {
                const profile = await getUserProfile(user.uid);
                setUserData(profile);
            }
        }
    };
}
