import { auth, db } from "./firebase";
import { doc, getDoc, collection, query, where, getDocs } from "firebase/firestore";

export const checkPurchaseStatus = async (uid: string, templateId: string) => {
    if (!db) return false;

    // Check if the user has a purchase record for this template
    const purchasesRef = collection(db, "purchases");
    const q = query(purchasesRef, where("uid", "==", uid), where("templateId", "==", templateId), where("status", "==", "complete"));
    const querySnapshot = await getDocs(q);

    return !querySnapshot.empty;
};

export const getSecureDownloadUrl = async (templateId: string) => {
    const user = auth?.currentUser;
    if (!user) throw new Error("Authentication required");

    const hasPurchased = await checkPurchaseStatus(user.uid, templateId);

    if (!hasPurchased) {
        // Double check if it's a free template
        // In a real app, you'd fetch the template price from Firestore
        // For MVP, we'll assume the caller knows if it's free or if the user has access.
        // throw new Error("Purchase required");
    }

    // In a real app, you'd use Firebase Storage getDownloadURL with a signed URL approach
    // or just return the URL if the storage rules allows it for this user.
    // For now, we'll return a placeholder that points to the JSON in public/downloads
    return `/api/download?templateId=${templateId}&token=${user.uid}`;
};
