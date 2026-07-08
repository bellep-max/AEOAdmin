/**
 * Chatbot orchestrator. Owns the transcript and drives every turn through the
 * pipeline: intent routing → (clarify | unsupported | fetch) → code-built
 * visuals (via the attached dataset) → streamed narrative → guardrail.
 *
 * Scope (client/business) lives here too; switching it clears the transcript so
 * a conversation never mixes data from two businesses. In-flight LLM calls are
 * aborted on scope-switch/reset/new-send, and every post-await write bails if
 * its run was superseded — so a stream that started under one business can
 * never patch a turn belonging to another.
 */
import { useCallback, useRef, useState } from "react";
import type { ChatScope, ChatTurn, Intent, IntentKind } from "./types";
import { buildRouterMessages, parseIntent } from "./intents";
import { fetchDataset, resolveTimeframe, type DataDeps } from "./data";
import { buildNarrativeMessages } from "./narrative";
import { validateNarrative } from "./guardrail";
import { callJsonCompletion, streamNarrative } from "./llm-client";
import { rawFetch } from "../period-comparison";

/** Intent kinds a clarification "metric" selection may resolve to. */
const ANALYTICAL_KINDS: IntentKind[] = [
  "business_summary",
  "rank_trend",
  "platform_comparison",
  "keyword_list",
  "top_movers",
];

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

const makeDeps = (signal: AbortSignal): DataDeps => ({
  today: todayISO(),
  getJson: async (path: string) => {
    const res = await rawFetch(path, { signal });
    if (!res.ok) {
      throw new Error(`Request failed (${res.status}) for ${path}`);
    }
    return res.json();
  },
});

const SMALLTALK_REPLY =
  "Hi! I can summarize this business's AI-search rankings, show a keyword's trend over time, compare ChatGPT / Gemini / Perplexity, list tracked keywords, or surface the biggest movers. What would you like to see?";

export interface UseChatbot {
  turns: ChatTurn[];
  isBusy: boolean;
  scope: ChatScope | null;
  setScope: (scope: ChatScope | null) => void;
  sendMessage: (text: string) => void;
  resolveClarification: (turnId: string, value: string, label: string) => void;
  reset: () => void;
}

