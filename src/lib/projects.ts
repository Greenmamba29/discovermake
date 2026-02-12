import { db } from "./firebase";
import {
    collection,
    query,
    where,
    orderBy,
    onSnapshot,
    doc,
    setDoc,
    serverTimestamp,
    Timestamp
} from "firebase/firestore";
import { safeGetDoc } from "./firestore";

export interface Project {
    id: string;
    ownerId: string;
    name: string;
    description?: string;
    status: 'pending' | 'active' | 'complete' | 'review';
    progress: number;
    makerId?: string;
    makerName?: string;
    tier?: string;
    createdAt: Timestamp;
    updatedAt: Timestamp;
}

/**
 * Create a new project in Firestore.
 * Uses setDoc with merge for offline-safe queueing.
 */
export const createProject = async (ownerId: string, data: Pick<Project, 'name' | 'description'>) => {
    console.log('createProject: starting', { ownerId, data });
    if (!db) {
        console.error('createProject: db is not initialized');
        return null;
    }

    try {
        // Generate a fresh doc reference
        const projectsRef = collection(db, "projects");
        const newDocRef = doc(projectsRef);

        const newProject: Partial<Project> = {
            ownerId,
            ...data,
            status: 'pending',
            progress: 0,
            createdAt: serverTimestamp() as Timestamp,
            updatedAt: serverTimestamp() as Timestamp
        };

        console.log('createProject: writing to Firestore', newDocRef.id, newProject);
        await setDoc(newDocRef, newProject, { merge: true });
        console.log('createProject: write complete');
        return newDocRef.id;
    } catch (error) {
        console.error('createProject error:', error);
        throw error;
    }
};

/**
 * Get all projects for a specific user.
 * Tries server first, fallback to cache.
 */
export const getUserProjects = (uid: string, callback: (projects: Project[]) => void) => {
    if (!db) return () => { };

    const q = query(
        collection(db, "projects"),
        where("ownerId", "==", uid),
        orderBy("createdAt", "desc")
    );

    return onSnapshot(q, (snapshot) => {
        const projects = snapshot.docs.map(d => ({
            id: d.id,
            ...d.data()
        })) as Project[];
        callback(projects);
    }, (error) => {
        console.error("getUserProjects subscription failed:", error);
    });
};

/**
 * Update project status or progress.
 */
export const updateProjectStatus = async (projectId: string, data: Partial<Pick<Project, 'status' | 'progress'>>) => {
    if (!db) return;
    const docRef = doc(db, "projects", projectId);
    await setDoc(docRef, {
        ...data,
        updatedAt: serverTimestamp()
    }, { merge: true });
};
