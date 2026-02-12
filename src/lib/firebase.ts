import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
    getFirestore,
    initializeFirestore,
    persistentLocalCache,
    persistentMultipleTabManager
} from "firebase/firestore";
import { getAnalytics } from "firebase/analytics";

const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID
};

// Singleton pattern to avoid re-initialization
const isConfigValid = !!(firebaseConfig.apiKey && firebaseConfig.projectId && !firebaseConfig.apiKey.includes('MOCK_KEY'));

let app: any = null;
let auth: any = null;
let db: any = null;
let analytics: any = null;

if (isConfigValid) {
    try {
        app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
        auth = getAuth(app);

        // Modern way to enable offline persistence (v11+)
        if (typeof window !== 'undefined') {
            db = initializeFirestore(app, {
                localCache: persistentLocalCache({
                    tabManager: persistentMultipleTabManager(),
                    cacheSizeBytes: 50 * 1024 * 1024 // 50MB
                }),
                // Resiliency for restricted networks/proxies
                experimentalAutoDetectLongPolling: true
            });
        } else {
            db = getFirestore(app);
        }

        // Analytics only works in browser environment
        if (typeof window !== 'undefined') {
            try {
                analytics = getAnalytics(app);
            } catch (err) {
                console.warn("Analytics initialization failed:", err);
            }
        }
    } catch (e) {
        console.error("Firebase Initialization Critical Failure:", e);
    }
} else {
    // Only warn in dev to avoid log noise in builds if intended
    if (process.env.NODE_ENV === 'development') {
        console.error("CRITICAL: Firebase keys are missing or invalid. Check your .env.local file.");
        console.log("Current Project ID:", firebaseConfig.projectId);
        console.log("Current API Key Status:", firebaseConfig.apiKey ? "Present (check if MOCK_KEY)" : "Missing");
    }
}

export { app, auth, db, analytics };