export function useChatbot(): UseChatbot {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [scope, setScopeState] = useState<ChatScope | null>(null);
  const idRef = useRef(0);
  const turnsRef = useRef<ChatTurn[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  // Monotonic ids: NEVER reset, so a stale in-flight write can't collide with a
  // turn minted after a scope-switch/reset.
  const nextId = (): string => `t${++idRef.current}`;

  const commit = (updater: (prev: ChatTurn[]) => ChatTurn[]): void => {
    setTurns((prev) => {
      const next = updater(prev);
      turnsRef.current = next;
      return next;
    });
  };

  const patchTurn = (id: string, patch: Partial<ChatTurn>): void => {
    commit((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  };

  const cancelInFlight = (): void => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsBusy(false);
  };

  const setScope = useCallback((next: ChatScope | null) => {
    cancelInFlight();
    setScopeState(next);
    turnsRef.current = [];
    setTurns([]);
  }, []);

  const reset = useCallback(() => {
    cancelInFlight();
    turnsRef.current = [];
    setTurns([]);
  }, []);

  /** Run one assistant turn for an already-resolved intent. Every write after an
   *  await checks `signal.aborted` and bails if the run was superseded. */
  const runIntent = useCallback(
    async (
      userText: string,
      intent: Intent,
      activeScope: ChatScope,
      assistantId: string,
      signal: AbortSignal,
    ) => {
      if (intent.kind === "unsupported") {
        patchTurn(assistantId, {
          status: "done",
          intent,
          text:
            (intent.unsupportedReason
              ? `I can't answer that — ${intent.unsupportedReason}`
              : "I can't answer that from the data available.") +
            "\n\nI can only report on tracked keyword rankings over time (position, platform, and date). Try asking for a summary, a keyword's trend, a platform comparison, the keyword list, or the biggest movers.",
        });
        return;
      }

      if (intent.kind === "smalltalk") {
        patchTurn(assistantId, {
          status: "done",
          intent,
          text: SMALLTALK_REPLY,
        });
        return;
      }

      if (intent.needsClarification && intent.clarification) {
        patchTurn(assistantId, {
          status: "awaiting-clarification",
          intent,
          clarification: intent.clarification,
          text: intent.clarification.question,
        });
        return;
      }

      const result = await fetchDataset(intent, activeScope, makeDeps(signal));
      if (signal.aborted) return;

      if (result.kind === "clarify") {
        patchTurn(assistantId, {
          status: "awaiting-clarification",
          intent,
          clarification: result.clarification,
          text: result.clarification.question,
        });
        return;
      }

      const dataset = result.dataset;

      if (dataset.isEmpty) {
        patchTurn(assistantId, {
          status: "done",
          intent,
          dataset,
          text: `I don't have any ranking data for ${
            activeScope.businessName ?? activeScope.clientName
          } in this range yet. Once an audit run records rankings, I'll be able to summarize them.`,
        });
        return;
      }

      // Attach the dataset first so visuals render while the narrative streams.
      patchTurn(assistantId, {
        status: "streaming",
        intent,
        dataset,
        text: "",
      });

      const messages = buildNarrativeMessages(dataset, intent, userText);
      const full = await streamNarrative(
        messages,
        (partial) => {
          if (!signal.aborted) patchTurn(assistantId, { text: partial });
        },
        signal,
      );
      if (signal.aborted) return;

      const guardrail = validateNarrative(full, dataset);
      patchTurn(assistantId, {
        status: "done",
        text: full,
        guardrail,
        dataset,
        intent,
      });
    },
    [],
  );

  const runFromText = useCallback(
    async (userText: string, forcedIntent?: Intent) => {
      const activeScope = scope;
      if (!activeScope) return;

      // Supersede any in-flight run.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const signal = controller.signal;

      setIsBusy(true);
      const assistantId = nextId();
      commit((prev) => [
        ...prev,
        { id: assistantId, role: "assistant", text: "", status: "streaming" },
      ]);

      try {
        let intent = forcedIntent;
        if (!intent) {
          const history = turnsRef.current
            .filter(
              (t) =>
                t.status === "done" &&
                (t.role === "user" || t.role === "assistant"),
            )
            .map((t) => ({ role: t.role, text: t.text }));
          const raw = await callJsonCompletion(
            buildRouterMessages(userText, history, activeScope),
            signal,
          );
          if (signal.aborted) return;
          intent = parseIntent(raw);
        }
        await runIntent(userText, intent, activeScope, assistantId, signal);
      } catch (err) {
        if (signal.aborted) return; // aborted mid-flight — leave the turn as-is
        patchTurn(assistantId, {
          status: "error",
          text: "",
          error: err instanceof Error ? err.message : "Something went wrong.",
        });
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setIsBusy(false);
        }
      }
    },
    [scope, runIntent],
  );

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !scope || isBusy) return;
      const userId = nextId();
      commit((prev) => [
        ...prev,
        { id: userId, role: "user", text: trimmed, status: "done" },
      ]);
      void runFromText(trimmed);
    },
    [scope, isBusy, runFromText],
  );

  /** Apply a clarification selection and re-run with resolved params. */
  const resolveClarification = useCallback(
    (turnId: string, value: string, label: string) => {
      if (isBusy || !scope) return;
      const turn = turnsRef.current.find((t) => t.id === turnId);
      const clar = turn?.clarification;
      const baseIntent = turn?.intent;
      if (!turn || !clar) return;

      patchTurn(turnId, { status: "done", clarification: undefined });

      const userId = nextId();
      commit((prev) => [
        ...prev,
        { id: userId, role: "user", text: label, status: "done" },
      ]);

      let resolved: Intent;
      if (clar.kind === "metric") {
        // Validate the selection is a real analytical intent, never trust it raw.
        const kind = (ANALYTICAL_KINDS as string[]).includes(value)
          ? (value as IntentKind)
          : "business_summary";
        resolved = {
          kind,
          params: baseIntent?.params ?? {},
          confidence: 1,
          needsClarification: false,
        };
      } else if (clar.kind === "entity") {
        resolved = {
          kind: "rank_trend",
          params: { ...(baseIntent?.params ?? {}), keyword: value },
          confidence: 1,
          needsClarification: false,
        };
      } else if (clar.kind === "platform") {
        resolved = {
          kind: baseIntent?.kind ?? "platform_comparison",
          params: { ...(baseIntent?.params ?? {}), platform: value as never },
          confidence: 1,
          needsClarification: false,
        };
      } else {
        resolved = {
          kind: baseIntent?.kind ?? "business_summary",
          params: {
            ...(baseIntent?.params ?? {}),
            timeframe: { token: value as never },
          },
          confidence: 1,
          needsClarification: false,
        };
      }
      void runFromText(label, resolved);
    },
    [isBusy, scope, runFromText],
  );

  return {
    turns,
    isBusy,
    scope,
    setScope,
    sendMessage,
    resolveClarification,
    reset,
  };
}

/** Exposed for tests: resolve a timeframe token to bounds. */
export { resolveTimeframe };
