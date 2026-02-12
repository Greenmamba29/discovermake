import { db } from "./firebase";
import {
    collection,
    query,
    where,
    onSnapshot,
    doc,
    updateDoc,
    serverTimestamp,
    addDoc,
    orderBy,
    limit
} from "firebase/firestore";

export interface Gig {
    id: string;
    title: string;
    description: string;
    budget: {
        min: number;
        max: number;
    } | string;
    timeline: string;
    matchScore?: number;
    seekerVerified?: boolean;
    skills: string[];
    status: 'open' | 'active' | 'completed' | 'canceled' | 'dispute';
    id_architect: string;
    id_maker?: string;
    createdAt: any;
    updatedAt?: any;
}

/**
 * Fetch open gigs available for makers
 */
export const subscribeToAvailableGigs = (callback: (gigs: Gig[]) => void) => {
    if (!db) return () => { };

    const q = query(
        collection(db, "gigs"),
        where("status", "==", "open"),
        orderBy("createdAt", "desc"),
        limit(20)
    );

    return onSnapshot(q, (snapshot) => {
        const gigs = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        } as Gig));
        callback(gigs);
    });
};

/**
 * Accept a gig mission
 */
export const acceptGig = async (gigId: string, makerId: string) => {
    if (!db) return;
    const gigDoc = doc(db, "gigs", gigId);
    await updateDoc(gigDoc, {
        id_maker: makerId,
        status: "active",
        updatedAt: serverTimestamp()
    });
};

/**
 * Seed initial test gigs (Dev Only)
 */
export const seedTestGigs = async (architectId: string) => {
    if (!db) return;
    const testGigs: Omit<Gig, "id">[] = [
        {
            title: "E-Commerce Backend API",
            description: "Execute sovereign logic fabrication for Node.js, PostgreSQL, and Stripe integration.",
            budget: { min: 4200, max: 8000 },
            timeline: "14 days",
            matchScore: 95,
            seekerVerified: true,
            skills: ["Node.js", "PostgreSQL", "Stripe"],
            status: "open",
            id_architect: architectId,
            createdAt: serverTimestamp()
        },
        {
            title: "Mobile App UI Redesign",
            description: "Fabricate a glassmorphic UI system for high-fidelity mobile app using React Native.",
            budget: { min: 2800, max: 4500 },
            timeline: "10 days",
            matchScore: 87,
            seekerVerified: true,
            skills: ["Figma", "React Native", "Animations"],
            status: "open",
            id_architect: architectId,
            createdAt: serverTimestamp()
        }
    ];

    for (const gig of testGigs) {
        await addDoc(collection(db, "gigs"), gig);
    }
};
