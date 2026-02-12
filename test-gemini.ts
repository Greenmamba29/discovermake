import { google } from '@ai-sdk/google';
import { generateText } from 'ai';

async function test() {
  try {
    console.log("Testing Gemini API Key...");
    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
      console.error("Missing GOOGLE_GENERATIVE_AI_API_KEY");
      return;
    }
    const { text } = await generateText({
      model: google('gemini-1.5-flash'),
      prompt: 'Say hello',
    });
    console.log("Success:", text);
  } catch (e) {
    console.error("Failed:", e);
  }
}

test();
