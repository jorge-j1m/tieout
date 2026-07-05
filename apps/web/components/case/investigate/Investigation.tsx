"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useCallback, useMemo, useState } from "react";
import type { BreakType, InvestigationMessage } from "@tieout/contracts";
import { deleteInvestigationTurn, fetchInvestigationThread } from "@/app/investigate-actions";
import {
  suggestedPrompts,
  textOf,
  toUiMessages,
  type InvestigationUIMessage,
} from "@/lib/investigate/present";
import { Composer } from "./Composer";
import { Turn } from "./Turn";
import { TurnControls } from "./TurnControls";

/**
 * The live conversation (D38). `useChat` streams tokens and the tool trace; the
 * server persists append-only behind it. After every exchange we reconcile from
 * the saved thread — that swaps optimistic ids for real ones (so delete/edit act
 * on the right rows), folds in any turn another operator added, and replaces the
 * streamed answer with the persisted one (verified citations included). Edit and
 * retry re-enter the same streaming route with a different intent.
 */
export interface InvestigationProps {
  exceptionId: string;
  breakId?: string;
  breakType: BreakType;
  initial: InvestigationMessage[];
  /** Seeded verified ids (case, break, its transactions) — linkable before any tool runs. */
  seededIds: string[];
  operatorName: string;
  assistantName: string;
  canInvestigate: boolean;
  /** Non-null when the composer is inert (demo, feature off, over budget). */
  disabledNote: string | null;
}

export function Investigation({
  exceptionId,
  breakId,
  breakType,
  initial,
  seededIds,
  operatorName,
  assistantName,
  canInvestigate,
  disabledNote,
}: InvestigationProps) {
  const initialMessages = useMemo(() => toUiMessages(initial), [initial]);
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `/api/investigate/${exceptionId}`,
        prepareSendMessagesRequest: ({ body, trigger }) => ({
          body: trigger === "regenerate-message" ? { intent: "retry" } : (body ?? {}),
        }),
      }),
    [exceptionId],
  );

  const reconcile = useCallback(
    async (setMessages: (m: InvestigationUIMessage[]) => void) => {
      const fresh = await fetchInvestigationThread(exceptionId);
      setMessages(toUiMessages(fresh));
    },
    [exceptionId],
  );

  const { messages, sendMessage, regenerate, setMessages, status, stop, error } =
    useChat<InvestigationUIMessage>({
      messages: initialMessages,
      transport,
      onFinish: () => void reconcile(setMessages),
    });

  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const streaming = status === "streaming" || status === "submitted";
  const lastIndex = messages.length - 1;

  const send = (text: string) => {
    setDraft("");
    if (editing) {
      setEditing(false);
      // Drop the trailing question (and its answer) locally; the server supersedes them.
      setMessages(
        (() => {
          const next = [...messages];
          if (next.at(-1)?.role === "assistant") next.pop();
          if (next.at(-1)?.role === "user") next.pop();
          return next;
        })(),
      );
      void sendMessage({ text }, { body: { intent: "edit", text } });
    } else {
      void sendMessage({ text }, { body: { intent: "ask", text } });
    }
  };

  const startEdit = () => {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    setDraft(lastUser ? textOf(lastUser) : "");
    setEditing(true);
  };

  const remove = async (id: string) => {
    await deleteInvestigationTurn({ messageId: id, exceptionId });
    await reconcile(setMessages);
  };

  return (
    <div>
      {messages.length === 0 ? (
        <p className="max-w-prose text-[13.5px] italic leading-relaxed text-muted">
          No one has investigated this case yet. Ask Clara to trace it through the record — she cites
          what she reads, and the thread is shared with every operator on the case.
        </p>
      ) : (
        <ol className="list-none space-y-6">
          {messages.map((m, i) => {
            const settledLast = i === lastIndex && !streaming;
            return (
              <li key={m.id} className="group">
                <Turn
                  message={m}
                  streaming={streaming && i === lastIndex && m.role === "assistant"}
                  operatorName={operatorName}
                  assistantName={assistantName}
                  breakId={breakId}
                  seededIds={seededIds}
                  controls={
                    settledLast && canInvestigate ? (
                      <TurnControls
                        onRetry={m.role === "assistant" ? () => void regenerate() : undefined}
                        onEdit={startEdit}
                        onDelete={() => void remove(m.id)}
                        busy={streaming}
                      />
                    ) : undefined
                  }
                />
              </li>
            );
          })}
        </ol>
      )}

      {error !== undefined && (
        <p role="alert" className="mt-4 text-[13px] text-break">
          Clara couldn’t finish that one — the record is unchanged. Try again.
        </p>
      )}

      <Composer
        value={draft}
        onChange={setDraft}
        onSubmit={send}
        onStop={stop}
        streaming={streaming}
        canSend={canInvestigate}
        editing={editing}
        note={disabledNote}
        suggestions={messages.length === 0 ? suggestedPrompts(breakType) : []}
      />
    </div>
  );
}
