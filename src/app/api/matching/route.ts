import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/matching
 * 
 * Matching algorithm: skills × availability × rating
 * In production: queries Firestore for available Makers,
 * scores them against project requirements, returns ranked list.
 */

interface MatchRequest {
    description: string;
    budget: number;
    seekerId: string;
    requiredSkills?: string[];
}

interface MatchedMaker {
    id: string;
    matchScore: number;
    skills: string[];
    rating: number;
    availability: "available" | "busy" | "offline";
    eta: string;
}

export async function POST(request: NextRequest) {
    try {
        const body: MatchRequest = await request.json();

        if (!body.description) {
            return NextResponse.json(
                { error: "Project description is required" },
                { status: 400 }
            );
        }

        // Simulated matching algorithm
        // In production: query Makers collection, score against requirements
        const mockMatches: MatchedMaker[] = [
            {
                id: "maker-001",
                matchScore: 96,
                skills: ["React", "Next.js", "TypeScript"],
                rating: 4.9,
                availability: "available",
                eta: "Available now",
            },
            {
                id: "maker-002",
                matchScore: 92,
                skills: ["Python", "ML/AI", "FastAPI"],
                rating: 4.8,
                availability: "available",
                eta: "Available now",
            },
            {
                id: "maker-003",
                matchScore: 88,
                skills: ["UI/UX", "Figma", "React Native"],
                rating: 4.9,
                availability: "busy",
                eta: "2 min",
            },
            {
                id: "maker-004",
                matchScore: 84,
                skills: ["Solidity", "Web3", "Smart Contracts"],
                rating: 4.7,
                availability: "available",
                eta: "5 min",
            },
            {
                id: "maker-005",
                matchScore: 81,
                skills: ["iOS", "Swift", "SwiftUI"],
                rating: 4.8,
                availability: "available",
                eta: "3 min",
            },
        ];

        return NextResponse.json({
            success: true,
            matches: mockMatches,
            totalAvailable: 47,
            scanDurationMs: 1200,
            isTeamEligible: body.budget > 5000,
        });
    } catch (error) {
        console.error("Matching error:", error);
        return NextResponse.json(
            { error: "Failed to find matches" },
            { status: 500 }
        );
    }
}
