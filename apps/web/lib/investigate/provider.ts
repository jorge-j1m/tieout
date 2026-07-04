import "server-only";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

/**
 * The LLM model for live investigation (D38). Provider-agnostic by design — any
 * OpenAI-compatible `/chat/completions` endpoint works (Anthropic's compat
 * endpoint is the default), preserving D33's promise. The key lives here in the
 * web container's server environment and never reaches the browser or the api.
 */

const DEFAULT_BASE_URL = "https://api.anthropic.com/v1";
const DEFAULT_MODEL = "claude-sonnet-5";

export interface InvestigateConfig {
  enabled: boolean;
  model: string;
  assistantName: string;
  dailyCap: number;
}

export function readInvestigateConfig(): InvestigateConfig {
  const dailyCap = Number(process.env.TIEOUT_INVESTIGATE_DAILY_CAP);
  return {
    enabled: process.env.TIEOUT_INVESTIGATE_ENABLED === "true",
    model: process.env.TIEOUT_INVESTIGATE_MODEL?.trim() || DEFAULT_MODEL,
    assistantName: process.env.TIEOUT_INVESTIGATE_ASSISTANT_NAME?.trim() || "Clara",
    dailyCap: Number.isFinite(dailyCap) && dailyCap > 0 ? Math.floor(dailyCap) : 10,
  };
}

/** A chat model over the configured compat endpoint, ready to hand to `streamText`. */
export function createInvestigationModel(model: string) {
  const provider = createOpenAICompatible({
    name: "tieout-investigate",
    baseURL: (process.env.TIEOUT_TRIAGE_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, ""),
    apiKey: process.env.TIEOUT_TRIAGE_API_KEY ?? "",
  });
  return provider(model);
}
