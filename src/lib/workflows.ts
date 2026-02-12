import { db } from "./firebase";
import {
    collection,
    addDoc,
    query,
    where,
    onSnapshot,
    orderBy,
    serverTimestamp,
    doc,
    updateDoc,
    Timestamp
} from "firebase/firestore";

export interface MakerMilestone {
    id: string;
    makerId: string;
    projectId: string;
    title: string;
    amount: number;
    status: "pending" | "in-progress" | "delivered" | "approved" | "paid";
    dueDate: string;
    deliveredAt?: string;
    paidAt?: string;
}

export interface MakerWorkflow {
    id: string;
    makerId: string;
    name: string;
    description: string;
    category: string;
    price: string;
    status: 'draft' | 'published';
    createdAt: any;
}

/**
 * Create a new workflow blueprint
 */
export const createWorkflow = async (uid: string, data: Omit<MakerWorkflow, "id" | "makerId" | "createdAt" | "status">) => {
    if (!db) return null;
    try {
        const workflowRef = await addDoc(collection(db, "workflows"), {
            ...data,
            makerId: uid,
            status: "published",
            createdAt: serverTimestamp()
        });
        return workflowRef.id;
    } catch (error) {
        console.error("Error creating workflow:", error);
        throw error;
    }
};

/**
 * Subscribe to maker milestones (earnings)
 */
export const subscribeToMakerMilestones = (uid: string, callback: (milestones: MakerMilestone[]) => void) => {
    if (!db) return () => { };

    const q = query(
        collection(db, "milestones"),
        where("makerId", "==", uid)
    );

    return onSnapshot(q, (snapshot) => {
        const data = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        } as MakerMilestone));
        callback(data);
    });
};

/**
 * Update milestone status (e.g. deliver)
 */
export const updateMilestoneStatus = async (id: string, status: MakerMilestone["status"], deliveredAt?: string) => {
    if (!db) return;
    const ref = doc(db, "milestones", id);
    const updates: any = { status };
    if (deliveredAt) updates.deliveredAt = deliveredAt;
    await updateDoc(ref, updates);
};
