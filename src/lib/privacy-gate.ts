/**
 * US-002: Privacy Gate — Server-Side Utilities
 * 
 * Controls Maker identity revelation based on payment status.
 * In production, integrates with Firestore + Stripe webhooks.
 */

import { UserProfile } from "@/lib/firestore";

export interface MakerPublicProfile {
    id: string;
    skills: string[];
    rating: number;
    completedProjects: number;
    availability: "available" | "busy" | "offline";
    matchScore?: number;
    // Hidden fields — only visible after payment or to admin
    displayName?: string;
    photoURL?: string;
    hourlyRate?: number;
    email?: string;
    portfolio?: string;
    location?: string;
}

/**
 * Strip sensitive identity from a Maker profile.
 * Returns an anonymized version safe for pre-payment display.
 */
export function anonymizeMakerProfile(
    maker: MakerPublicProfile
): MakerPublicProfile {
    return {
        id: maker.id,
        skills: maker.skills,
        rating: maker.rating,
        completedProjects: maker.completedProjects,
        availability: maker.availability,
        matchScore: maker.matchScore,
        // Identity fields stripped
        displayName: undefined,
        photoURL: undefined,
        hourlyRate: undefined,
        email: undefined,
        portfolio: undefined,
        location: undefined,
    };
}

/**
 * Determine if a Seeker can see Maker identity.
 * Rules:
 *   1. Admin can ALWAYS see identity
 *   2. If Seeker has a completed payment for this Maker → reveal
 *   3. Otherwise → anonymized
 */
export function canRevealMaker(
    seekerProfile: UserProfile | null,
    makerId: string,
    paidMakerIds: Set<string>
): boolean {
    // Admin bypass
    if (seekerProfile?.role === "admin") return true;

    // Payment-gated reveal
    return paidMakerIds.has(makerId);
}

/**
 * Filter a list of Maker profiles based on visibility rules.
 * Admins see everything; Seekers see anonymized unless paid.
 */
export function filterMakerProfiles(
    makers: MakerPublicProfile[],
    seekerProfile: UserProfile | null,
    paidMakerIds: Set<string>
): MakerPublicProfile[] {
    return makers.map((maker) => {
        if (canRevealMaker(seekerProfile, maker.id, paidMakerIds)) {
            return maker; // Full profile
        }
        return anonymizeMakerProfile(maker);
    });
}

/**
 * Mock: Check which Makers a Seeker has paid for.
 * In production: query Firestore `payment_intents` collection.
 */
export async function getRevealedMakerIds(
    seekerId: string
): Promise<Set<string>> {
    // TODO: Replace with Firestore query
    // const payments = await db.collection('payments')
    //   .where('seekerId', '==', seekerId)
    //   .where('status', '==', 'succeeded')
    //   .get();
    // return new Set(payments.docs.map(d => d.data().makerId));
    return new Set<string>();
}

/**
 * Record a successful payment that unlocks a Maker.
 * Called from Stripe webhook handler.
 */
export async function recordMakerReveal(
    seekerId: string,
    makerId: string,
    paymentIntentId: string
): Promise<void> {
    // TODO: Write to Firestore
    // await db.collection('maker_reveals').add({
    //   seekerId,
    //   makerId,
    //   paymentIntentId,
    //   revealedAt: serverTimestamp(),
    // });
    console.log(`[Privacy Gate] Maker ${makerId} revealed to Seeker ${seekerId} via ${paymentIntentId}`);
}
