# Google Integration Skills & Support Docs

This document serves as the primary source of truth for integrating Google services into DiscoverMake. Future agents should consult this file when debugging or expanding Google-related features.

## 1. Google Gemini API (via Vercel AI SDK)

### **Key Learnings & Pitfalls**
*   **Model Names**: The Google provider for Vercel AI SDK expects standardized model names.
    *   **CORRECT**: `google('gemini-1.5-flash')`, `google('gemini-1.5-pro')`
    *   **INCORRECT**: `models/gemini-1.5-flash-latest` (legacy/raw API format)
*   **Imports**: As of Vercel AI SDK 3.0+ / `ai` package 6.0+:
    *   **Server Side**: `import { google } from '@ai-sdk/google';`
    *   **Client Side Hooks**: `import { useChat } from '@ai-sdk/react';` (NOT `ai/react`)
*   **Streaming**: Always use `streamText` for Vercel AI SDK route handlers.

### **Relevant Documentation Strings**
*   **Vercel AI Google Provider**: `https://sdk.vercel.ai/providers/ai-sdk-providers/google-generative-ai`
*   **SDK Core**: `https://sdk.vercel.ai/docs`

### **Configuration**
*   **Environment Variable**: `GOOGLE_GENERATIVE_AI_API_KEY`
    *   Get Key: [Google AI Studio](https://aistudio.google.com/app/apikey)

## 2. Google Vertex AI

### **Usage Context**
Use Vertex AI when:
*   Standard Gemini API limits are hit.
*   Enterprise data governance or strict IAM/VPC controls are needed.
*   Integrating with other GCP services (BigQuery, etc.).

### **Setup (Future)**
1.  Enable Vertex AI API in Google Cloud Console.
2.  Use `@google-cloud/vertexai` SDK if raw access is needed, or configure Vercel SDK with Vertex parameters.

## 3. Google Labs ("Opal" / Gems)

### **Context**
"Gemini Opal" refers to the no-code experimental standard in Google Labs. We cannot integrate this directly.
**Implementation Strategy**: We replicate Opal's behavior using **Gemini 1.5 Flash** + **System Prompts** that output JSON blueprints.

## 4. Troubleshooting Guide

### **Error: 500 Internal Server Error on Chat**
*   **Check Model Name**: Verify `gemini-1.5-flash` is used.
*   **Check Key**: Verify `GOOGLE_GENERATIVE_AI_API_KEY` is loaded.
*   **Check Provider**: Ensure `@ai-sdk/google` is installed.

### **Error: `useChat` is not exported from `ai/react`**
*   **Fix**: Switch import to `import { useChat } from '@ai-sdk/react';`
*   **Cause**: `ai` package version > 3.2 splits React hooks into separate package.
