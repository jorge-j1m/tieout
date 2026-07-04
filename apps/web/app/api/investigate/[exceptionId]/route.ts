import { stepCountIs, streamText } from "ai";
import { z } from "zod";
import { INVESTIGATION_PROMPT_VERSION } from "@tieout/contracts";
import {
  appendInvestigationMessage,
  getException,
  getInvestigation,
  getInvestigationBudget,
  getMe,
  getRaw,
  getRun,
  getRunDiff,
  getSources,
  getTransaction,
} from "@/lib/api/endpoints";
import { authorizeInvestigation, planTurn, turnRequestSchema } from "@/lib/investigate/plan";
import { buildSystemPrompt, seedVerified } from "@/lib/investigate/prompt";
import { createInvestigationModel, readInvestigateConfig } from "@/lib/investigate/provider";
import { createInvestigationTools, type ToolContext } from "@/lib/investigate/tools";
import { getSessionToken } from "@/lib/session";

/**
 * The live investigation loop (D38). Runs in web because this is where the AI SDK
 * belongs, where `useChat` connects same-origin, and the only place the LLM key
 * lives. D34 holds: tools and persistence go through the api. The browser never
 * calls an api write endpoint — Clara's turn (citations included) is produced and
 * saved server-side, so citations can't be forged.
 */

export const maxDuration = 60;

const uuid = z.uuid();
const fail = (error: string, status: number) => Response.json({ error }, { status });

export async function POST(
  req: Request,
  ctx: { params: Promise<{ exceptionId: string }> },
): Promise<Response> {
  const { exceptionId } = await ctx.params;
  if (!uuid.safeParse(exceptionId).success) return fail("not found", 404);

  const config = readInvestigateConfig();
  const token = await getSessionToken();
  const me = token !== undefined ? await getMe(token).catch(() => null) : null;
  const budget = await getInvestigationBudget().catch(() => null);

  // The web config holds the key, so it is authoritative for whether we may stream.
  const auth = authorizeInvestigation({
    operator: me?.operator ?? null,
    investigate: config.enabled,
    remaining: budget?.remaining ?? 0,
  });
  if (!auth.ok) return fail(auth.error, auth.status);

  const parsed = turnRequestSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail("invalid request", 400);

  const exception = await getException(exceptionId);
  if (exception === null) return fail("not found", 404);
  const thread = await getInvestigation(exceptionId);

  const planned = planTurn(parsed.data, thread?.messages ?? []);
  if (!planned.ok) return fail(planned.error, 400);
  const { plan } = planned;

  // Persist the operator's turn before streaming (a retry re-asks; no new turn).
  if (plan.userTurn !== null) {
    const saved = await appendInvestigationMessage(
      exceptionId,
      {
        role: "user",
        text: plan.userTurn.text,
        supersedesId: plan.userTurn.supersedesId ?? undefined,
        eventKind: plan.userTurn.eventKind,
      },
      token!,
    );
    if (!saved.ok) return fail(saved.error, saved.status);
  }

  const context: ToolContext = { verified: seedVerified(exception), toolTrail: [] };
  const tools = createInvestigationTools(
    { getTransaction, getRaw, getRun, getRunDiff, getSources },
    context,
  );

  const result = streamText({
    model: createInvestigationModel(config.model),
    system: buildSystemPrompt({ assistantName: config.assistantName, exception }),
    messages: plan.contextMessages,
    tools,
    stopWhen: stepCountIs(8),
    onFinish: async ({ text, usage }) => {
      try {
        await appendInvestigationMessage(
          exceptionId,
          {
            role: "assistant",
            text: text.length > 0 ? text : "(no answer)",
            parts: [{ type: "text", text }],
            citations: [...context.verified.values()],
            toolTrail: context.toolTrail,
            model: config.model,
            promptVersion: INVESTIGATION_PROMPT_VERSION,
            usage: usage as unknown as Record<string, unknown>,
            supersedesId: plan.assistant.supersedesId ?? undefined,
            eventKind: plan.assistant.eventKind,
          },
          token!,
        );
      } catch (error) {
        console.error("investigation: failed to persist Clara's turn", error);
      }
    },
  });

  return result.toUIMessageStreamResponse();
}
