
import fs from 'fs';
import path from 'path';

const CLEAN_DIR = path.join(process.cwd(), 'templates-db-clean');
const SUPERPROMPT_PATH = path.join(process.cwd(), '..', '..', 'brain', '3d352f89-15be-4298-b85a-63cee867d583', 'ai_scenario_generator_superprompt.md');

// Mock User Request
const USER_REQUEST = "Create a scenario that watches my Gmail for emails with 'Invoice' in the subject, uploads the attachment to Google Drive, and then sends a Slack notification with the file link.";

async function generate() {
    console.log("🧠 Starting AI Scenario Generator Simulation...\n");

    // 1. Load System Prompt
    let systemPrompt = "";
    try {
        systemPrompt = fs.readFileSync(SUPERPROMPT_PATH, 'utf-8');
    } catch (e) {
        console.error("Could not load superprompt, using default.");
        systemPrompt = "You are a Make.com Scenario Architect.";
    }

    // 2. Load "RAG" Context (3 Random Templates)
    const files = fs.readdirSync(CLEAN_DIR).filter(f => f.endsWith('.json'));
    const randomFiles = files.sort(() => 0.5 - Math.random()).slice(0, 3);

    let contextData = "";
    for (const file of randomFiles) {
        const content = fs.readFileSync(path.join(CLEAN_DIR, file), 'utf-8');
        contextData += `EXAMPLE TEMPLATE (${file}):\n${content}\n\n`;
    }

    // 3. Construct Final Prompt
    const fullPrompt = `
${systemPrompt}

### CONTEXT (SIMILAR SCENARIOS)
${contextData}

### USER REQUEST
${USER_REQUEST}

### RESPONSE
    `;

    console.log("--- FINAL PROMPT SENT TO LLM ---");
    console.log(`(System Prompt Length: ${systemPrompt.length} chars)`);
    console.log(`(Context Length: ${contextData.length} chars)`);
    console.log(`\nUser Request: "${USER_REQUEST}"`);
    console.log("\n... [Simulating LLM Response] ...\n");

    // 4. Simulate Output (In a real app, this would be the API call)
    const simulatedResponse = {
        name: "Gmail to Drive to Slack Invoice Automation",
        flow: [
            { module: "google-email:watchEmails", metadata: { name: "Watch Invoices" } },
            { module: "google-drive:uploadFile", metadata: { name: "Upload Attachment" } },
            { module: "slack:postMessage", metadata: { name: "Notify Team" } }
        ]
    };

    console.log("--- AI GENERATED SCENARIO (PREVIEW) ---");
    console.log(JSON.stringify(simulatedResponse, null, 2));

    console.log("\n✅ Simulation Complete. In production, this JSON is sent to the Frontend Visualizer.");
}

generate();
