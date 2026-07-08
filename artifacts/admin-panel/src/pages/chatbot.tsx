/**
 * Chatbot page. Pick a business, then hold a multi-turn conversation about its
 * AI-search rankings. Every analytical answer pairs a narrative with visuals
 * built directly from fetched data, guarded against fabricated figures, and
 * asks for clarification instead of guessing when a question is ambiguous.
 */
import { useEffect, useRef, useState } from "react";
import { Send, Bot } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useChatbot } from "@/lib/chatbot/useChatbot";
import { ScopeBar } from "@/components/chatbot/ScopeBar";
import { MessageList } from "@/components/chatbot/MessageList";

const SUGGESTIONS = [
  "Show me a summary for this business",
  "Which keywords improved the most?",
  "Compare ChatGPT, Gemini and Perplexity",
  "How many keywords are we tracking?",
];

export default function Chatbot() {
  const { turns, isBusy, scope, setScope, sendMessage, resolveClarification } =
    useChatbot();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Only follow the stream when the user is already near the bottom, so
    // scrolling up to read earlier turns isn't yanked back down mid-stream.
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [turns]);

  const handleSend = (): void => {
    if (!input.trim() || !scope || isBusy) return;
    sendMessage(input);
    setInput("");
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-3">
      <div className="flex items-center gap-2">
        <Bot className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-semibold">Chatbot</h1>
        <span className="text-sm text-muted-foreground">
          Ask about a business's AI-search rankings
        </span>
      </div>

      <Card>
        <CardContent className="py-3">
          <ScopeBar scope={scope} onChange={setScope} />
        </CardContent>
      </Card>

      <Card className="flex min-h-0 flex-1 flex-col">
        <CardContent className="flex min-h-0 flex-1 flex-col gap-3 py-4">
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto pr-1">
            {!scope ? (
              <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
                Select a business above to start the conversation.
              </div>
            ) : turns.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                <p className="text-sm text-muted-foreground">
                  Ask me anything about {scope.businessName ?? scope.clientName}
                  's rankings. Try one of these:
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => sendMessage(s)}
                      className="rounded-full border border-border bg-background px-3 py-1.5 text-sm hover:bg-accent"
                      data-testid="suggestion"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <MessageList
                turns={turns}
                isBusy={isBusy}
                onClarify={resolveClarification}
              />
            )}
          </div>

          <div className="flex items-end gap-2 border-t border-border/50 pt-3">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={
                scope ? "Ask a question…" : "Select a business first…"
              }
              disabled={!scope || isBusy}
              rows={1}
              className="max-h-32 min-h-[44px] resize-none"
              data-testid="chat-input"
            />
            <Button
              onClick={handleSend}
              disabled={!scope || isBusy || !input.trim()}
              size="icon"
              className="h-11 w-11 shrink-0"
              data-testid="chat-send"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
