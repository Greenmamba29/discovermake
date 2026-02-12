import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/marketplace/unlock
 * Handles Maker identity unlock — in production, triggers Stripe Checkout
 * For now: simulates payment and records reveal
 */
export async function POST(request: NextRequest) {
    try {
        const { seekerId, makerId } = await request.json();

        if (!seekerId || !makerId) {
            return NextResponse.json(
                { error: "Both seekerId and makerId are required" },
                { status: 400 }
            );
        }

        // In production:
        // 1. Create Stripe Checkout Session with makerId in metadata
        // 2. On `payment_intent.succeeded` webhook → call recordMakerReveal()
        // 3. Return Stripe Checkout URL

        // Simulated response
        const checkoutSession = {
            id: `cs_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            seekerId,
            makerId,
            status: "completed", // Simulated instant success
            amount: 4999, // $49.99 unlock fee
            currency: "usd",
            revealedAt: new Date().toISOString(),
        };

        return NextResponse.json({
            success: true,
            session: checkoutSession,
            message: "Maker identity unlocked successfully.",
        });
    } catch (error) {
        console.error("Unlock error:", error);
        return NextResponse.json(
            { error: "Failed to process unlock request" },
            { status: 500 }
        );
    }
}
