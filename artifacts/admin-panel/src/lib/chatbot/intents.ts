/**
 * Intent routing: turns a free-text question into a structured `Intent` the
 * pipeline can act on. The LLM is used ONLY as a classifier here (JSON out) —
 * it never produces numbers. `parseIntent` is pure and fully unit-tested.
 */
import type {
  ChatScope,
  Clarification,
  Intent,
  IntentKind,
  Platform,
  TimeframeSpec,
  TimeframeToken,
} from "./types";
import { PLATFORMS, scopeFocus } from "./types";

/** Intents backed by real endpoints, described for the classifier. */
export const INTENT_CATALOG: {
  kind: IntentKind;
  description: string;
}[] = [
  {
    kind: "business_summary",
    description:
      "An overall summary / overview / 'how are we doing' for the selected business — headline KPIs and trend.",
  },
  {
    kind: "rank_trend",
    description:
      "How a specific keyword's ranking has changed over time. Needs a keyword; a platform and timeframe are optional.",
  },
  {
    kind: "platform_comparison",
    description:
      "Compare performance across the AI platforms (ChatGPT vs Gemini vs Perplexity).",
  },
  {
    kind: "keyword_list",
    description:
      "List / how many keywords are tracked for the business, optionally by status.",
  },
  {
    kind: "top_movers",
    description:
      "Which keywords improved or declined the most (biggest rank changes) since tracking began or over a timeframe.",
  },
  {
    kind: "smalltalk",
    description:
      "Greetings, thanks, or meta questions about what you can do. Not an analytical query.",
  },
];

/**
 * Things the data CANNOT answer (confirmed absent in the schema). The
 * classifier must return kind:"unsupported" with a reason for any of these,
 * rather than guess. Kept explicit so the guardrail story is honest.
 */
export const DATA_LIMITATIONS: string[] = [
  "Clicks, traffic, conversions, or how many people clicked a link — there is NO click/conversion tracking.",
  "Revenue, ROI, cost per rank, or budget spent vs results — no financial outcome data exists.",
  "Real-time or live rankings — data only exists after an audit run completes; there is no live feed.",
  "Rankings on a specific past date before tracking started, or for gaps where runs failed — history is sparse, not continuous.",
  "Geographic breakdown of who saw the result — only the proxy's spoofed location exists, not per-result geography.",
  "Which AI model version produced a ranking — model version is not recorded on ranking rows.",
  "Competitor rankings or anyone else's data — only the selected client's own tracked keywords exist.",
];

const VALID_KINDS: IntentKind[] = [
  "business_summary",
  "rank_trend",
  "platform_comparison",
  "keyword_list",
  "top_movers",
  "unsupported",
  "smalltalk",
];

