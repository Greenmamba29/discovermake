import { db } from "./firebase";
import {
    collection,
    query,
    where,
    onSnapshot,
    doc,
    setDoc,
    updateDoc,
    serverTimestamp,
    addDoc,
    orderBy,
    limit,
    getDoc
} from "firebase/firestore";

export interface Bounty {
    id: string;
    title: string;
    description: string;
    severity: 'Low' | 'Medium' | 'High' | 'Critical';
    reward: number;
    status: 'open' | 'escrow_pending' | 'escrow_locked' | 'active' | 'review' | 'completed' | 'canceled';
    createdBy: string;
    createdAt: any;
    updatedAt: any;
}

/**
 * Create a new bounty
 */
export const createBounty = async (uid: string, data: Omit<Bounty, "id" | "status" | "createdBy" | "createdAt" | "updatedAt">) => {
    if (!db) return null;
    try {
        const bountyRef = await addDoc(collection(db, "bounties"), {
            ...data,
            status: "escrow_pending",
            createdBy: uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
        return bountyRef.id;
    } catch (error) {
        console.error("Error creating bounty:", error);
        throw error;
    }
};

/**
 * Get bounty by ID
 */
export const getBounty = async (id: string) => {
    if (!db) return null;
    const bountyDoc = await getDoc(doc(db, "bounties", id));
    if (bountyDoc.exists()) {
        return { id: bountyDoc.id, ...bountyDoc.data() } as Bounty;
    }
    return null;
};

/**
 * Subscribe to open bounties
 */
export const subscribeToOpenBounties = (callback: (bounties: Bounty[]) => void) => {
    if (!db) return () => { };

    const q = query(
        collection(db, "bounties"),
        where("status", "==", "open"),
        orderBy("createdAt", "desc")
    );

    return onSnapshot(q, (snapshot) => {
        const bounties = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        } as Bounty));
        callback(bounties);
    });
};

/**
 * Subscribe to a single bounty
 */
export const subscribeToBounty = (id: string, callback: (bounty: Bounty | null) => void) => {
    if (!db) return () => { };
    return onSnapshot(doc(db, "bounties", id), (doc) => {
        if (doc.exists()) {
            callback({ id: doc.id, ...doc.data() } as Bounty);
        } else {
            callback(null);
        }
    });
};

/**
 * Update bounty status (e.g. after escrow lock)
 */
export const updateBountyStatus = async (id: string, status: Bounty["status"]) => {
    if (!db) return;
    await updateDoc(doc(db, "bounties", id), {
        status,
        updatedAt: serverTimestamp()
    });
};
