/**
 * Thin client for the server-side DeepSeek proxy at /api/llm/chatbot/stream.
 * Two shapes: a non-streaming JSON classification call, and a streaming
 * narrative call. The SSE parsing mirrors the existing sales-ai page.
 */
import { rawFetch } from "../period-comparison";

const CHATBOT_STREAM = "/api/llm/chatbot/stream";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Non-streaming classification call. Asks DeepSeek for a single JSON object and
 * returns it parsed (or null if the response wasn't valid JSON). The caller
 * (`parseIntent`) validates the shape, so we stay permissive here.
 */
export async function callJsonCompletion(
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<unknown> {
  const res = await rawFetch(CHATBOT_STREAM, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      stream: false,
      response_format: { type: "json_object" },
    }),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Classifier request failed (${res.status}): ${text.slice(0, 200)}`,
    );
  }
  const body = (await res.json()) as {
    choices?: { message?: { content?: unknown } }[];
  };
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== "string") return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Streaming narrative call. Invokes `onToken` for each content delta and
 * resolves with the full accumulated text. Throws on transport/HTTP errors.
 */
export async function streamNarrative(
  messages: ChatMessage[],
  onToken: (full: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const res = await rawFetch(CHATBOT_STREAM, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, stream: true }),
    signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Narrative request failed (${res.status}): ${text.slice(0, 200)}`,
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let accumulated = "";
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    // Keep the last (possibly partial) line in the buffer.
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]" || payload === "") continue;
      try {
        const json = JSON.parse(payload) as {
          choices?: { delta?: { content?: unknown } }[];
        };
        const delta = json.choices?.[0]?.delta?.content;
        if (typeof delta === "string") {
          accumulated += delta;
          onToken(accumulated);
        }
      } catch {
        // Ignore keep-alive / non-JSON lines.
      }
    }
  }
  return accumulated;
}