const VALID_TIMEFRAMES: TimeframeToken[] = [
  "all",
  "last_7d",
  "last_14d",
  "last_30d",
  "last_90d",
  "this_month",
  "last_month",
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function asPlatform(value: unknown): Platform | null {
  return typeof value === "string" &&
    (PLATFORMS as readonly string[]).includes(value.toLowerCase())
    ? (value.toLowerCase() as Platform)
    : null;
}

function asTimeframe(value: unknown): TimeframeSpec | undefined {
  if (!value || typeof value !== "object") return undefined;
  const token = (value as { token?: unknown }).token;
  if (token === "custom") {
    const from = (value as { from?: unknown }).from;
    const to = (value as { to?: unknown }).to;
    if (
      typeof from === "string" &&
      ISO_DATE.test(from) &&
      typeof to === "string" &&
      ISO_DATE.test(to)
    ) {
      return { token: "custom", from, to };
    }
    return undefined;
  }
  if (
    typeof token === "string" &&
    (VALID_TIMEFRAMES as string[]).includes(token)
  ) {
    return { token: token as TimeframeToken };
  }
  return undefined;
}

/**
 * Validate + normalize the classifier's raw JSON into a safe `Intent`. Never
 * throws — anything malformed collapses to a low-confidence clarification so
 * the pipeline degrades to asking rather than guessing.
 */
export function parseIntent(raw: unknown): Intent {
  const fallback: Intent = {
    kind: "smalltalk",
    params: {},
    confidence: 0,
    needsClarification: true,
    clarification: {
      kind: "metric",
      question:
        "I couldn't tell what you're asking. What would you like to see for this business?",
      options: [
        { value: "business_summary", label: "Overall summary" },
        { value: "rank_trend", label: "A keyword's trend" },
        { value: "platform_comparison", label: "Compare platforms" },
        { value: "keyword_list", label: "List keywords" },
        { value: "top_movers", label: "Biggest movers" },
      ],
    },
  };

  if (!raw || typeof raw !== "object") return fallback;
  const obj = raw as Record<string, unknown>;

  const kind = VALID_KINDS.includes(obj.kind as IntentKind)
    ? (obj.kind as IntentKind)
    : null;
  if (!kind) return fallback;

  const confidenceRaw = typeof obj.confidence === "number" ? obj.confidence : 0;
  const confidence = Math.max(0, Math.min(1, confidenceRaw));

  const paramsObj = (
    obj.params && typeof obj.params === "object" ? obj.params : {}
  ) as Record<string, unknown>;
  const keyword =
    typeof paramsObj.keyword === "string" && paramsObj.keyword.trim()
      ? paramsObj.keyword.trim()
      : null;

  const intent: Intent = {
    kind,
    params: {
      timeframe: asTimeframe(paramsObj.timeframe),
      platform: asPlatform(paramsObj.platform),
      keyword,
    },
    confidence,
    needsClarification: obj.needsClarification === true,
    echo: typeof obj.echo === "string" ? obj.echo.slice(0, 300) : undefined,
    unsupportedReason:
      kind === "unsupported" && typeof obj.unsupportedReason === "string"
        ? obj.unsupportedReason.slice(0, 400)
        : undefined,
  };

  // rank_trend with no keyword can't proceed — force an entity clarification.
  if (kind === "rank_trend" && !keyword) {
    intent.needsClarification = true;
    intent.clarification = {
      kind: "entity",
      question: "Which keyword's trend would you like to see?",
    };
    return intent;
  }

  // Low confidence → clarify rather than guess (unless the model already
  // supplied a specific clarification).
  const rawClar = obj.clarification;
  if (
    rawClar &&
    typeof rawClar === "object" &&
    typeof (rawClar as { question?: unknown }).question === "string"
  ) {
    const c = rawClar as Record<string, unknown>;
    const optRaw = Array.isArray(c.options) ? c.options : [];
    intent.clarification = {
      kind: (["timeframe", "metric", "entity", "platform"].includes(
        c.kind as string,
      )
        ? c.kind
        : "metric") as Clarification["kind"],
      question: (c.question as string).slice(0, 300),
      options: optRaw
        .filter(
          (o): o is { value: string; label: string } =>
            !!o &&
            typeof (o as { value?: unknown }).value === "string" &&
            typeof (o as { label?: unknown }).label === "string",
        )
        .slice(0, 8),
    };
    intent.needsClarification = true;
  } else if (
    confidence < 0.5 &&
    kind !== "unsupported" &&
    kind !== "smalltalk"
  ) {
    intent.needsClarification = true;
    intent.clarification = {
      kind: "metric",
      question: `I want to make sure I answer the right thing${intent.echo ? ` (I read: "${intent.echo}")` : ""}. Which of these?`,
      options: [
        { value: "business_summary", label: "Overall summary" },
        { value: "rank_trend", label: "A keyword's trend" },
        { value: "platform_comparison", label: "Compare platforms" },
        { value: "keyword_list", label: "List keywords" },
        { value: "top_movers", label: "Biggest movers" },
      ],
    };
  }

  return intent;
}

/** System prompt for the classifier. Instructs JSON-only output and honesty. */
export function buildRouterSystemPrompt(scope: ChatScope): string {
  const focus = scopeFocus(scope);
  return [
    "You are the intent classifier for an SEO ranking analytics chatbot.",
    `The user is asking about this ${focus.level}: ${focus.name}.`,
    "The product tracks keyword rankings on ChatGPT, Gemini, and Perplexity over time.",
    "",
    "Classify the user's message into ONE intent. Return STRICT JSON only, no prose. Shape:",
    "{",
    '  "kind": one of ' + VALID_KINDS.map((k) => `"${k}"`).join(", ") + ",",
    '  "params": { "keyword"?: string, "platform"?: "chatgpt"|"gemini"|"perplexity", "timeframe"?: { "token": "all"|"last_7d"|"last_14d"|"last_30d"|"last_90d"|"this_month"|"last_month" } | { "token": "custom", "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" } },',
    '  "confidence": 0..1,',
    '  "needsClarification": boolean,',
    '  "clarification"?: { "kind": "timeframe"|"metric"|"entity"|"platform", "question": string, "options"?: [{"value": string, "label": string}] },',
    '  "unsupportedReason"?: string,',
    '  "echo": a short restatement of what you understood',
    "}",
    "",
    "Rules:",
    '- If the question asks for something the data does NOT contain, set kind="unsupported" and put a one-sentence reason in unsupportedReason. The data does NOT contain:',
    ...DATA_LIMITATIONS.map((l) => `    • ${l}`),
    "- If the metric, keyword, timeframe, or entity is ambiguous, set needsClarification=true and provide a clarification with concrete options. Do NOT guess.",
    "- Never invent numbers, dates, or rankings. You only classify — a separate step fetches real data.",
    "- For rank_trend you MUST identify the keyword; if you can't, ask via clarification (kind=entity).",
    "- Output JSON only.",
  ].join("\n");
}

/** Build the messages array for the classifier call. Includes brief history so
 *  follow-ups like "now compare it to last month" resolve against prior turns. */
export function buildRouterMessages(
  userText: string,
  history: { role: "user" | "assistant"; text: string }[],
  scope: ChatScope,
): { role: "system" | "user" | "assistant"; content: string }[] {
  const recent = history.slice(-6).map((h) => ({
    role: h.role,
    content: h.text.slice(0, 500),
  }));
  return [
    { role: "system", content: buildRouterSystemPrompt(scope) },
    ...recent,
    { role: "user", content: userText },
  ];
}
