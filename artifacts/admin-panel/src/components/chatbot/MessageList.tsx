/**
 * Renders the chat transcript: user bubbles, and assistant turns with their
 * narrative (markdown), code-built visuals, any guardrail warning, and any
 * clarification selector.
 */
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AlertTriangle } from "lucide-react";
import type { ChatTurn, GuardrailResult } from "@/lib/chatbot/types";
import { ChatVisuals } from "./ChatVisuals";
import { ClarifyPanel } from "./ClarifyPanel";

function GuardrailBadge({ guardrail }: { guardrail: GuardrailResult }) {
  if (guardrail.ok) {
    if (guardrail.checkedCount === 0) return null;
    return (
      <p
        className="mt-2 text-[11px] text-emerald-600 dark:text-emerald-400"
        data-testid="guardrail-ok"
      >
        ✓ All {guardrail.checkedCount} numbers and dates trace to the source
        data.
      </p>
    );
  }
  return (
    <div
      className="mt-2 flex items-start gap-2 rounded-md border border-amber-400/50 bg-amber-50/60 p-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
      data-testid="guardrail-warning"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        Some figures in this reply could not be traced to the fetched data and
        may be unreliable:{" "}
        <strong>{guardrail.violations.map((v) => v.value).join(", ")}</strong>.
        Trust the charts and cards above — they are built directly from the
        data.
      </span>
    </div>
  );
}

function AssistantTurn({
  turn,
  isBusy,
  onClarify,
}: {
  turn: ChatTurn;
  isBusy: boolean;
  onClarify: (turnId: string, value: string, label: string) => void;
}) {
  return (
    <div className="max-w-full rounded-2xl rounded-tl-sm bg-muted/60 px-4 py-3">
      {turn.status === "error" ? (
        <p className="text-sm text-destructive">
          {turn.error ?? "Something went wrong."}
        </p>
      ) : (
        <>
          {turn.text ? (
            <div className="prose prose-sm max-w-none dark:prose-invert">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {turn.text}
              </ReactMarkdown>
            </div>
          ) : turn.status === "streaming" ? (
            <p className="text-sm text-muted-foreground" data-testid="thinking">
              Thinking…
            </p>
          ) : null}

          {turn.dataset ? <ChatVisuals dataset={turn.dataset} /> : null}
          {turn.guardrail ? (
            <GuardrailBadge guardrail={turn.guardrail} />
          ) : null}
          {turn.clarification && turn.status === "awaiting-clarification" ? (
            <ClarifyPanel
              clarification={turn.clarification}
              disabled={isBusy}
              onSelect={(value, label) => onClarify(turn.id, value, label)}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

export function MessageList({
  turns,
  isBusy,
  onClarify,
}: {
  turns: ChatTurn[];
  isBusy: boolean;
  onClarify: (turnId: string, value: string, label: string) => void;
}) {
  return (
    <div className="space-y-4" data-testid="message-list">
      {turns.map((turn) =>
        turn.role === "user" ? (
          <div key={turn.id} className="flex justify-end">
            <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-primary px-4 py-2 text-sm text-primary-foreground">
              {turn.text}
            </div>
          </div>
        ) : (
          <div key={turn.id} className="flex justify-start">
            <div className="w-full max-w-[95%]">
              <AssistantTurn
                turn={turn}
                isBusy={isBusy}
                onClarify={onClarify}
              />
            </div>
          </div>
        ),
      )}
    </div>
  );
}
