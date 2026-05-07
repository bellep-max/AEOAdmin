/**
 * Thin wrapper around the DeepSeek chat completions API.
 *
 * Two model hints are exposed:
 *   - "deepseek-chat"      → V3, fast + cheap, used by variant-generator
 *   - "deepseek-reasoner"  → R1 with chain-of-thought, used by analyst
 *
 * Returns the assistant's textual content plus token usage so we can
 * record cost in the daily_reports row.
 */
import { logger } from "../lib/logger";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

// Pricing (per 1M tokens). Used to estimate report cost; tweak if prices change.
const PRICING = {
  "deepseek-chat":     { input: 0.27, output: 1.10 },
  "deepseek-reasoner": { input: 0.55, output: 2.19 },
} as const;

export type DeepSeekModel = keyof typeof PRICING;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionResult {
  content: string;
  model: DeepSeekModel;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface ChatCompletionOptions {
  model: DeepSeekModel;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export async function chatCompletion(opts: ChatCompletionOptions): Promise<ChatCompletionResult> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not configured");

  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
  };
  if (opts.temperature != null) body.temperature = opts.temperature;
  if (opts.maxTokens   != null) body.max_tokens  = opts.maxTokens;

  const res = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization:  `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    logger.error({ status: res.status, body: text.slice(0, 500) }, "DeepSeek call failed");
    throw new Error(`DeepSeek API error ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  const content = data.choices?.[0]?.message?.content ?? "";
  if (!content) throw new Error("DeepSeek returned empty content");

  const promptTokens     = data.usage?.prompt_tokens     ?? 0;
  const completionTokens = data.usage?.completion_tokens ?? 0;
  const totalTokens      = data.usage?.total_tokens      ?? promptTokens + completionTokens;
  const price = PRICING[opts.model];
  const costUsd =
    (promptTokens / 1_000_000) * price.input +
    (completionTokens / 1_000_000) * price.output;

  return { content, model: opts.model, promptTokens, completionTokens, totalTokens, costUsd };
}
