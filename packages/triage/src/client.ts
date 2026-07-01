import type { TriageClient } from "./triage.js";

/**
 * A real client over any OpenAI-compatible `/chat/completions` endpoint —
 * OpenAI, Anthropic's compat endpoint (the default), Ollama, vLLM, OpenRouter.
 * Plain fetch, no provider SDK: the whole surface triage needs is one POST.
 * Reads TIEOUT_TRIAGE_BASE_URL / TIEOUT_TRIAGE_API_KEY from the environment —
 * the key never appears in code or task payloads.
 */

export const DEFAULT_TRIAGE_BASE_URL = "https://api.anthropic.com/v1";

interface ChatCompletionResponse {
  choices?: { message?: { content?: string | null }; finish_reason?: string | null }[];
}

export function createTriageClient(config?: { baseUrl?: string; apiKey?: string }): TriageClient {
  const baseUrl = (
    config?.baseUrl ??
    process.env.TIEOUT_TRIAGE_BASE_URL ??
    DEFAULT_TRIAGE_BASE_URL
  ).replace(/\/+$/, "");
  const apiKey = config?.apiKey ?? process.env.TIEOUT_TRIAGE_API_KEY ?? "";
  return {
    async complete({ model, system, user, maxTokens }) {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });
      if (!response.ok) {
        const detail = (await response.text().catch(() => "")).slice(0, 300);
        throw new Error(`chat completion failed: HTTP ${response.status} ${detail}`);
      }
      const body = (await response.json()) as ChatCompletionResponse;
      const choice = body.choices?.[0];
      return {
        content: choice?.message?.content ?? null,
        finishReason: choice?.finish_reason ?? null,
      };
    },
  };
}
