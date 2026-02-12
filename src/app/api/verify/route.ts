import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/verify
 * Handles identity verification submission
 * In production: integrates with Stripe Identity or Jumio
 * For now: simulates verification with pending status
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { userId, documentType, documentData, selfieData } = body;

        if (!userId) {
            return NextResponse.json(
                { error: "User ID is required" },
                { status: 400 }
            );
        }

        // In production, this would:
        // 1. Upload documents to secure storage (Stripe Identity / Jumio)
        // 2. Trigger verification process
        // 3. Set up webhook for verification result
        // 4. Return session ID for tracking

        // Simulated response
        const verificationSession = {
            id: `vs_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            userId,
            status: "pending",
            documentType: documentType || "government_id",
            submittedAt: new Date().toISOString(),
            estimatedCompletionMinutes: 5,
        };

        return NextResponse.json({
            success: true,
            session: verificationSession,
            message: "Verification documents submitted. Processing typically takes under 5 minutes.",
        });
    } catch (error) {
        console.error("Verification error:", error);
        return NextResponse.json(
            { error: "Failed to process verification request" },
            { status: 500 }
        );
    }
}

/**
 * GET /api/verify?userId=xxx
 * Check verification status
 */
export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");

    if (!userId) {
        return NextResponse.json(
            { error: "User ID is required" },
            { status: 400 }
        );
    }

    // In production: query Firestore or verification provider
    // Simulated response
    return NextResponse.json({
        userId,
        status: "pending", // unverified | pending | verified | rejected
        submittedAt: new Date().toISOString(),
        message: "Verification in progress",
    });
}
