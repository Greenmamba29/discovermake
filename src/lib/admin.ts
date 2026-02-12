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

export interface AuditLog {
    id: string;
    timestamp: any;
    event: string;
    node: string;
    status: 'OK' | 'LOCKED' | 'TRIAGE' | 'ALERT';
}

export interface SystemStats {
    revenue: number;
    activeGigs: number;
    surgeRevenue: string;
    securityMatrix: {
        label: string;
        value: number;
        status: string;
        icon?: string;
    }[];
}

/**
 * Subscribe to real-time audit logs
 */
export const subscribeToAuditLogs = (callback: (logs: AuditLog[]) => void) => {
    if (!db) return () => { };

    const q = query(
        collection(db, "audit_logs"),
        orderBy("timestamp", "desc"),
        limit(20)
    );

    return onSnapshot(q, (snapshot) => {
        const logs = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        } as AuditLog));
        callback(logs);
    });
};

/**
 * Subscribe to system stats
 */
export const subscribeToSystemStats = (callback: (stats: SystemStats) => void) => {
    if (!db) return () => { };

    const statsDoc = doc(db, "system", "stats");
    return onSnapshot(statsDoc, (snapshot) => {
        if (snapshot.exists()) {
            callback(snapshot.data() as SystemStats);
        }
    });
};

/**
 * Log a system event
 */
export const logSystemEvent = async (event: string, node: string, status: AuditLog["status"]) => {
    if (!db) return;
    await addDoc(collection(db, "audit_logs"), {
        event,
        node,
        status,
        timestamp: serverTimestamp()
    });
};

/**
 * Seed initial admin stats for demo
 */
export const seedAdminStats = async () => {
    if (!db) return;
    const statsDoc = doc(db, "system", "stats");
    await setDoc(statsDoc, {
        revenue: 124500,
        activeGigs: 86,
        surgeRevenue: "$142.8k",
        securityMatrix: [
            { label: 'Handshake Integrity', value: 98, status: 'Stable' },
            { label: 'Clawback Shield', value: 100, status: 'Armed' },
            { label: 'Node Encryption', value: 92, status: 'Optimal' }
        ]
    });
};
