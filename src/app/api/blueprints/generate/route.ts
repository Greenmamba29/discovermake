import { NextRequest, NextResponse } from "next/server";
import { google } from "@ai-sdk/google";
import { generateText } from "ai";

const BLUEPRINT_SYSTEM_PROMPT = `You are the DiscoverMake AI Architect. When a user describes what they want to build, generate a structured project blueprint with 1-2 variations.

Return a JSON object matching this exact schema:
{
  "title": "Project Title",
  "description": "2-3 sentence project description",
  "scope": "mvp" | "production" | "enterprise",
  "complexity": 1-10,
  "estimatedTimeline": "X days/weeks",
  "estimatedBudget": { "min": number, "max": number },
  "techStack": ["technology1", "technology2"],
  "milestones": [
    { "title": "Milestone title", "duration": "X days", "deliverables": ["item1"] }
  ],
  "variations": [
    {
      "name": "Fast MVP",
      "timeline": "X days",
      "budget": { "min": number, "max": number },
      "tradeoffs": "What you gain vs lose",
      "features": ["feature1", "feature2"]
    },
    {
      "name": "Production-Ready", 
      "timeline": "X days",
      "budget": { "min": number, "max": number },
      "tradeoffs": "What you gain vs lose",
      "features": ["feature1", "feature2", "feature3"]
    }
  ]
}

Always provide exactly 2 variations: a "Fast MVP" (minimal, ship quickly) and "Production-Ready" (polished, scalable).
Budget should be realistic USD estimates for hiring on our platform.
Respond ONLY with valid JSON, no markdown fences.`;

export async function POST(request: NextRequest) {
    try {
        const { prompt, userId } = await request.json();

        if (!prompt) {
            return NextResponse.json(
                { error: "Project description is required" },
                { status: 400 }
            );
        }

        try {
            const { text } = await generateText({
                model: google("gemini-2.0-flash"),
                system: BLUEPRINT_SYSTEM_PROMPT,
                prompt: `The user wants to build: "${prompt}"

Generate a detailed project blueprint with 2 variations.`,
                temperature: 0.7,
                maxOutputTokens: 2000,
            });

            // Parse the JSON response
            let blueprint;
            try {
                // Strip any markdown code fences if present
                const cleanJson = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
                blueprint = JSON.parse(cleanJson);
            } catch (parseError) {
                // If JSON parsing fails, return raw text
                return NextResponse.json({
                    success: true,
                    raw: text,
                    blueprint: null,
                    message: "Generated blueprint text (JSON parsing failed)",
                });
            }

            return NextResponse.json({
                success: true,
                blueprint,
                generatedAt: new Date().toISOString(),
            });
        } catch (aiError: any) {
            // If AI SDK fails (e.g., no API key), return a mock blueprint
            console.warn("AI generation failed, returning mock blueprint:", aiError.message);

            const mockBlueprint = {
                title: extractTitle(prompt),
                description: `An AI-generated blueprint for: ${prompt}`,
                scope: "mvp",
                complexity: 5,
                estimatedTimeline: "2-3 weeks",
                estimatedBudget: { min: 2000, max: 8000 },
                techStack: ["React", "Node.js", "PostgreSQL", "Tailwind CSS"],
                milestones: [
                    { title: "Design & Architecture", duration: "3 days", deliverables: ["Wireframes", "Tech stack finalized"] },
                    { title: "Core Development", duration: "7 days", deliverables: ["Core features", "API endpoints"] },
                    { title: "Polish & Deploy", duration: "4 days", deliverables: ["Testing", "Deployment", "Documentation"] },
                ],
                variations: [
                    {
                        name: "⚡ Fast MVP",
                        timeline: "1-2 weeks",
                        budget: { min: 2000, max: 4000 },
                        tradeoffs: "Ship fast, iterate later. Basic UI, core features only.",
                        features: ["Core functionality", "Basic UI", "Essential API", "Simple auth"],
                    },
                    {
                        name: "🏗️ Production-Ready",
                        timeline: "3-4 weeks",
                        budget: { min: 5000, max: 10000 },
                        tradeoffs: "Built to scale. Premium UI, full feature set, monitoring.",
                        features: ["Full feature set", "Premium UI/UX", "Advanced auth", "Analytics", "CI/CD pipeline"],
                    },
                ],
            };

            return NextResponse.json({
                success: true,
                blueprint: mockBlueprint,
                generatedAt: new Date().toISOString(),
                mock: true,
            });
        }
    } catch (error) {
        console.error("Blueprint generation error:", error);
        return NextResponse.json(
            { error: "Failed to generate blueprint" },
            { status: 500 }
        );
    }
}

function extractTitle(prompt: string): string {
    const words = prompt.split(" ").slice(0, 5);
    return words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}
