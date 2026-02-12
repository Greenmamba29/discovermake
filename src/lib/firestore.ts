import { db } from "./firebase";
import {
    doc,
    getDoc,
    getDocFromCache,
    setDoc,
    updateDoc,
    collection,
    query,
    where,
    getDocs,
    Timestamp,
    serverTimestamp
} from "firebase/firestore";

export interface UserProfile {
    uid: string;
    email: string | null;
    displayName: string | null;
    photoURL?: string | null;
    role: "user" | "admin" | "agency";
    createdAt: any;
    lastLogin: any;
    is_agency_partner?: boolean;
    subscription_tier?: "free" | "pro" | "agency";
    subscription?: string;
    stripeCustomerId?: string;
    saved_templates?: string[];
    onboardingCompleted?: boolean;
    onboardingData?: {
        persona?: "seeker" | "maker" | "creator";
        techStack?: string[];
        experience?: "beginner" | "intermediate" | "pro";
        intent?: string;
        budgetRange?: string;
        projectTypes?: string[];
    };
    verificationStatus?: "unverified" | "pending" | "verified" | "rejected";
    verificationSubmittedAt?: any;
    makerProfile?: {
        skills: string[];
        hourlyRate?: number;
        availability?: "available" | "busy" | "offline";
        acceptanceRate?: number;
        completedProjects?: number;
        rating?: number;
    };
    downloads?: number;
}

export interface Review {
    id?: string;
    templateId: string;
    uid: string;
    displayName: string;
    rating: number;
    comment: string;
    createdAt: any;
    isVerifiedPurchase: boolean;
}

/**
 * Safely read a Firestore document.
 * Tries the server first, falls back to local cache if offline.
 */
export async function safeGetDoc(ref: any) {
    try {
        return await getDoc(ref);
    } catch (err: any) {
        if (err.code === "unavailable" || err.message?.includes("offline")) {
            console.warn("Firestore offline – falling back to cache");
            try {
                return await getDocFromCache(ref);
            } catch {
                return null; // Cache miss – doc was never fetched
            }
        }
        throw err;
    }
}

export const syncUserProfile = async (user: any) => {
    if (!db || !user) return null;

    try {
        const userDocRef = doc(db, "users", user.uid);
        const userDoc = await safeGetDoc(userDocRef);

        if (!userDoc || !userDoc.exists()) {
            const newProfile: UserProfile = {
                uid: user.uid,
                email: user.email,
                displayName: user.displayName,
                photoURL: user.photoURL,
                role: "user",
                createdAt: serverTimestamp(),
                lastLogin: serverTimestamp(),
                saved_templates: [],
                onboardingCompleted: false
            };
            // setDoc with merge queues offline — won't throw
            await setDoc(userDocRef, newProfile, { merge: true });
            return newProfile;
        } else {
            // Update lastLogin silently — fire and forget
            setDoc(userDocRef, { lastLogin: serverTimestamp() }, { merge: true }).catch(() => { });
            return userDoc.data() as UserProfile;
        }
    } catch (error: any) {
        console.warn("syncUserProfile: graceful fallback", error.message);
        return null;
    }
};

export const updateUserProfile = async (uid: string, data: Partial<UserProfile>) => {
    if (!db) return;
    // setDoc with merge is offline-safe — it queues the write locally
    const userDocRef = doc(db, "users", uid);
    await setDoc(userDocRef, data, { merge: true });
};

export const getUserProfile = async (uid: string) => {
    if (!db) return null;
    try {
        const userDoc = await safeGetDoc(doc(db, "users", uid));
        return userDoc?.exists() ? (userDoc.data() as UserProfile) : null;
    } catch {
        return null;
    }
};

export const toggleSavedTemplate = async (uid: string, templateId: string) => {
    if (!db) return;
    try {
        const userDocRef = doc(db, "users", uid);
        const userDoc = await safeGetDoc(userDocRef);

        if (userDoc?.exists()) {
            const data = userDoc.data() as UserProfile;
            const savedTemplates = data.saved_templates || [];
            const index = savedTemplates.indexOf(templateId);
            if (index > -1) {
                savedTemplates.splice(index, 1);
            } else {
                savedTemplates.push(templateId);
            }
            await setDoc(userDocRef, { saved_templates: savedTemplates }, { merge: true });
        }
    } catch (e) {
        console.warn("toggleSavedTemplate: offline fallback", e);
    }
};

export const addReview = async (review: Omit<Review, "id" | "createdAt" | "isVerifiedPurchase">) => {
    if (!db) return;
    const reviewsRef = collection(db, "reviews");
    const newReview = {
        ...review,
        createdAt: serverTimestamp(),
        isVerifiedPurchase: false
    };
    await setDoc(doc(reviewsRef), newReview);
};

export const getReviews = async (templateId: string) => {
    if (!db) return [];
    try {
        const reviewsRef = collection(db, "reviews");
        const q = query(reviewsRef, where("templateId", "==", templateId));
        const querySnapshot = await getDocs(q);
        return querySnapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Review[];
    } catch {
        return [];
    }
};

export const recordPurchase = async (uid: string, templateId: string, amount: number, stripeSessionId?: string) => {
    if (!db) return;
    try {
        const purchasesRef = collection(db, "purchases");
        await setDoc(doc(purchasesRef), {
            uid,
            templateId,
            amount,
            stripeSessionId,
            status: "complete",
            createdAt: serverTimestamp()
        });

        // Increment download count
        const userDocRef = doc(db, "users", uid);
        const userDoc = await safeGetDoc(userDocRef);
        if (userDoc?.exists()) {
            const currentDownloads = (userDoc.data() as any).downloads || 0;
            await setDoc(userDocRef, { downloads: currentDownloads + 1 }, { merge: true });
        }
    } catch (e) {
        console.warn("recordPurchase: offline fallback", e);
    }
};
