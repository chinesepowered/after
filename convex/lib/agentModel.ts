"use node";

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

/**
 * AI-SDK model for the Convex Agent component ("Ask After"). Same env vars as
 * lib/llm.ts, so swapping the provider swaps both. LLM_EXTRA_BODY is injected
 * through a fetch wrapper because the AI SDK has no passthrough for
 * provider-specific fields.
 */
export function agentModel() {
  const baseURL = process.env.LLM_BASE_URL;
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL;
  if (!baseURL || !apiKey || !model) {
    throw new Error("LLM_BASE_URL / LLM_API_KEY / LLM_MODEL not set on this deployment");
  }
  let extra: Record<string, unknown> = {};
  if (process.env.LLM_EXTRA_BODY) {
    try {
      extra = JSON.parse(process.env.LLM_EXTRA_BODY);
    } catch {
      extra = {};
    }
  }
  const fetchWithExtra: typeof fetch = async (url, init) => {
    if (init?.body && typeof init.body === "string" && Object.keys(extra).length) {
      try {
        init = { ...init, body: JSON.stringify({ ...JSON.parse(init.body), ...extra }) };
      } catch {
        /* leave the body alone */
      }
    }
    return fetch(url, init);
  };
  return createOpenAICompatible({ name: "llm", baseURL, apiKey, fetch: fetchWithExtra }).chatModel(model);
}
