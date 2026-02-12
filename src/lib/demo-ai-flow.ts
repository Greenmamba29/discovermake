import { AIOrchestrator, UserTier } from './ai-orchestrator';

async function demoAIFlow() {
    console.log("--- DiscoverMake AI Mission Flow Demo ---");

    // 1. Seeker makes a request (Pro Tier)
    const prompt = "I need a scalable blueprint for a decentralized payment router that integrates with Stripe and support 10k RPS.";
    const tier: UserTier = 'Pro';

    console.log(`\n[SEEKER] Requesting: "${prompt}"`);
    const blueprint = await AIOrchestrator.processRequest(prompt, tier);

    console.log(`\n[ORCHESTRATOR] Response from ${blueprint.provider}:`);
    console.log(blueprint.content);
    console.log(`Latency: ${blueprint.latency}ms`);

    // 2. Maker submits code for verification
    const makerCode = `
    async function processPayment(amount: number) {
      console.log("Processing " + amount + " through global hub...");
      return { success: true, timestamp: Date.now() };
    }
  `;

    console.log("\n[MAKER] Submitting code for verification...");
    const qaResult = await AIOrchestrator.verifySubmission(makerCode);

    console.log(`\n[VERIFIER SWARM] Result: ${qaResult.status} (Score: ${qaResult.score})`);

    if (qaResult.status === 'PASS') {
        console.log("[FINANCIALS] Payout of $1,200 initiated via Airwallex.");
    }
}

demoAIFlow().catch(console.error);
