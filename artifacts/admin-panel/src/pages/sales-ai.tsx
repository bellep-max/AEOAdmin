import { useState, useRef, useEffect } from "react";
import {
  Send,
  AlertCircle,
  Building2,
  X,
  Plus,
  Trash2,
  Bot,
  User,
  Sparkles,
  RotateCcw,
  ChevronRight,
  Zap,
  ArrowLeft,
  MessageSquarePlus,
  Clock,
  PanelRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
const SALES_AI_STREAM_URL = `${BASE}/api/llm/sales-ai/stream`;

/* ─── Types ──────────────────────────────────────────────────────────────── */

interface Message {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

interface KeywordRow {
  keyword: string;
  chatgpt: boolean;
  perplexity: boolean;
  gemini: boolean;
}

interface IceKeyword {
  keyword: string;
  impact: number;
  confidence: number;
  ease: number;
  ease_adj: number;
  ice: number;
  on_site: boolean;
  priority: "high" | "medium" | "low";
}

interface AuditResults {
  keywords: IceKeyword[];
  ccs: number;
  search_volume: {
    total: number;
    weekly: number;
    competitor_count: number;
    ymyl_penalty: number;
    la_used: number;
    formula: string;
  };
  ars: {
    score: number;
    rating: "Green" | "Amber" | "Red";
    formula: string;
    summary: string;
  };
  example_prompt: {
    text: string;
    pqs: number;
    pc_avg: number;
    rc_avg: number;
    threshold_met: boolean;
  };
  website_analysis: {
    ssl: boolean | null;
    mobile: boolean | null;
    word_count: number;
    title: string;
    description: string;
    h1: string;
    summary: string;
    ssl_note: string;
    mobile_note: string;
    content_note: string;
  };
  local_market: {
    location: string;
    optimization_score: string;
    summary: string;
    recommendations: string[];
  };
  recommendations: Array<{
    priority: "high" | "medium" | "low";
    action: string;
    impact: string;
    effort: string;
    rationale: string;
  }>;
}

type AnalyzerTab = "analyzer" | "audit";

interface Conversation {
  id: string;
  title: string;
  timestamp: number;
  messages: Message[];
}

/* ─── Constants ──────────────────────────────────────────────────────────── */

const BIZ_TYPES = [
  "B2B SaaS",
  "B2C Product",
  "Local Service",
  "E-commerce",
  "Healthcare",
  "Legal / Financial",
  "Agency / Consulting",
  "Restaurant / Hospitality",
  "Other",
];

const BIZ_SIZES = [
  "Small (<50)",
  "Medium (50–500)",
  "Large (500+)",
  "Enterprise (1000+)",
];

const SOURCE_OF_TRUTH_BLOCK = `
SOURCE OF TRUTH — use this whenever a prospect questions the data or asks "how do you know?":

Our analysis comes from running live, real-time queries on ChatGPT, Perplexity, and Google Gemini using the exact questions their customers type — for example, "How much does an emergency plumber cost?" We record what each AI actually answers: whether this business appears, and who appears instead.

The prospect can verify everything themselves in 2 minutes: open any of those AI tools, type the same question, and see the same result. We also check the website's structured data using public testing tools (Google Rich Results Test, Schema.org validator). No guesswork, no black box. Every claim is reproducible.

Tone when using this: calm, factual, not defensive. No jargon.`;

const SYSTEM_PROMPT = `You are Signal AEO Sales AI — an expert AEO (Answer Engine Optimization) sales consultant built for the Signal AEO team. When greeting or introducing yourself, always say: "I'm your Signal AEO Sales AI." Your goal is to help sales reps understand a prospect's visibility gaps on ChatGPT, Perplexity, and Google Gemini — and build a compelling case for why they need AEO services.

You can:
- Analyze a business's current AI visibility when given details (name, location, keywords, website, industry)
- Identify the most painful gaps and translate them into lost revenue or leads
- Explain how Signal AEO closes those gaps across ChatGPT, Perplexity, and Gemini
- Answer follow-up questions about AEO strategy, pricing objections, competitor comparisons, or how to pitch specific industries
- Generate a SALES OVERVIEW — a consultant-style explanation of why this specific business needs AEO, based on audit results. No CTAs, no contact requests, no free trials.
- Handle objections including "how do I know this is real?" — use the source of truth response below

SALES OVERVIEW FORMAT — use this when asked to write a chat script or sales overview from audit data:
1. Business snapshot: one sentence on what the business does and who their customers are
2. The core problem: explain in plain language why this business is currently invisible on ChatGPT, Perplexity, and Gemini — focus on what AI engines see (or don't see) when someone searches for them
3. The gap in numbers: reference the highest-priority keyword ICE score and PQS to show how far they are from being recommended by AI
4. Why this matters NOW: tie the gap to real business impact — leads going to competitors, buyers trusting AI over Google, the shift away from traditional search
5. What AEO fixes: explain how Signal AEO specifically closes these gaps — structure, citability, answer optimization — without revealing internal methods
6. Tone: confident, consultant-style, factual. No contact requests, no free trials, no CTAs. Pure explanation of why they need this. Max 400 words.

Rules:
- Never invent numbers you don't have — say "(estimate available on request)" when revenue data is missing
- Speak like a consultant: confident, specific, no hype
- Always mention at least two of {ChatGPT, Perplexity, Gemini} when discussing visibility
- When you don't have enough info, ask one focused question to get it
- Never add meta-commentary like "Why this works:", "Here's why this is effective:", "This approach works because…", or any self-analysis of your own response. Just give the answer — nothing after it.
${SOURCE_OF_TRUTH_BLOCK}
You are ready to chat. Wait for the user to share a business or ask a question.`;


/* ─── Helpers ────────────────────────────────────────────────────────────── */

function buildAnalyzeMessage(fields: {
  businessName: string;
  location: string;
  website: string;
  industry: string;
  description: string;
  keywords: KeywordRow[];
}): string {
  const kwLines = fields.keywords
    .filter((k) => k.keyword.trim())
    .map((k) => {
      const visible = [
        k.chatgpt ? "ChatGPT" : null,
        k.perplexity ? "Perplexity" : null,
        k.gemini ? "Gemini" : null,
      ]
        .filter(Boolean)
        .join(", ");
      return `  - "${k.keyword}" — visible on: ${visible || "none"}`;
    })
    .join("\n");

  return `Please analyze this business and generate a sales assessment:

Business: ${fields.businessName || "(not provided)"}
Location: ${fields.location || "(not provided)"}
Website: ${fields.website || "(not provided)"}
Industry: ${fields.industry || "(not provided)"}
${fields.description ? `Description: ${fields.description}` : ""}
${kwLines ? `\nKeywords and current AI visibility:\n${kwLines}` : ""}

Give me a full visibility assessment: where they're invisible on ChatGPT, Perplexity, and Gemini, the biggest gap, the real business impact, and how Signal AEO closes it.`;
}

function buildAuditChatMessage(bizName: string, results: AuditResults, location?: string, website?: string): string {
  const topKw = [...results.keywords].sort((a, b) => b.ice - a.ice)[0];
  const kwSummary = results.keywords
    .map((k) => `  - "${k.keyword}" — ICE: ${k.ice.toFixed(2)} (${k.priority.toUpperCase()})${k.on_site ? " ✓ on site" : ""}`)
    .join("\n");
  return `Here are the Full AEO Audit results for **${bizName}**${location ? ` (${location})` : ""}${website ? ` — ${website}` : ""}:

**ARS Score:** ${results.ars.score.toFixed(1)} (${results.ars.rating})
${results.ars.summary}

**Content Coverage Score (CCS):** ${results.ccs.toFixed(1)}%

**Keyword ICE Scores:**
${kwSummary}

**Highest priority keyword:** "${topKw?.keyword}" (ICE ${topKw?.ice.toFixed(2)})

**Example AEO Prompt:** "${results.example_prompt.text}"
PQS: ${results.example_prompt.pqs.toFixed(2)} — Threshold ${results.example_prompt.threshold_met ? "Met" : "Not Met"}

**Required Search Volume:** ${results.search_volume.total} total prompts / ${results.search_volume.weekly} per week

Based on these audit results, help me build a compelling sales pitch. What's the strongest angle and how should I open the conversation?`;
}

function buildChatScriptMessage(bizName: string, results: AuditResults, location?: string, website?: string): string {
  const sorted = [...results.keywords].sort((a, b) => b.ice - a.ice);
  const top = sorted[0];
  const others = sorted.slice(1, 3);
  return `Write a sales overview (max 400 words) for **${bizName}**${location ? ` in ${location}` : ""} explaining why they need AEO services.

Use ONLY the following audit data — do not invent numbers:

- ARS Score: ${results.ars.score.toFixed(1)} (${results.ars.rating})
- Content Coverage Score: ${results.ccs.toFixed(1)}%${website ? `\n- Website: ${website}` : ""}
- Highest priority keyword: "${top?.keyword}" (ICE ${top?.ice.toFixed(2)} — ${top?.priority.toUpperCase()})
${others.map((k) => `- Also important: "${k.keyword}" (ICE ${k.ice.toFixed(2)})`).join("\n")}
- Example AEO prompt: "${results.example_prompt.text}"
- PQS score: ${results.example_prompt.pqs.toFixed(2)} — Threshold ${results.example_prompt.threshold_met ? "Met ✓" : "Not Met ✗"}
- Required weekly prompt volume to compete: ${results.search_volume.weekly}
${results.local_market.summary ? `- Local market note: ${results.local_market.summary}` : ""}

Follow the sales overview format:
1. One-sentence snapshot of what ${bizName} does and who their customers are
2. Plain-language explanation of why they're invisible on ChatGPT, Perplexity, and Gemini right now
3. What the gap means in real terms — leads going to competitors who ARE showing up on AI
4. Why this matters now — buyers are shifting from Google to AI for recommendations
5. How Signal AEO closes these specific gaps for ${bizName}

No contact requests, no free trials, no CTAs, no next-step offers. Pure business case.`;
}

const PRIORITY_STYLES: Record<string, string> = {
  high: "bg-blue-100 text-blue-700 border border-blue-200",
  medium: "bg-muted text-muted-foreground border border-border",
  low: "bg-orange-50 text-orange-600 border border-orange-200",
};

/* ─── Component ──────────────────────────────────────────────────────────── */

export default function SalesAI() {
  /* chat */
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState("");

  /* modal */
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<AnalyzerTab>("analyzer");

  /* business analyzer fields */
  const [bizName, setBizName] = useState("");
  const [location, setLocation] = useState("");
  const [website, setWebsite] = useState("");
  const [industry, setIndustry] = useState("");
  const [description, setDescription] = useState("");
  const [keywords, setKeywords] = useState<KeywordRow[]>([
    { keyword: "", chatgpt: false, perplexity: false, gemini: false },
    { keyword: "", chatgpt: false, perplexity: false, gemini: false },
    { keyword: "", chatgpt: false, perplexity: false, gemini: false },
  ]);

  /* full audit fields */
  const [auditBizName, setAuditBizName] = useState("");
  const [auditDescription, setAuditDescription] = useState("");
  const [auditBizType, setAuditBizType] = useState("B2B SaaS");
  const [auditBizSize, setAuditBizSize] = useState("Small (<50)");
  const [auditCompetitors, setAuditCompetitors] = useState("");
  const [auditWebsite, setAuditWebsite] = useState("");
  const [auditLocation, setAuditLocation] = useState("");
  const [auditResults, setAuditResults] = useState<AuditResults | null>(null);
  const [isAuditRunning, setIsAuditRunning] = useState(false);
  const [auditError, setAuditError] = useState("");

  /* history */
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const currentConvIdRef = useRef<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const auditAbortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const saved = localStorage.getItem("sales_ai_history");
    if (saved) {
      try {
        setConversations(JSON.parse(saved));
      } catch {
        /* ignore */
      }
    }
  }, []);

  useEffect(() => {
    if (messages.length === 0 || isStreaming) return;
    const firstUser =
      messages.find((m) => m.role === "user")?.content ?? "New conversation";
    const title =
      firstUser.length > 60 ? firstUser.slice(0, 60) + "…" : firstUser;
    if (!currentConvIdRef.current)
      currentConvIdRef.current = Date.now().toString();
    const id = currentConvIdRef.current;
    setConversations((prev) => {
      const existing = prev.find((c) => c.id === id);
      const updated: Conversation = {
        id,
        title,
        timestamp: existing?.timestamp ?? Date.now(),
        messages,
      };
      const rest = prev.filter((c) => c.id !== id);
      const next = [updated, ...rest];
      localStorage.setItem("sales_ai_history", JSON.stringify(next));
      return next;
    });
  }, [messages, isStreaming]);

  /* ── Send chat message ── */
  const sendMessage = async (userText: string) => {
    if (!userText.trim()) return;
    if (isStreaming) return;

    const userMsg: Message = { role: "user", content: userText };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput("");
    setError("");

    const assistantMsg: Message = {
      role: "assistant",
      content: "",
      streaming: true,
    };
    setMessages([...updatedMessages, assistantMsg]);

    const controller = new AbortController();
    abortRef.current = controller;
    setIsStreaming(true);

    try {
      const response = await fetch(SALES_AI_STREAM_URL, {
        method: "POST",
        signal: controller.signal,
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            ...updatedMessages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
          ],
          stream: true,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `API Error ${response.status}: ${text || response.statusText}`,
        );
      }
      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          if (line.startsWith("data: ") && line !== "data: [DONE]") {
            try {
              const data = JSON.parse(line.slice(6));
              accumulated += data.choices?.[0]?.delta?.content ?? "";
              setMessages((prev) => {
                const copy = [...prev];
                copy[copy.length - 1] = {
                  role: "assistant",
                  content: accumulated,
                  streaming: true,
                };
                return copy;
              });
            } catch {
              /* ignore */
            }
          }
        }
      }
      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = {
          role: "assistant",
          content: accumulated,
          streaming: false,
        };
        return copy;
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = {
            ...copy[copy.length - 1],
            streaming: false,
          };
          return copy;
        });
      } else {
        setError(
          err instanceof Error
            ? err.message
            : "Something went wrong — please try again.",
        );
        setMessages((prev) => prev.slice(0, -1));
      }
    } finally {
      setIsStreaming(false);
    }
  };

  const stopStreaming = () => abortRef.current?.abort();

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  /* ── Business Analyzer submit ── */
  const submitAnalyzer = () => {
    const msg = buildAnalyzeMessage({
      businessName: bizName,
      location,
      website,
      industry,
      description,
      keywords,
    });
    setIsModalOpen(false);
    sendMessage(msg);
  };

  /* ── Full AEO Audit ── */
  const runFullAudit = async () => {
    if (!auditBizName.trim() && !auditDescription.trim()) {
      setAuditError("Enter at least a business name or description.");
      return;
    }

    setAuditError("");
    setAuditResults(null);
    setIsAuditRunning(true);

    const controller = new AbortController();
    auditAbortRef.current = controller;

    try {
      const response = await fetch(`${BASE}/api/llm/sales-ai/full-audit`, {
        method: "POST",
        signal: controller.signal,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bizName: auditBizName,
          description: auditDescription,
          bizType: auditBizType,
          bizSize: auditBizSize,
          competitors: auditCompetitors,
          website: auditWebsite,
          location: auditLocation,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`API Error ${response.status}: ${text || response.statusText}`);
      }

      const parsed: AuditResults = await response.json();
      setAuditResults(parsed);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      setAuditError(
        err instanceof Error ? err.message : "Audit failed — please try again.",
      );
    } finally {
      setIsAuditRunning(false);
    }
  };

  const sendAuditToChat = () => {
    if (!auditResults) return;
    const msg = buildAuditChatMessage(
      auditBizName || "the business",
      auditResults,
      auditLocation,
      auditWebsite,
    );
    setIsModalOpen(false);
    sendMessage(msg);
  };

  const sendChatScript = () => {
    if (!auditResults) return;
    const msg = buildChatScriptMessage(
      auditBizName || "the business",
      auditResults,
      auditLocation,
      auditWebsite,
    );
    setIsModalOpen(false);
    sendMessage(msg);
  };

  /* ── Keyword rows ── */
  const updateKeyword = (
    i: number,
    field: keyof KeywordRow,
    value: string | boolean,
  ) =>
    setKeywords((prev) =>
      prev.map((k, idx) => (idx === i ? { ...k, [field]: value } : k)),
    );
  const addKeyword = () =>
    setKeywords((prev) => [
      ...prev,
      { keyword: "", chatgpt: false, perplexity: false, gemini: false },
    ]);
  const removeKeyword = (i: number) =>
    setKeywords((prev) => prev.filter((_, idx) => idx !== i));

  const resetChat = () => {
    abortRef.current?.abort();
    setMessages([]);
    setError("");
    setIsStreaming(false);
    currentConvIdRef.current = null;
  };

  const loadConversation = (conv: Conversation) => {
    abortRef.current?.abort();
    setMessages(conv.messages);
    setError("");
    setIsStreaming(false);
    currentConvIdRef.current = conv.id;
    setShowHistory(false);
  };

  const deleteConversation = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDeleteId(id);
  };

  const confirmDelete = () => {
    if (!confirmDeleteId) return;
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== confirmDeleteId);
      localStorage.setItem("sales_ai_history", JSON.stringify(next));
      return next;
    });
    if (currentConvIdRef.current === confirmDeleteId) {
      setMessages([]);
      currentConvIdRef.current = null;
    }
    setConfirmDeleteId(null);
  };

  const copyMessage = (content: string) => {
    navigator.clipboard.writeText(content);
    toast({ title: "Copied to clipboard" });
  };

  const openModal = (tab: AnalyzerTab) => {
    setActiveTab(tab);
    setIsModalOpen(true);
  };

  const isEmpty = messages.length === 0;

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      {/* ── Header ── */}
      <header className="shrink-0 border-b border-border bg-card z-10">
        <div className="container mx-auto max-w-4xl px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded bg-primary flex items-center justify-center text-primary-foreground font-bold text-xs">
              S
            </div>
            <span className="font-bold text-base text-foreground tracking-tight">
              Sales AI
            </span>
            <span className="text-xs text-muted-foreground hidden sm:block">
              AEO Sales Consultant
            </span>
          </div>
          <div className="flex items-center gap-1">
            {!isEmpty && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-xs"
                onClick={resetChat}
              >
                <RotateCcw className="w-3.5 h-3.5" /> New chat
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => openModal("analyzer")}
            >
              <Building2 className="w-3.5 h-3.5" /> Business Analyzer
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => openModal("audit")}
            >
              <Zap className="w-3.5 h-3.5" /> Full AEO Audit
            </Button>
            <Button
              variant={showHistory ? "secondary" : "ghost"}
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => setShowHistory((v) => !v)}
            >
              <PanelRight className="w-3.5 h-3.5" /> History
              {conversations.length > 0 && (
                <span className="ml-0.5 text-[10px] bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 leading-none">
                  {conversations.length}
                </span>
              )}
            </Button>
          </div>
        </div>
      </header>

      {/* ── Error banner ── */}
      {error && (
        <div className="shrink-0 border-b border-destructive/20 bg-destructive/10 px-4 py-2">
          <div className="container mx-auto max-w-4xl flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-destructive shrink-0" />
            <p className="text-sm text-destructive flex-1">{error}</p>
            <button
              onClick={() => setError("")}
              className="text-destructive/60 hover:text-destructive"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ── Main area + History sidebar ── */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* ── Messages ── */}
          <div className="flex-1 overflow-y-auto">
            <div className="container mx-auto max-w-4xl px-4 py-6">
              {isEmpty && (
                <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
                  <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                    <Sparkles className="w-7 h-7 text-primary" />
                  </div>
                  <h2 className="text-2xl font-bold text-foreground mb-2">
                    Sales AI
                  </h2>
                  <p className="text-muted-foreground max-w-md mb-8">
                    Your AEO sales consultant. Analyze any business, run a full
                    ICE audit, and build a pitch — all in one place.
                  </p>

                  {/* Quick actions */}
                  <div className="flex flex-wrap gap-3 mb-8 justify-center">
                    <button
                      onClick={() => openModal("analyzer")}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 border-primary/30 bg-primary/5 hover:border-primary/60 hover:bg-primary/10 transition-all text-sm font-semibold text-primary"
                    >
                      <Building2 className="w-4 h-4" /> Business Analyzer
                    </button>
                    <button
                      onClick={() => openModal("audit")}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 border-amber-300 bg-amber-50 hover:border-amber-400 hover:bg-amber-100 transition-all text-sm font-semibold text-amber-700"
                    >
                      <Zap className="w-4 h-4" /> Full AEO Audit
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-lg">
                    {[
                      {
                        label: "Analyze a business",
                        prompt:
                          "I want to analyze a local plumbing company in Austin, TX. They have a website but I'm not sure if they appear on ChatGPT or Perplexity.",
                      },
                      {
                        label: "Write a cold email",
                        prompt:
                          "Write a cold outreach email for a dentist in Miami who doesn't appear on any AI engines.",
                      },
                      {
                        label: "Source of truth objection",
                        prompt:
                          "A prospect just asked: \"How do I know this is really what's happening to my business? What's your source of truth?\" Give me a response I can say right now.",
                      },
                      {
                        label: "Handle a price objection",
                        prompt:
                          "A prospect says AEO is too expensive. How do I respond?",
                      },
                    ].map((s) => (
                      <button
                        key={s.label}
                        onClick={() => sendMessage(s.prompt)}
                        className="text-left p-3.5 rounded-xl border-2 border-border hover:border-primary/40 hover:bg-primary/5 transition-all text-sm"
                      >
                        <p className="font-semibold text-foreground flex items-center gap-1.5">
                          {s.label}{" "}
                          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                        </p>
                        <p className="text-muted-foreground text-xs mt-0.5 line-clamp-2">
                          {s.prompt}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-6">
                {messages.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
                  >
                    <div
                      className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted border border-border text-muted-foreground"}`}
                    >
                      {msg.role === "user" ? (
                        <User className="w-4 h-4" />
                      ) : (
                        <Bot className="w-4 h-4" />
                      )}
                    </div>
                    <div
                      className={`group max-w-[80%] flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
                    >
                      <div
                        className={`rounded-2xl px-4 py-3 text-sm ${msg.role === "user" ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-muted border border-border rounded-tl-sm"}`}
                      >
                        {msg.role === "user" ? (
                          <p className="whitespace-pre-wrap">{msg.content}</p>
                        ) : (
                          <div className="prose prose-sm prose-slate max-w-none prose-headings:font-bold prose-p:leading-relaxed">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {msg.content || (msg.streaming ? "▍" : "")}
                            </ReactMarkdown>
                          </div>
                        )}
                      </div>
                      {!msg.streaming && msg.content && (
                        <button
                          onClick={() => copyMessage(msg.content)}
                          className="mt-1 text-[10px] text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity px-1"
                        >
                          Copy
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div ref={bottomRef} />
            </div>
          </div>

          {/* ── Input bar ── */}
          <div className="shrink-0 border-t border-border bg-card">
            <div className="container mx-auto max-w-4xl px-4 py-3">
              <div className="flex gap-2 items-end">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask anything — or describe a business to analyze…"
                  rows={1}
                  className="resize-none min-h-[40px] max-h-40 flex-1 text-sm py-2.5"
                  onInput={(e) => {
                    const t = e.currentTarget;
                    t.style.height = "auto";
                    t.style.height = Math.min(t.scrollHeight, 160) + "px";
                  }}
                />
                {isStreaming ? (
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={stopStreaming}
                    className="shrink-0 h-10 w-10"
                  >
                    <span className="w-3 h-3 rounded-sm bg-foreground" />
                  </Button>
                ) : (
                  <Button
                    size="icon"
                    onClick={() => sendMessage(input)}
                    disabled={!input.trim()}
                    className="shrink-0 h-10 w-10"
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                )}
              </div>
              <div className="flex gap-2 mt-2 flex-wrap">
                <button
                  onClick={() =>
                    sendMessage(
                      "A prospect just asked: \"How do I know this is really what's happening to my business? What's your source of truth?\" Give me the exact words I can say right now on the call.",
                    )
                  }
                  disabled={isStreaming}
                  className="text-[11px] px-2.5 py-1 rounded-full border border-border text-muted-foreground hover:border-primary/50 hover:text-primary hover:bg-primary/5 transition-all disabled:opacity-40"
                >
                  Source of truth objection
                </button>
                <button
                  onClick={() =>
                    sendMessage(
                      "A prospect says AEO is too expensive. Give me a sharp, consultative response.",
                    )
                  }
                  disabled={isStreaming}
                  className="text-[11px] px-2.5 py-1 rounded-full border border-border text-muted-foreground hover:border-primary/50 hover:text-primary hover:bg-primary/5 transition-all disabled:opacity-40"
                >
                  Price objection
                </button>
                <button
                  onClick={() =>
                    sendMessage(
                      "The prospect says they already have SEO. How do I explain why AEO is different and why they still need it?",
                    )
                  }
                  disabled={isStreaming}
                  className="text-[11px] px-2.5 py-1 rounded-full border border-border text-muted-foreground hover:border-primary/50 hover:text-primary hover:bg-primary/5 transition-all disabled:opacity-40"
                >
                  "We have SEO already"
                </button>
                <button
                  onClick={() =>
                    sendMessage(
                      "Write a chat script for a live DM conversation with a local business owner. Ask me for their audit data first.",
                    )
                  }
                  disabled={isStreaming}
                  className="text-[11px] px-2.5 py-1 rounded-full border border-border text-muted-foreground hover:border-primary/50 hover:text-primary hover:bg-primary/5 transition-all disabled:opacity-40"
                >
                  Write chat script
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
                Enter to send · Shift+Enter for new line
              </p>
            </div>
          </div>
        </div>
        {/* end chat column */}

        {/* ── History sidebar ── */}
        {showHistory && (
          <div className="w-72 shrink-0 border-l border-border bg-card flex flex-col overflow-hidden">
            <div className="shrink-0 px-4 py-3 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-primary" />
                <span className="font-semibold text-sm text-foreground">
                  Chat History
                </span>
              </div>
              {conversations.length > 0 && (
                <button
                  onClick={() => setConfirmClearAll(true)}
                  className="text-[11px] text-muted-foreground hover:text-destructive transition-colors"
                >
                  Clear all
                </button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto">
              {conversations.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-center px-4">
                  <Clock className="w-8 h-8 text-muted-foreground/40 mb-2" />
                  <p className="text-xs text-muted-foreground">
                    No conversations yet. Start chatting and they'll appear
                    here.
                  </p>
                </div>
              ) : (
                <div className="p-2 space-y-1">
                  {conversations.map((conv) => {
                    const isActive = currentConvIdRef.current === conv.id;
                    return (
                      <div
                        key={conv.id}
                        onClick={() => loadConversation(conv)}
                        className={`group relative flex items-start gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition-all ${
                          isActive
                            ? "bg-primary/10 border border-primary/20"
                            : "hover:bg-muted border border-transparent hover:border-border"
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <p
                            className={`text-xs font-semibold truncate ${isActive ? "text-primary" : "text-foreground"}`}
                          >
                            {conv.title}
                          </p>
                        </div>
                        <button
                          onClick={(e) => deleteConversation(conv.id, e)}
                          className="shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all mt-0.5"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="shrink-0 border-t border-border p-3">
              <button
                onClick={resetChat}
                className="w-full flex items-center justify-center gap-2 text-xs font-semibold text-primary hover:bg-primary/10 rounded-lg py-2 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> New conversation
              </button>
            </div>
          </div>
        )}
      </div>
      {/* end main area + sidebar */}

      {/* ── Delete conversation confirmation ── */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4 flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h3 className="font-bold text-base text-foreground">
                Delete conversation?
              </h3>
              <p className="text-sm text-muted-foreground">
                This conversation will be permanently removed from your history.
                This can't be undone.
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmDeleteId(null)}
              >
                Cancel
              </Button>
              <Button variant="destructive" size="sm" onClick={confirmDelete}>
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Clear all confirmation ── */}
      {confirmClearAll && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4 flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h3 className="font-bold text-base text-foreground">
                Clear all history?
              </h3>
              <p className="text-sm text-muted-foreground">
                All saved conversations will be permanently deleted. This can't
                be undone.
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmClearAll(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  setConversations([]);
                  localStorage.removeItem("sales_ai_history");
                  setMessages([]);
                  currentConvIdRef.current = null;
                  setConfirmClearAll(false);
                }}
              >
                Clear all
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          Modal — Business Analyzer + Full AEO Audit
      ══════════════════════════════════════════════════════════ */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="w-full max-w-3xl max-h-[92vh] flex flex-col bg-card rounded-2xl shadow-2xl overflow-hidden">
            {/* Modal header + tabs */}
            <div className="shrink-0 border-b border-border px-6 pt-5 pb-0">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="font-bold text-lg text-foreground">
                    {activeTab === "analyzer"
                      ? "Business Analyzer"
                      : "Full AEO Audit"}
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {activeTab === "analyzer"
                      ? "Fill in what you know — the AI will identify gaps and build the sales case."
                      : "ICE keyword scoring, example prompt PQS, required search volume, and backlink strategy — all in one run."}
                  </p>
                </div>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="text-muted-foreground hover:text-foreground mt-0.5"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Tab switcher */}
              <div className="flex gap-1 -mb-px">
                {(["analyzer", "audit"] as AnalyzerTab[]).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => {
                      setActiveTab(tab);
                      setAuditResults(null);
                      setAuditError("");
                    }}
                    className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
                      activeTab === tab
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {tab === "analyzer"
                      ? "Business Analyzer"
                      : "Full AEO Audit"}
                  </button>
                ))}
              </div>
            </div>

            {/* Modal body */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {/* ── BUSINESS ANALYZER tab ── */}
              {activeTab === "analyzer" && (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>Business Name</Label>
                      <Input
                        value={bizName}
                        onChange={(e) => setBizName(e.target.value)}
                        placeholder="Acme Plumbing Co."
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Location</Label>
                      <Input
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                        placeholder="Austin, TX"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>
                        Website{" "}
                        <span className="text-muted-foreground font-normal text-xs">
                          (optional)
                        </span>
                      </Label>
                      <Input
                        value={website}
                        onChange={(e) => setWebsite(e.target.value)}
                        placeholder="https://acmeplumbing.com"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Industry / Category</Label>
                      <Input
                        value={industry}
                        onChange={(e) => setIndustry(e.target.value)}
                        placeholder="Plumbing, HVAC, Dental…"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>
                      Notes{" "}
                      <span className="text-muted-foreground font-normal text-xs">
                        (optional)
                      </span>
                    </Label>
                    <Textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Any context — competitors, what the prospect said, current marketing…"
                      rows={2}
                      className="resize-none"
                    />
                  </div>

                  {/* Keywords */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label>Keywords & AI Visibility</Label>
                      <button
                        type="button"
                        onClick={addKeyword}
                        className="flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        <Plus className="w-3 h-3" /> Add keyword
                      </button>
                    </div>
                    <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">
                      <span>Keyword</span>
                      <span className="w-20 text-center">ChatGPT</span>
                      <span className="w-20 text-center">Perplexity</span>
                      <span className="w-16 text-center">Gemini</span>
                      <span className="w-6" />
                    </div>
                    <div className="space-y-2">
                      {keywords.map((kw, i) => (
                        <div
                          key={i}
                          className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 items-center"
                        >
                          <Input
                            value={kw.keyword}
                            onChange={(e) =>
                              updateKeyword(i, "keyword", e.target.value)
                            }
                            placeholder={`Keyword ${i + 1}`}
                            className="h-8 text-sm"
                          />
                          {(["chatgpt", "perplexity", "gemini"] as const).map(
                            (platform) => {
                              const widths = {
                                chatgpt: "w-20",
                                perplexity: "w-20",
                                gemini: "w-16",
                              };
                              return (
                                <button
                                  key={platform}
                                  type="button"
                                  onClick={() =>
                                    updateKeyword(i, platform, !kw[platform])
                                  }
                                  className={`${widths[platform]} h-8 rounded-lg border-2 text-xs font-semibold transition-all ${kw[platform] ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-border text-muted-foreground hover:border-muted-foreground"}`}
                                >
                                  {kw[platform] ? "Visible" : "Not seen"}
                                </button>
                              );
                            },
                          )}
                          <button
                            type="button"
                            onClick={() => removeKeyword(i)}
                            className="w-6 h-6 flex items-center justify-center text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-1">
                    <Button
                      variant="outline"
                      onClick={() => setIsModalOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button onClick={submitAnalyzer} className="gap-2">
                      <Sparkles className="w-4 h-4" /> Analyze & Chat
                    </Button>
                  </div>
                </div>
              )}

              {/* ── FULL AEO AUDIT tab ── */}
              {activeTab === "audit" && (
                <div className="space-y-5">
                  {/* Form */}
                  {!auditResults && (
                    <>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <Label>Business name</Label>
                          <Input
                            value={auditBizName}
                            onChange={(e) => setAuditBizName(e.target.value)}
                            placeholder="Appstango"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Website <span className="text-muted-foreground font-normal">(optional — server will fetch)</span></Label>
                          <Input
                            value={auditWebsite}
                            onChange={(e) => setAuditWebsite(e.target.value)}
                            placeholder="https://appstango.com/"
                            type="url"
                          />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label>What does your business do?</Label>
                        <Textarea
                          value={auditDescription}
                          onChange={(e) => setAuditDescription(e.target.value)}
                          placeholder="Describe the business, target customers, and services…"
                          rows={3}
                          className="resize-y"
                        />
                      </div>
                      <div className="grid grid-cols-4 gap-4">
                        <div className="space-y-1.5">
                          <Label>Business type</Label>
                          <Select value={auditBizType} onValueChange={setAuditBizType}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {BIZ_TYPES.map((t) => (
                                <SelectItem key={t} value={t}>{t}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label>Business size</Label>
                          <Select value={auditBizSize} onValueChange={setAuditBizSize}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {BIZ_SIZES.map((s) => (
                                <SelectItem key={s} value={s}>{s}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label>Competitors</Label>
                          <Input
                            value={auditCompetitors}
                            onChange={(e) => setAuditCompetitors(e.target.value)}
                            placeholder="e.g. ~10, many"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Location / City <span className="text-muted-foreground font-normal">(optional)</span></Label>
                          <Input
                            value={auditLocation}
                            onChange={(e) => setAuditLocation(e.target.value)}
                            placeholder="Dubai, Utah Salt Lake…"
                          />
                        </div>
                      </div>

                      {auditError && (
                        <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
                          <AlertCircle className="w-4 h-4 shrink-0" /> {auditError}
                        </div>
                      )}

                      <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={() => setIsModalOpen(false)}>Cancel</Button>
                        <Button onClick={runFullAudit} disabled={isAuditRunning} className="gap-2">
                          {isAuditRunning ? (
                            <><span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" /> Running Audit…</>
                          ) : (
                            <><Zap className="w-4 h-4" /> Run Full Audit</>
                          )}
                        </Button>
                      </div>
                    </>
                  )}

                  {/* Results */}
                  {auditResults && (() => {
                    const ARS_COLORS: Record<string, string> = {
                      Green: "text-emerald-600",
                      Amber: "text-amber-500",
                      Red:   "text-red-500",
                    };
                    const ARS_BADGE: Record<string, string> = {
                      Green: "bg-emerald-50 text-emerald-700 border border-emerald-200",
                      Amber: "bg-amber-50 text-amber-700 border border-amber-200",
                      Red:   "bg-red-50 text-red-600 border border-red-200",
                    };
                    const wa = auditResults.website_analysis;
                    const lm = auditResults.local_market;
                    return (
                      <div className="space-y-5">
                        {/* Back nav */}
                        <button
                          onClick={() => setAuditResults(null)}
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <ArrowLeft className="w-3.5 h-3.5" /> Back to form
                        </button>

                        {/* ── ARS Score card ── */}
                        <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-5">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <p className="font-bold text-base text-foreground">AEO Readiness Report</p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {auditBizName || "Business"}
                                {auditWebsite && <> · <span className="font-mono">{auditWebsite}</span></>}
                                {auditLocation && <> · {auditLocation}</>}
                              </p>
                              <p className="text-sm text-foreground mt-3 leading-relaxed">
                                {auditResults.ars.summary}
                              </p>
                              <p className="text-[10px] font-mono text-muted-foreground mt-2 bg-background rounded px-2 py-1.5 border border-border leading-relaxed break-all">
                                {auditResults.ars.formula}
                              </p>
                            </div>
                            <div className="shrink-0 text-right">
                              <p className={`text-5xl font-extrabold leading-none ${ARS_COLORS[auditResults.ars.rating] ?? "text-foreground"}`}>
                                {auditResults.ars.score.toFixed(1)}
                              </p>
                              <span className={`inline-flex mt-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${ARS_BADGE[auditResults.ars.rating] ?? ""}`}>
                                {auditResults.ars.rating}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* ── Website Analysis + Local Market ── */}
                        <div className="grid grid-cols-2 gap-4">
                          {/* Website Analysis */}
                          <Card className="bg-card border-border shadow-none">
                            <CardHeader className="pb-2 pt-4 px-4">
                              <div className="flex items-center justify-between">
                                <CardTitle className="text-sm font-bold text-foreground flex items-center gap-1.5">
                                  <span className="text-base">🌐</span> Website Analysis
                                </CardTitle>
                                {wa.ssl != null && (
                                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${wa.ssl ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-600 border-red-200"}`}>
                                    {wa.ssl ? "HTTPS ✓" : "HTTP ✗"}
                                  </span>
                                )}
                              </div>
                              {auditWebsite && (
                                <p className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
                                  <span className="font-mono truncate max-w-[160px]">{auditWebsite}</span>
                                  {wa.word_count > 0 && <span>{wa.word_count.toLocaleString()} words</span>}
                                  {wa.mobile != null && <span className={wa.mobile ? "text-emerald-600" : "text-muted-foreground"}>Mobile {wa.mobile ? "✓" : "✗"}</span>}
                                </p>
                              )}
                            </CardHeader>
                            <CardContent className="px-4 pb-4 space-y-3">
                              <p className="text-xs text-foreground leading-relaxed">{wa.summary}</p>
                              {(wa.title || wa.description || wa.h1) && (
                                <div className="bg-muted/50 rounded-lg p-2.5 space-y-1 text-[11px]">
                                  {wa.title && <p><span className="font-semibold text-muted-foreground">Title:</span> {wa.title}</p>}
                                  {wa.description && <p><span className="font-semibold text-muted-foreground">Description:</span> {wa.description}</p>}
                                  {wa.h1 && <p><span className="font-semibold text-muted-foreground">H1:</span> {wa.h1}</p>}
                                </div>
                              )}
                              <div className="space-y-1">
                                {wa.ssl_note && <p className="text-[10px] text-muted-foreground">{wa.ssl_note}</p>}
                                {wa.mobile_note && <p className="text-[10px] text-muted-foreground">{wa.mobile_note}</p>}
                                {wa.content_note && <p className="text-[10px] text-muted-foreground">{wa.content_note}</p>}
                              </div>
                            </CardContent>
                          </Card>

                          {/* Local Market */}
                          <Card className="bg-card border-border shadow-none">
                            <CardHeader className="pb-2 pt-4 px-4">
                              <CardTitle className="text-sm font-bold text-foreground flex items-center gap-1.5">
                                <span className="text-base">📍</span> Local Market{lm.location && lm.location !== "General" ? ` — ${lm.location}` : ""}
                              </CardTitle>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                Local optimization score: <span className="font-bold text-foreground">{lm.optimization_score}</span>
                              </p>
                            </CardHeader>
                            <CardContent className="px-4 pb-4 space-y-3">
                              <p className="text-xs text-foreground leading-relaxed">{lm.summary}</p>
                              {lm.recommendations.length > 0 && (
                                <ul className="space-y-1.5">
                                  {lm.recommendations.map((r, i) => (
                                    <li key={i} className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                                      <span className="mt-px shrink-0">→</span>
                                      <span>{r}</span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </CardContent>
                          </Card>
                        </div>

                        {/* ── ICE Table + right column ── */}
                        <div className="grid grid-cols-[1fr_300px] gap-5">
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <h3 className="font-bold text-sm text-foreground">Keyword ICE Scores</h3>
                              <span className="text-xs text-muted-foreground">
                                ICE = (I×0.4) + (C×0.3) + (E<sub>adj</sub>×0.3)
                              </span>
                            </div>
                            <p className="text-[10px] text-muted-foreground mb-3">
                              E<sub>adj</sub> = Ease + 0.5 geo-boost when LA ≥ 0.5 &nbsp;·&nbsp; ✓ = found on site
                            </p>
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-border">
                                  {["KEYWORD", "I", "C", "E", "E+", "ICE", "✓", "PRIORITY"].map((h) => (
                                    <th key={h} className="pb-2 text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wide pr-2 last:pr-0">
                                      {h}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border">
                                {auditResults.keywords.map((kw, i) => (
                                  <tr key={i}>
                                    <td className="py-2.5 pr-2 font-medium text-foreground leading-snug max-w-[160px]">{kw.keyword}</td>
                                    <td className="py-2.5 pr-2 text-center text-muted-foreground">{kw.impact}</td>
                                    <td className="py-2.5 pr-2 text-center text-muted-foreground">{kw.confidence}</td>
                                    <td className="py-2.5 pr-2 text-center text-muted-foreground">{kw.ease}</td>
                                    <td className="py-2.5 pr-2 text-center text-muted-foreground">{kw.ease_adj?.toFixed(1) ?? kw.ease}</td>
                                    <td className="py-2.5 pr-2 font-bold text-foreground">{kw.ice.toFixed(2)}</td>
                                    <td className="py-2.5 pr-2 text-center">
                                      {kw.on_site
                                        ? <span className="text-emerald-600 font-bold">✓</span>
                                        : <span className="text-muted-foreground/40">✗</span>}
                                    </td>
                                    <td className="py-2.5">
                                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize ${PRIORITY_STYLES[kw.priority]}`}>
                                        {kw.priority}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>

                            {/* CCS */}
                            <div className="mt-4 p-3 rounded-lg bg-muted/40 border border-border">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-bold text-foreground">Content Coverage Score (CCS)</span>
                                <span className="text-sm font-extrabold text-foreground">{auditResults.ccs.toFixed(1)}%</span>
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {auditResults.keywords.map((kw, i) => (
                                  <span key={i} className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${kw.on_site ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-500 border-red-200"}`}>
                                    {kw.keyword}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>

                          {/* Right column: PQS + Prompt Volume */}
                          <div className="space-y-4">
                            {/* PQS */}
                            <Card className="bg-muted/40 border-border shadow-none">
                              <CardHeader className="pb-2 pt-4 px-4">
                                <CardTitle className="text-sm font-bold text-foreground">Example AEO Prompt</CardTitle>
                                <CardDescription className="text-xs">
                                  PQS = (PC<sub>avg</sub>×0.4) + (RC<sub>avg</sub>×0.6)
                                </CardDescription>
                              </CardHeader>
                              <CardContent className="px-4 pb-4 space-y-3">
                                <div className="bg-background rounded-lg p-3 text-xs text-foreground leading-relaxed border border-border">
                                  {auditResults.example_prompt.text}
                                </div>
                                <div className="grid grid-cols-3 gap-2 text-center">
                                  {[
                                    { label: "PQS",    value: auditResults.example_prompt.pqs.toFixed(2) },
                                    { label: "PC avg", value: auditResults.example_prompt.pc_avg.toFixed(2) },
                                    { label: "RC avg", value: auditResults.example_prompt.rc_avg.toFixed(2) },
                                  ].map((s) => (
                                    <div key={s.label} className="bg-background rounded-lg p-2 border border-border">
                                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{s.label}</p>
                                      <p className="font-bold text-foreground text-base">{s.value}</p>
                                    </div>
                                  ))}
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-muted-foreground">Threshold:</span>
                                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${auditResults.example_prompt.threshold_met ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-orange-50 text-orange-600 border border-orange-200"}`}>
                                    {auditResults.example_prompt.threshold_met ? "Met" : "Not Met"}
                                  </span>
                                </div>
                              </CardContent>
                            </Card>

                            {/* Prompt Volume */}
                            <Card className="bg-muted/40 border-border shadow-none">
                              <CardHeader className="pb-2 pt-4 px-4">
                                <CardTitle className="text-sm font-bold text-foreground">Prompt Volume Target</CardTitle>
                                <CardDescription className="text-xs">Prompts needed to maintain AI visibility.</CardDescription>
                              </CardHeader>
                              <CardContent className="px-4 pb-4 space-y-3">
                                <div className="grid grid-cols-2 gap-2 text-center">
                                  <div className="bg-background rounded-lg p-3 border border-border">
                                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Total / Month</p>
                                    <p className="font-bold text-foreground text-2xl">{auditResults.search_volume.total}</p>
                                  </div>
                                  <div className="bg-background rounded-lg p-3 border border-border">
                                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Per Week</p>
                                    <p className="font-bold text-foreground text-2xl">{auditResults.search_volume.weekly}</p>
                                  </div>
                                </div>
                                <p className="text-[10px] text-muted-foreground bg-background rounded p-2 border border-border font-mono leading-relaxed">
                                  {auditResults.search_volume.formula}
                                </p>
                              </CardContent>
                            </Card>
                          </div>
                        </div>

                        {/* ── Recommendations ── */}
                        {auditResults.recommendations?.length > 0 && (
                          <div>
                            <h3 className="font-bold text-sm text-foreground mb-3">Recommendations</h3>
                            <div className="space-y-2">
                              {auditResults.recommendations.map((rec, i) => (
                                <div key={i} className="flex items-start gap-3 p-3 rounded-lg border border-border bg-muted/20">
                                  <span className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold mt-0.5 ${PRIORITY_STYLES[rec.priority]}`}>
                                    {rec.priority}
                                  </span>
                                  <div className="flex-1 min-w-0 space-y-0.5">
                                    <p className="text-xs font-semibold text-foreground">{rec.action}</p>
                                    <p className="text-[11px] text-muted-foreground">{rec.rationale}</p>
                                    <div className="flex gap-3 text-[10px] text-muted-foreground">
                                      <span>Impact: <span className="font-medium text-foreground">{rec.impact}</span></span>
                                      <span>Effort: <span className="font-medium text-foreground">{rec.effort}</span></span>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Actions */}
                        <div className="flex justify-end gap-2 pt-2 border-t border-border flex-wrap">
                          <Button variant="outline" onClick={() => setAuditResults(null)} className="gap-2">
                            <RotateCcw className="w-4 h-4" /> Run New Audit
                          </Button>
                          <Button variant="outline" onClick={sendChatScript} className="gap-2">
                            <MessageSquarePlus className="w-4 h-4" /> Generate Chat Script
                          </Button>
                          <Button onClick={sendAuditToChat} className="gap-2">
                            <MessageSquarePlus className="w-4 h-4" /> Discuss in Chat
                          </Button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
