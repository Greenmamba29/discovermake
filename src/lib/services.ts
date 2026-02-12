import { db, auth } from './firebase';
import {
    collection,
    doc,
    getDoc,
    getDocs,
    setDoc,
    updateDoc,
    query,
    where,
    FieldValue,
    serverTimestamp
} from 'firebase/firestore';
import {
    signInWithPopup,
    GoogleAuthProvider,
    signOut,
    onAuthStateChanged,
    User
} from 'firebase/auth';

/**
 * AUTH SERVICES
 */
export const authService = {
    /**
     * Google OAuth Login
     */
    async loginWithGoogle() {
        const provider = new GoogleAuthProvider();
        try {
            const result = await signInWithPopup(auth, provider);
            return result.user;
        } catch (error) {
            console.error("AuthService: Google Login Failed", error);
            throw error;
        }
    },

    /**
     * Logout
     */
    async logout() {
        try {
            await signOut(auth);
        } catch (error) {
            console.error("AuthService: Logout Failed", error);
            throw error;
        }
    },

    /**
     * Auth State Listener
     */
    onAuthStateChanged(callback: (user: User | null) => void) {
        return onAuthStateChanged(auth, callback);
    }
};

/**
 * FIRESTORE SERVICES
 */
export const dbService = {
    /**
     * Universal Get Doc
     */
    async getDocument<T>(path: string, id: string): Promise<T | null> {
        const docRef = doc(db, path, id);
        const docSnap = await getDoc(docRef);
        return docSnap.exists() ? (docSnap.data() as T) : null;
    },

    /**
     * Universal Set/Create Doc
     */
    async setDocument(path: string, id: string, data: any) {
        const docRef = doc(db, path, id);
        return setDoc(docRef, {
            ...data,
            updatedAt: serverTimestamp(),
        }, { merge: true });
    },

    /**
     * User Specific Services
     */
    async getUserProfile(uid: string) {
        return this.getDocument('users', uid);
    },

    async updateUserProfile(uid: string, data: any) {
        const docRef = doc(db, 'users', uid);
        return updateDoc(docRef, {
            ...data,
            lastActive: serverTimestamp()
        });
    }
};
