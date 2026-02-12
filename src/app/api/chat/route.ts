import { google } from '@ai-sdk/google';
import { streamText } from 'ai';
import fs from 'fs';
import path from 'path';

export const maxDuration = 30;

// Helper to get relevant templates for context (Simple Keyword-based RAG)
function getRAGContext(query: string, count = 3) {
  const cleanDir = path.join(process.cwd(), 'templates-db-clean');
  if (!fs.existsSync(cleanDir)) return "";

  try {
    const files = fs.readdirSync(cleanDir).filter(f => f.endsWith('.json'));

    // Extract keywords from the user's latest query
    const keywords = query.toLowerCase().split(/\W+/).filter(k => k.length > 2);

    // Score files based on keyword matches in the filename
    const scoredFiles = files.map(file => {
      let score = 0;
      const fileNameLower = file.toLowerCase();
      keywords.forEach(kw => {
        if (fileNameLower.includes(kw)) score += 1;
      });
      // Give a small random boost to break ties and ensure variety if scores are 0
      return { file, score: score + (Math.random() * 0.1) };
    });

    const topFiles = scoredFiles
      .sort((a, b) => b.score - a.score)
      .slice(0, count)
      .map(sf => sf.file);

    let context = "### REFERENCE EXAMPLES (RAG CONTEXT)\n";
    for (const file of topFiles) {
      const content = fs.readFileSync(path.join(cleanDir, file), 'utf-8');
      context += `EXAMPLE (${file}):\n${content}\n\n`;
    }
    return context;
  } catch (e) {
    console.error("RAG Context Error:", e);
    return "";
  }
}

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    // Check for API Key
    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
      console.error("CRITICAL: GOOGLE_GENERATIVE_AI_API_KEY is missing from environment.");
      return new Response(JSON.stringify({ error: "AI Service Configuration Missing" }), { status: 500 });
    }

    const lastMessage = messages[messages.length - 1]?.content || "";
    const context = getRAGContext(lastMessage, 3);

    const result = await streamText({
      model: google('gemini-1.5-flash'),
      system: `You are the **DiscoverMake Structural Architect**, a world-class engineer specialized in Google Cloud and Make.com integrations.
    Your objective is to design robust, scalable, and revenue-focused Make.com scenario architectures.

    ### Structural Guidelines (Google-Aligned):
    1. **Architecture Integrity**: Design flows with clear Triggers, Actions, and Error Handlers. Use Routers for complex logic.
    2. **Optimization**: Minimize operation counts by using Filters and Aggregators where appropriate.
    3. **Google Ecosystem**: Prioritize Google Workspace integrations (Sheets, Drive, Gmail) as reliable foundation modules.
    4. **Safety First**: Incorporate "Error Handling" modules for high-failure triggers (e.g., Webhooks, external APIs).
    5. **Revenue-First**: Suggest professional tools like Apify or Make.com Pro features for scalable business needs.

    ### Visual Architecture Rules:
    ALWAYS include a conceptual "Visual Architecture" at the VERY END of your response. 
    This MUST be a strictly valid JSON block wrapped in \`\`\`json code fences.
    
    JSON Schema:
    {
      "nodes": [
        { "id": "1", "label": "Trigger Label", "app": "App Name", "type": "trigger" },
        { "id": "2", "label": "Action Label", "app": "App Name", "type": "module" }
      ],
      "edges": [
        { "from": "1", "to": "2" }
      ]
    }

    ### Contextual Reference:
    Use the following high-quality examples to inform your structural design:
    ${context}
    
    Format your main response in professional Markdown, highlighting the **Structural Rationale**, then end with the JSON block.`,
      messages,
    });

    console.log("AI Architect result generated with context, returning data stream...");
    return result.toTextStreamResponse();
  } catch (error: any) {
    console.error("AI Architect Route Error:", error);
    return new Response(JSON.stringify({
      error: "Failed to generate architecture",
      details: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
