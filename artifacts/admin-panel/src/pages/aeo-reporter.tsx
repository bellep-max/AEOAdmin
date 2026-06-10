import React, { useState, useEffect, useRef } from "react";
import jsPDF from "jspdf";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Download,
  Copy,
  RefreshCw,
  AlertCircle,
  Search,
  BrainCircuit,
  Zap,
  Sparkles,
  ArrowLeft,
  History,
  Trash2,
  X,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
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

const RANK_OPTIONS = [
  "Not ranked",
  "Top 1",
  "Top 3",
  "Top 5",
  "Top 10",
  "Top 20",
] as const;

type ServiceType = "seo" | "aeo" | "hybrid" | "auto";

interface HistoryEntry {
  id: string;
  businessName: string;
  location: string;
  serviceType: ServiceType;
  report: string;
  createdAt: string;
}

const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
const AEO_REPORTER_STREAM_URL = `${BASE}/api/llm/aeo-reporter/stream`;

const HISTORY_KEY = "aeo_report_history";

function loadHistory(): HistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveToHistory(entry: HistoryEntry) {
  const history = loadHistory();
  localStorage.setItem(
    HISTORY_KEY,
    JSON.stringify([entry, ...history].slice(0, 50)),
  );
}

const SERVICE_TYPES: {
  id: ServiceType;
  label: string;
  sublabel: string;
  icon: React.ReactNode;
  color: string;
  activeColor: string;
  description: string;
}[] = [
  {
    id: "seo",
    label: "SEO",
    sublabel: "Search Engine",
    icon: <Search className="w-5 h-5" />,
    color: "border-border hover:border-blue-400 hover:bg-blue-50/50",
    activeColor: "border-blue-500 bg-blue-50 ring-2 ring-blue-500/20",
    description:
      "Traditional search engine optimization — rank higher on Google for typed queries.",
  },
  {
    id: "aeo",
    label: "AEO",
    sublabel: "Answer Engine",
    icon: <BrainCircuit className="w-5 h-5" />,
    color: "border-border hover:border-primary/60 hover:bg-primary/5",
    activeColor: "border-primary bg-primary/5 ring-2 ring-primary/20",
    description:
      "Get your business cited as the answer on ChatGPT, Gemini, and Perplexity.",
  },
  {
    id: "hybrid",
    label: "Hybrid",
    sublabel: "SEO + AEO",
    icon: <Zap className="w-5 h-5" />,
    color: "border-border hover:border-amber-400 hover:bg-amber-50/50",
    activeColor: "border-amber-500 bg-amber-50 ring-2 ring-amber-500/20",
    description:
      "Full-spectrum strategy combining both traditional SEO and answer engine optimization.",
  },
  {
    id: "auto",
    label: "Auto-Detect",
    sublabel: "AI Decides",
    icon: <Sparkles className="w-5 h-5" />,
    color: "border-border hover:border-violet-400 hover:bg-violet-50/50",
    activeColor: "border-violet-500 bg-violet-50 ring-2 ring-violet-500/20",
    description:
      "Paste your business description and let AI determine the right service type.",
  },
];

const formSchema = z.object({
  businessName: z.string().min(1, "Business Name is required"),
  businessDescription: z.string().optional(),
  websiteUrl: z
    .union([z.string().url("Must be a valid URL"), z.literal("")])
    .optional(),
  gmbUrl: z.string().optional(),
  location: z.string().min(1, "Location is required"),
  keyword1: z.string().optional(),
  keyword1Rank: z.string().optional(),
  keyword2: z.string().optional(),
  keyword2Rank: z.string().optional(),
  keyword3: z.string().optional(),
  keyword3Rank: z.string().optional(),
  keyword4: z.string().optional(),
  keyword4Rank: z.string().optional(),
  keyword5: z.string().optional(),
  keyword5Rank: z.string().optional(),
  aiPlatforms: z.array(z.string()).optional(),
});

type FormValues = z.infer<typeof formSchema>;

const LOADING_MESSAGES: Record<ServiceType, string[]> = {
  seo: [
    "Evaluating your keywords...",
    "Analyzing search volume...",
    "Researching SERP competitors...",
    "Building your SEO report...",
  ],
  aeo: [
    "Evaluating your keywords...",
    "Analyzing your website...",
    "Researching competitors...",
    "Building your AEO report...",
  ],
  hybrid: [
    "Analyzing SEO landscape...",
    "Scanning answer engine signals...",
    "Researching competitors...",
    "Building your hybrid report...",
  ],
  auto: [
    "Reading your business description...",
    "Determining optimal service type...",
    "Researching market competitors...",
    "Building your analysis...",
  ],
};

function buildKeywordLines(values: FormValues): string {
  const pairs = [1, 2, 3, 4, 5]
    .map((n) => {
      const kw = values[`keyword${n}` as keyof FormValues] as string;
      const rank = values[`keyword${n}Rank` as keyof FormValues] as string;
      if (!kw?.trim()) return null;
      const rankLabel =
        rank && rank !== "Not ranked" ? ` (currently ${rank})` : "";
      return `- "${kw}"${rankLabel}`;
    })
    .filter(Boolean);
  return pairs.length > 0 ? pairs.join("\n") : "(none provided)";
}

function buildPrompt(values: FormValues, serviceType: ServiceType): string {
  const serviceLabel =
    serviceType === "seo"
      ? "SEO"
      : serviceType === "aeo"
        ? "AEO"
        : serviceType === "hybrid"
          ? "Hybrid SEO + AEO"
          : "the most suitable service (SEO, AEO, or Hybrid — determine from context)";

  const keywordLines = buildKeywordLines(values);
  const platforms = values.aiPlatforms ?? [];
  const platformLine =
    platforms.length > 0
      ? `AI platforms where they currently appear: ${platforms.join(", ")}`
      : "";

  const aeoContext =
    serviceType === "aeo" || serviceType === "hybrid" || serviceType === "auto"
      ? `
AEO CONTEXT (internal guidance — do NOT use these exact terms in the report):
- AEO means getting the business cited as the authoritative answer when users ask questions on AI platforms like ChatGPT, Gemini, and Perplexity.
- This works by building authoritative content that AI models reference, earning high-quality backlinks, and structuring information so AI engines pull from it when users ask relevant follow-up questions.
- Do NOT mention "voice search" anywhere in the report.`
      : "";

  return `You are a concise digital marketing expert writing a short, punchy client-facing report. Use ONLY the structure below. No preamble, no extra sections, no jargon.

Business Name: ${values.businessName}
Location: ${values.location}
Website: ${values.websiteUrl}
Google My Business: ${values.gmbUrl}
${values.businessDescription ? `Business Description: ${values.businessDescription}` : ""}
Keywords with current rankings:
${keywordLines}
${platformLine}
Requested service: ${serviceLabel}
${aeoContext}

IMPORTANT RULES:
- Never say "voice search".
- If any keyword is already Top 1: make it clear that Top 1 today does NOT mean Top 1 tomorrow — competitors are actively targeting that spot, AI engines constantly re-rank, and losing it means losing customers overnight. Our service locks in and compounds that lead.
- The "Why They Need Us" section is the most important part. Write it like a trusted advisor speaking directly to the owner — confident, specific, and irresistible. Use their actual keyword data. 4 sentences max. Structure it like this:
  1. What's at stake right now (what they're winning or losing based on their rankings).
  2. What the competition is doing that threatens them.
  3. What Signal AEO specifically does to flip or protect that position — make it sound powerful and exclusive, not generic.
  4. One closing line that makes the next step (contacting us) feel like the obvious, smart move.

---

Output exactly this structure:

## ${values.businessName}

**Business:** [One sentence: what they do and who they serve.]

---

### Competitive Keywords in the Market

[3–5 bullet points. Each: the keyword + one punchy line on the revenue or visibility opportunity it represents.]

---

### Top 3 Competitors in the Area

1. **[Name]** — [One sentence: what makes them a real threat right now.]
2. **[Name]** — [One sentence: what makes them a real threat right now.]
3. **[Name]** — [One sentence: what makes them a real threat right now.]

---

### What We Can Do for ${values.businessName}

[Follow the 4-sentence structure above. Make it feel personal, urgent, and like we're the only team that truly understands their situation. Do NOT use generic phrases like "boost your online presence" or "drive more traffic". Be specific to their keywords, their competitors, and their market. End with a sentence that naturally leads them to want to reach out.]

---

### AI Platforms Visibility

[If platform data was provided: one sentence per platform — state plainly whether they appear there and what that gap or advantage means in terms of customers reached. If no platform data: one sentence on how ChatGPT, Gemini, and Perplexity are now where buyers go first — and why not appearing there means handing those customers to a competitor.]

---

Keep the entire report under 320 words. Do not add any footer, sign-off, or contact details.`;
}

type Segment = { text: string; bold: boolean };

function parseSegments(raw: string): Segment[] {
  const parts = raw.split(/(\*\*.*?\*\*)/g);
  return parts
    .map((p) =>
      p.startsWith("**") && p.endsWith("**")
        ? { text: p.slice(2, -2), bold: true }
        : { text: p.replace(/\*(.*?)\*/g, "$1"), bold: false },
    )
    .filter((s) => s.text !== "");
}

function renderSegments(
  doc: jsPDF,
  segments: Segment[],
  x: number,
  y: number,
  maxW: number,
  fontSize: number,
  color: [number, number, number],
  lineH: number,
): number {
  doc.setFontSize(fontSize);
  doc.setTextColor(...color);

  let cx = x;
  let cy = y;
  const spaceW = () => {
    doc.setFont("helvetica", "normal");
    return doc.getTextWidth(" ");
  };

  for (const seg of segments) {
    doc.setFont("helvetica", seg.bold ? "bold" : "normal");
    // Split segment into words to handle wrapping
    const words = seg.text.split(" ").filter((w) => w !== "");
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      doc.setFont("helvetica", seg.bold ? "bold" : "normal");
      const ww = doc.getTextWidth(word);
      const needSpace = cx > x;
      const sw = needSpace ? spaceW() : 0;
      if (needSpace && cx + sw + ww > x + maxW) {
        cy += lineH;
        cx = x;
        doc.setFont("helvetica", seg.bold ? "bold" : "normal");
        doc.text(word, cx, cy);
        cx += ww;
      } else {
        if (needSpace) {
          doc.setFont("helvetica", "normal");
          doc.text(" ", cx, cy);
          cx += sw;
        }
        doc.setFont("helvetica", seg.bold ? "bold" : "normal");
        doc.text(word, cx, cy);
        cx += ww;
      }
    }
  }
  return cy;
}

function segmentHeight(
  doc: jsPDF,
  segments: Segment[],
  x: number,
  maxW: number,
  fontSize: number,
  lineH: number,
): number {
  doc.setFontSize(fontSize);
  let cx = x;
  let lines = 1;
  const spaceW = () => {
    doc.setFont("helvetica", "normal");
    return doc.getTextWidth(" ");
  };
  for (const seg of segments) {
    const words = seg.text.split(" ").filter((w) => w !== "");
    for (const word of words) {
      doc.setFont("helvetica", seg.bold ? "bold" : "normal");
      const ww = doc.getTextWidth(word);
      const needSpace = cx > x;
      const sw = needSpace ? spaceW() : 0;
      if (needSpace && cx + sw + ww > x + maxW) {
        lines++;
        cx = x + ww;
      } else {
        cx += (needSpace ? sw : 0) + ww;
      }
    }
  }
  return lines * lineH;
}

function downloadPdf(
  reportText: string,
  businessName: string,
  location: string,
  serviceLabel: string,
) {
  const doc = new jsPDF({
    unit: "pt",
    format: "letter",
    orientation: "portrait",
  });
  const PW = doc.internal.pageSize.getWidth();
  const PH = doc.internal.pageSize.getHeight();
  const ML = 50,
    MR = 50,
    MT = 50,
    MB = 70;
  const CW = PW - ML - MR;
  let y = MT;
  const LINE_H = 15;

  const PRIMARY: [number, number, number] = [37, 99, 235];
  const TEXT: [number, number, number] = [15, 23, 42];
  const MUTED: [number, number, number] = [100, 116, 139];
  const BORDER: [number, number, number] = [220, 224, 235];

  const checkY = (needed: number) => {
    if (y + needed > PH - MB) {
      doc.addPage();
      doc.setFillColor(...PRIMARY);
      doc.rect(0, 0, PW, 4, "F");
      y = MT;
    }
  };

  // Top accent bar
  doc.setFillColor(...PRIMARY);
  doc.rect(0, 0, PW, 4, "F");

  // Meta line
  y = 28;
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.setFont("helvetica", "normal");
  doc.text("Signal AEO", ML, y);
  doc.text(
    new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
    PW - MR,
    y,
    { align: "right" },
  );
  y += 10;
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.5);
  doc.line(ML, y, PW - MR, y);
  y += 22;

  // Business name heading
  doc.setFontSize(17);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...PRIMARY);
  doc.text(businessName, ML, y);
  y += 10;

  // Service type only (no address) under the name
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...MUTED);
  doc.text(`${serviceLabel} Report`, ML, y);
  y += 14;

  // Accent divider
  doc.setDrawColor(...PRIMARY);
  doc.setLineWidth(1.5);
  doc.line(ML, y, ML + 36, y);
  doc.setLineWidth(0.5);
  doc.setDrawColor(...BORDER);
  doc.line(ML + 38, y, PW - MR, y);
  y += 22;

  // Render markdown lines
  for (const raw of reportText.split("\n")) {
    const line = raw.trimEnd();

    if (line.startsWith("## ")) {
      // Skip — business name already in header
      continue;
    } else if (line.startsWith("### ")) {
      checkY(100);
      y += 8;
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...TEXT);
      doc.text(line.replace(/^### /, ""), ML, y);
      y += 5;
      doc.setDrawColor(...BORDER);
      doc.setLineWidth(0.5);
      doc.line(ML, y, PW - MR, y);
      y += 14;
    } else if (line === "---") {
      // skip — sections already have a divider drawn under their ### heading
      continue;
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      const segs = parseSegments(line.replace(/^[-*] /, ""));
      const bulletSegs: Segment[] = [{ text: "• ", bold: false }, ...segs];
      const h = segmentHeight(doc, bulletSegs, ML + 12, CW - 16, 10, LINE_H);
      checkY(h + 4);
      renderSegments(doc, bulletSegs, ML + 12, y, CW - 16, 10, TEXT, LINE_H);
      y += h + 4;
    } else if (/^\d+\.\s/.test(line)) {
      const segs = parseSegments(line);
      const h = segmentHeight(doc, segs, ML + 12, CW - 16, 10, LINE_H);
      checkY(h + 4);
      renderSegments(doc, segs, ML + 12, y, CW - 16, 10, TEXT, LINE_H);
      y += h + 4;
    } else if (line.trim() === "") {
      y += 6;
    } else {
      const segs = parseSegments(line);
      if (!segs.length) continue;
      const h = segmentHeight(doc, segs, ML, CW, 10, LINE_H);
      checkY(h + 4);
      renderSegments(doc, segs, ML, y, CW, 10, TEXT, LINE_H);
      y += h + 4;
    }
  }

  // CTA box
  // CTA box — commented out for now
  // const ctaH = 108;
  // checkY(ctaH + 20);
  // y += 16;
  // doc.setFillColor(245, 247, 255);
  // doc.roundedRect(ML, y, CW, ctaH, 8, 8, "F");
  // doc.setDrawColor(200, 210, 245);
  // doc.setLineWidth(0.75);
  // doc.roundedRect(ML, y, CW, ctaH, 8, 8, "S");
  // doc.setFillColor(...PRIMARY);
  // doc.roundedRect(ML, y, CW, 4, 8, 8, "F");
  // doc.rect(ML, y + 2, CW, 4, "F");
  // let cy = y + 20;
  // doc.setFontSize(7.5);
  // doc.setFont("helvetica", "bold");
  // doc.setTextColor(...PRIMARY);
  // doc.text("SIGNAL AEO", PW / 2, cy, { align: "center" });
  // cy += 16;
  // doc.setFontSize(13);
  // doc.setTextColor(...TEXT);
  // doc.text("Your competitors aren't waiting. Neither should you.", PW / 2, cy, { align: "center" });
  // cy += 14;
  // doc.setFontSize(8.5);
  // doc.setFont("helvetica", "normal");
  // doc.setTextColor(...MUTED);
  // const ctaNote = "First conversation is free — we'll show you exactly where you stand and what it takes to dominate.";
  // const ctaLines = doc.splitTextToSize(ctaNote, CW - 60);
  // doc.text(ctaLines, PW / 2, cy, { align: "center" });
  // cy += ctaLines.length * 12 + 12;
  // doc.setFontSize(9);
  // doc.setFont("helvetica", "bold");
  // doc.setTextColor(...PRIMARY);
  // doc.text("contact@signalaeo.com  ·  (123) 456-2942", PW / 2, cy, { align: "center" });

  // Page numbers
  const totalPages = (
    doc.internal as unknown as { getNumberOfPages: () => number }
  ).getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...MUTED);
    doc.text(`${i} / ${totalPages}`, PW - MR, PH - 20, { align: "right" });
    doc.text("Signal AEO — Confidential", ML, PH - 20);
  }

  const filename = `${businessName.replace(/[^a-z0-9]/gi, "_")}_${serviceLabel}_Report.pdf`;
  doc.save(filename);
}

export default function AeoReporter() {
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [serviceType, setServiceType] = useState<ServiceType>("aeo");

  const [isGenerating, setIsGenerating] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [loadingMsgIndex, setLoadingMsgIndex] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [report, setReport] = useState("");
  const [reportServiceType, setReportServiceType] =
    useState<ServiceType>("aeo");
  const [error, setError] = useState("");
  const abortControllerRef = useRef<AbortController | null>(null);
  const { toast } = useToast();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      businessName: "",
      businessDescription: "",
      websiteUrl: "",
      gmbUrl: "",
      location: "",
      keyword1: "",
      keyword1Rank: "Not ranked",
      keyword2: "",
      keyword2Rank: "Not ranked",
      keyword3: "",
      keyword3Rank: "Not ranked",
      keyword4: "",
      keyword4Rank: "Not ranked",
      keyword5: "",
      keyword5Rank: "Not ranked",
      aiPlatforms: [],
    },
  });

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    const messages = LOADING_MESSAGES[serviceType];
    if (isGenerating) {
      interval = setInterval(() => {
        setLoadingMsgIndex((prev) => (prev + 1) % messages.length);
      }, 2500);
    }
    return () => clearInterval(interval);
  }, [isGenerating, serviceType]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;
    if (isGenerating) {
      setElapsedSeconds(0);
      timer = setInterval(() => {
        setElapsedSeconds((s) => s + 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [isGenerating]);

  const deleteHistoryEntry = (id: string) => {
    const updated = history.filter((e) => e.id !== id);
    setHistory(updated);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  };

  const clearAllHistory = () => {
    setHistory([]);
    localStorage.removeItem(HISTORY_KEY);
  };

  const loadHistoryEntry = (entry: HistoryEntry) => {
    setReport(entry.report);
    setReportServiceType(entry.serviceType);
    setIsHistoryOpen(false);
  };

  const cancelGeneration = () => {
    abortControllerRef.current?.abort();
    setIsGenerating(false);
    setIsStreaming(false);
  };

  const generateReport = async (values: FormValues) => {
    if (serviceType === "auto" && !values.businessDescription?.trim()) {
      form.setError("businessDescription", {
        message: "Business description is required for Auto-Detect mode.",
      });
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsGenerating(true);
    setIsStreaming(false);
    setReport("");
    setError("");
    setLoadingMsgIndex(0);
    setElapsedSeconds(0);
    setReportServiceType(serviceType);

    const prompt = buildPrompt(values, serviceType);

    try {
      const response = await fetch(AEO_REPORTER_STREAM_URL, {
        method: "POST",
        signal: controller.signal,
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(
          `API Error ${response.status}: ${errText || response.statusText}`,
        );
      }

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let accumulatedText = "";

      setIsGenerating(false);
      setIsStreaming(true);

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");
          for (const line of lines) {
            if (line.startsWith("data: ") && line !== "data: [DONE]") {
              try {
                const data = JSON.parse(line.slice(6));
                const content = data.choices[0]?.delta?.content || "";
                accumulatedText += content;
                setReport(accumulatedText);
              } catch (_) {
                // ignore partial chunks
              }
            }
          }
        }
      }
      setIsStreaming(false);
      const entry: HistoryEntry = {
        id: Date.now().toString(),
        businessName: values.businessName,
        location: values.location || "",
        serviceType,
        report: accumulatedText,
        createdAt: new Date().toISOString(),
      };
      saveToHistory(entry);
      setHistory(loadHistory());
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(
        err instanceof Error
          ? err.message
          : "Failed to generate report. Please check your API key and try again.",
      );
      setIsGenerating(false);
      setIsStreaming(false);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(report);
    toast({
      title: "Copied to clipboard",
      description: "The report has been copied to your clipboard.",
    });
  };

  const handlePrint = () => {
    const biz = form.getValues().businessName || "Report";
    const loc = form.getValues().location || "";
    const svcLabel = reportService.label;
    downloadPdf(report, biz, loc, svcLabel);
  };

  const resetForm = () => {
    setReport("");
    setError("");
    setIsStreaming(false);
    form.reset();
  };

  const currentMessages = LOADING_MESSAGES[serviceType];
  const activeService = SERVICE_TYPES.find((s) => s.id === serviceType)!;
  const reportService = SERVICE_TYPES.find((s) => s.id === reportServiceType)!;

  const showForm = !report && !isGenerating && !isStreaming;
  const showLoading = isGenerating;
  const showReport = !isGenerating && (report !== "" || isStreaming);

  return (
    <div className="min-h-screen bg-background pb-24 print:min-h-0 print:pb-0">
      {/* Header */}
      <header className="border-b border-border bg-card sticky top-0 z-10 no-print">
        <div className="container mx-auto max-w-5xl px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-primary flex items-center justify-center text-primary-foreground font-bold text-sm">
              A
            </div>
            <h1 className="font-bold text-lg text-foreground tracking-tight">
              AEO Reporter
            </h1>
          </div>

          <div className="flex items-center gap-2">
            {showReport && (
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={resetForm}
                data-testid="button-back"
              >
                <ArrowLeft className="w-4 h-4" />
                New Report
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="gap-2 relative"
              onClick={() => setIsHistoryOpen(true)}
            >
              <History className="w-4 h-4" />
              History
              {history.length > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                  {history.length > 9 ? "9+" : history.length}
                </span>
              )}
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto max-w-5xl px-4 py-8">
        {/* Error */}
        {error && (
          <div
            className="mb-8 p-4 rounded-lg bg-destructive/10 border border-destructive/20 flex items-start gap-3 no-print"
            data-testid="status-error"
          >
            <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-semibold text-destructive">
                Generation Failed
              </h3>
              <p className="text-sm text-destructive/80 mt-1">{error}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setError("")}
              className="text-destructive/60 hover:text-destructive -mt-1"
            >
              Dismiss
            </Button>
          </div>
        )}

        {/* Form */}
        {showForm && (
          <div className="no-print">
            <div className="mb-8">
              <h2 className="text-3xl font-bold text-foreground mb-2">
                New Report
              </h2>
              <p className="text-muted-foreground text-lg">
                Select a service type, fill in the client details, and generate
                a comprehensive analysis.
              </p>
            </div>

            {/* Service Type Selector */}
            <div className="mb-8">
              <p className="text-sm font-semibold text-foreground mb-3 uppercase tracking-wide">
                Service Type
              </p>
              <div
                className="grid grid-cols-2 md:grid-cols-4 gap-3"
                data-testid="service-type-selector"
              >
                {SERVICE_TYPES.map((svc) => (
                  <button
                    key={svc.id}
                    type="button"
                    data-testid={`button-service-${svc.id}`}
                    onClick={() => setServiceType(svc.id)}
                    className={`relative flex flex-col items-start gap-2 p-4 rounded-xl border-2 text-left transition-all duration-150 cursor-pointer ${
                      serviceType === svc.id ? svc.activeColor : svc.color
                    }`}
                  >
                    <div
                      className={`p-1.5 rounded-lg ${serviceType === svc.id ? "bg-white/80 shadow-sm" : "bg-muted"}`}
                    >
                      {svc.icon}
                    </div>
                    <div>
                      <p className="font-bold text-foreground text-sm leading-tight">
                        {svc.label}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {svc.sublabel}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
              <p
                className="mt-3 text-sm text-muted-foreground pl-1"
                data-testid="text-service-description"
              >
                {activeService.description}
              </p>
            </div>

            <Card className="shadow-sm">
              <CardContent className="p-6">
                <Form {...form}>
                  <form
                    onSubmit={form.handleSubmit(generateReport)}
                    className="space-y-8"
                  >
                    {serviceType === "auto" && (
                      <div className="rounded-xl border-2 border-violet-200 bg-violet-50/50 p-5 space-y-3">
                        <div className="flex items-center gap-2">
                          <Sparkles className="w-4 h-4 text-violet-600" />
                          <p className="font-semibold text-violet-900 text-sm">
                            Auto-Detect Mode
                          </p>
                        </div>
                        <p className="text-xs text-violet-700 leading-relaxed">
                          Paste a full description of the business below. AI
                          will determine whether SEO, AEO, or a hybrid approach
                          is right, then extract keywords and build a tailored
                          strategy.
                        </p>
                        <FormField
                          control={form.control}
                          name="businessDescription"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-violet-900">
                                Business Description{" "}
                                <span className="text-destructive">*</span>
                              </FormLabel>
                              <FormControl>
                                <Textarea
                                  data-testid="textarea-business-description"
                                  placeholder="e.g. Smith's Enterprise is a family-owned equipment and truck dealer in Salemburg, North Carolina, offering tractors, trailers, utility equipment, and related services with a focus on honest customer support and fair pricing."
                                  rows={5}
                                  className="resize-none bg-white border-violet-200 focus-visible:ring-violet-400"
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    )}

                    <div className="grid md:grid-cols-2 gap-6">
                      {/* Left column: Business Details */}
                      <div className="space-y-6">
                        <h3 className="font-semibold text-foreground border-b pb-2 flex items-center gap-2">
                          <span className="bg-primary/10 text-primary w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold">
                            1
                          </span>
                          Business Details
                        </h3>

                        <FormField
                          control={form.control}
                          name="businessName"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Business Name</FormLabel>
                              <FormControl>
                                <Input
                                  data-testid="input-business-name"
                                  placeholder="Acme Corp"
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        {serviceType !== "auto" && (
                          <FormField
                            control={form.control}
                            name="businessDescription"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>
                                  Business Description{" "}
                                  <span className="text-muted-foreground font-normal">
                                    (optional)
                                  </span>
                                </FormLabel>
                                <FormControl>
                                  <Textarea
                                    data-testid="textarea-business-description"
                                    placeholder="Briefly describe what the business does, its products/services, and target customers..."
                                    rows={3}
                                    className="resize-none"
                                    {...field}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        )}

                        <FormField
                          control={form.control}
                          name="websiteUrl"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>
                                Website URL{" "}
                                <span className="text-muted-foreground font-normal">
                                  (optional)
                                </span>
                              </FormLabel>
                              <FormControl>
                                <Input
                                  data-testid="input-website-url"
                                  placeholder="https://acme.com"
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="gmbUrl"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>
                                Google My Business URL{" "}
                                <span className="text-muted-foreground font-normal">
                                  (optional)
                                </span>
                              </FormLabel>
                              <FormControl>
                                <Input
                                  data-testid="input-gmb-url"
                                  placeholder="https://maps.google.com/..."
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="location"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Location</FormLabel>
                              <FormControl>
                                <Input
                                  data-testid="input-location"
                                  placeholder="San Francisco, CA"
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      {/* Right column: Keywords + Platforms */}
                      <div className="space-y-6">
                        <h3 className="font-semibold text-foreground border-b pb-2 flex items-center gap-2">
                          <span className="bg-primary/10 text-primary w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold">
                            2
                          </span>
                          Target Keywords
                          {serviceType === "auto" && (
                            <span className="text-xs font-normal text-muted-foreground ml-1">
                              (optional — AI will extract from description)
                            </span>
                          )}
                        </h3>

                        {[1, 2, 3, 4, 5].map((num) => (
                          <div
                            key={`keyword${num}`}
                            className="flex items-start gap-2"
                          >
                            <span className="text-muted-foreground text-sm font-medium w-4 shrink-0 mt-2.5">
                              {num}.
                            </span>
                            <FormField
                              control={form.control}
                              name={`keyword${num}` as keyof FormValues}
                              render={({ field }) => (
                                <FormItem className="flex-1 min-w-0">
                                  <FormLabel className="sr-only">
                                    Keyword {num}
                                  </FormLabel>
                                  <FormControl>
                                    <Input
                                      data-testid={`input-keyword-${num}`}
                                      placeholder={`Keyword ${num}`}
                                      {...field}
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={form.control}
                              name={`keyword${num}Rank` as keyof FormValues}
                              render={({ field }) => (
                                <FormItem className="w-32 shrink-0">
                                  <FormLabel className="sr-only">
                                    Rank {num}
                                  </FormLabel>
                                  <Select
                                    value={field.value as string}
                                    onValueChange={field.onChange}
                                  >
                                    <FormControl>
                                      <SelectTrigger
                                        data-testid={`select-rank-${num}`}
                                        className="text-xs"
                                      >
                                        <SelectValue placeholder="Rank" />
                                      </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                      {RANK_OPTIONS.map((r) => (
                                        <SelectItem
                                          key={r}
                                          value={r}
                                          className="text-xs"
                                        >
                                          {r}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </div>
                        ))}

                        {/* AI Platforms */}
                        <FormField
                          control={form.control}
                          name="aiPlatforms"
                          render={({ field }) => {
                            const platforms = [
                              "ChatGPT",
                              "Gemini",
                              "Perplexity",
                            ];
                            const selected: string[] = field.value ?? [];
                            const toggle = (p: string) => {
                              field.onChange(
                                selected.includes(p)
                                  ? selected.filter((x) => x !== p)
                                  : [...selected, p],
                              );
                            };
                            return (
                              <FormItem>
                                <FormLabel className="text-sm font-semibold">
                                  Ranked on AI Platforms
                                  <span className="text-muted-foreground font-normal ml-1">
                                    (optional)
                                  </span>
                                </FormLabel>
                                <div className="flex gap-2 flex-wrap mt-1">
                                  {platforms.map((p) => (
                                    <button
                                      key={p}
                                      type="button"
                                      data-testid={`toggle-platform-${p.toLowerCase()}`}
                                      onClick={() => toggle(p)}
                                      className={`px-3 py-1.5 rounded-full text-xs font-semibold border-2 transition-all ${
                                        selected.includes(p)
                                          ? "border-primary bg-primary text-primary-foreground"
                                          : "border-border text-muted-foreground hover:border-primary/50"
                                      }`}
                                    >
                                      {p}
                                    </button>
                                  ))}
                                </div>
                                <p className="text-xs text-muted-foreground mt-1">
                                  Select the AI platforms where this business
                                  already appears.
                                </p>
                              </FormItem>
                            );
                          }}
                        />
                      </div>
                    </div>

                    <div className="pt-4 flex justify-end">
                      <Button
                        type="submit"
                        size="lg"
                        className="w-full md:w-auto text-base gap-2"
                        data-testid="button-generate"
                      >
                        {activeService.icon}
                        Generate{" "}
                        {serviceType === "auto"
                          ? "Analysis"
                          : `${activeService.label} Report`}
                      </Button>
                    </div>
                  </form>
                </Form>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Loading */}
        {showLoading && (
          <div
            className="flex flex-col items-center justify-center py-28 no-print"
            data-testid="status-loading"
          >
            <div className="relative">
              <div className="w-24 h-24 rounded-full border-4 border-muted border-t-primary animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-16 h-16 rounded-full border-4 border-muted border-b-secondary animate-spin [animation-direction:reverse] [animation-duration:1.5s]" />
              </div>
            </div>

            <h3 className="text-2xl font-bold text-foreground mt-8 mb-2">
              Analyzing Data
            </h3>

            <p
              className="text-muted-foreground text-lg transition-all duration-500 mb-1"
              data-testid="text-loading-message"
            >
              {currentMessages[loadingMsgIndex]}
            </p>

            <p className="text-sm text-muted-foreground/60 mb-6">
              {elapsedSeconds < 10
                ? "This usually takes 30–60 seconds — hang tight."
                : elapsedSeconds < 30
                  ? "Still working — AI reports take a moment to build."
                  : elapsedSeconds < 60
                    ? "Almost there — generating your full report..."
                    : "Taking a little longer than usual — please wait."}
            </p>

            <div className="flex items-center gap-3">
              <span
                className="text-xs font-mono text-muted-foreground bg-muted px-2.5 py-1 rounded-full"
                data-testid="text-elapsed"
              >
                {String(Math.floor(elapsedSeconds / 60)).padStart(2, "0")}:
                {String(elapsedSeconds % 60).padStart(2, "0")}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={cancelGeneration}
                data-testid="button-cancel"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Report */}
        {showReport && (
          <div className="report-container" data-testid="section-report">
            <div className="mb-6 flex items-center gap-3 no-print">
              <div
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold border-2 ${reportService.activeColor}`}
              >
                {reportService.icon}
                {reportService.label}{" "}
                {reportServiceType !== "auto" ? "Report" : "Analysis"}
              </div>
              {isStreaming && (
                <span
                  className="text-xs text-muted-foreground animate-pulse"
                  data-testid="status-streaming"
                >
                  Generating...
                </span>
              )}
            </div>

            <div className="print-only hidden mb-8 text-center">
              <h1 className="text-4xl font-bold text-primary mb-2">
                {reportServiceType !== "auto"
                  ? `${reportService.label} Analysis Report`
                  : "Service Analysis Report"}
              </h1>
              <p className="text-xl text-muted-foreground">
                {form.getValues().businessName} &bull;{" "}
                {form.getValues().location}
              </p>
            </div>

            <Card className="border-none shadow-none bg-transparent">
              <CardContent className="p-0 prose prose-slate max-w-none prose-headings:font-bold prose-h2:text-primary prose-a:text-secondary">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {report}
                </ReactMarkdown>
              </CardContent>
            </Card>

            {!isStreaming && report && (
              <div className="mt-12 rounded-2xl overflow-hidden print-cta">
                <div className="h-1.5 w-full bg-gradient-to-r from-primary via-violet-500 to-amber-400" />
                <div className="border-2 border-t-0 border-primary/15 rounded-b-2xl bg-gradient-to-br from-primary/5 via-background to-violet-50/40 px-8 py-10 text-center">
                  <p className="text-xs font-bold uppercase tracking-widest text-primary mb-3">
                    Signal AEO
                  </p>
                  <h3 className="text-2xl font-extrabold text-foreground mb-2 leading-tight">
                    Your competitors aren't waiting.
                    <br />
                    <span className="text-primary">Neither should you.</span>
                  </h3>
                  <p className="text-muted-foreground mb-2 max-w-lg mx-auto text-sm leading-relaxed">
                    We help businesses own their keywords on Google <em>and</em>{" "}
                    get cited as the answer on ChatGPT, Gemini, and Perplexity —
                    so you capture customers at every touchpoint, before your
                    competitors even show up.
                  </p>
                  <p className="text-muted-foreground mb-7 max-w-lg mx-auto text-sm leading-relaxed">
                    <strong className="text-foreground">
                      First conversation is free.
                    </strong>{" "}
                    We'll show you exactly where you stand and what it takes to
                    dominate — no fluff, no obligation.
                  </p>
                  <div className="flex flex-wrap gap-3 justify-center">
                    <a
                      href="mailto:contact@signalaeo.com"
                      className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-bold text-primary-foreground shadow-lg hover:bg-primary/90 hover:shadow-primary/30 hover:shadow-xl transition-all"
                    >
                      ✉&nbsp;contact@signalaeo.com
                    </a>
                    <a
                      href="tel:+11234562942"
                      className="inline-flex items-center gap-2 rounded-xl border-2 border-primary px-6 py-3 text-sm font-bold text-primary hover:bg-primary hover:text-primary-foreground transition-all"
                    >
                      📞&nbsp;(123) 456-2942
                    </a>
                  </div>
                </div>
              </div>
            )}

            <div className="mt-8 flex flex-wrap gap-4 items-center justify-center border-t pt-8 no-print">
              <Button
                onClick={handlePrint}
                variant="outline"
                className="gap-2"
                data-testid="button-download-pdf"
              >
                <Download className="w-4 h-4" />
                Download PDF
              </Button>
              <Button
                onClick={copyToClipboard}
                variant="outline"
                className="gap-2"
                data-testid="button-copy"
              >
                <Copy className="w-4 h-4" />
                Copy Text
              </Button>
              <Button
                onClick={resetForm}
                className="gap-2"
                data-testid="button-new-report"
              >
                <RefreshCw className="w-4 h-4" />
                Generate New Report
              </Button>
            </div>
          </div>
        )}
      </main>

      {/* History Sidebar Overlay */}
      {isHistoryOpen && (
        <div className="fixed inset-0 z-50 flex no-print">
          <div
            className="flex-1 bg-black/40"
            onClick={() => setIsHistoryOpen(false)}
          />

          <div className="w-80 bg-card border-l border-border flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between px-4 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-primary" />
                <h2 className="font-semibold text-foreground">
                  Report History
                </h2>
                {history.length > 0 && (
                  <span className="text-xs bg-muted text-muted-foreground rounded-full px-2 py-0.5">
                    {history.length}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {history.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive gap-1 text-xs"
                    onClick={clearAllHistory}
                  >
                    <Trash2 className="w-3 h-3" />
                    Clear all
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setIsHistoryOpen(false)}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {history.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center px-6 py-16 text-muted-foreground">
                  <History className="w-10 h-10 mb-3 opacity-30" />
                  <p className="text-sm font-medium">No reports yet</p>
                  <p className="text-xs mt-1">
                    Generated reports will appear here.
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {history.map((entry) => {
                    const svc = SERVICE_TYPES.find(
                      (s) => s.id === entry.serviceType,
                    )!;
                    const date = new Date(entry.createdAt);
                    return (
                      <li
                        key={entry.id}
                        className="group flex items-start gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
                      >
                        <button
                          className="flex-1 text-left min-w-0"
                          onClick={() => loadHistoryEntry(entry)}
                        >
                          <p className="font-semibold text-sm text-foreground truncate">
                            {entry.businessName}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {entry.location}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <span
                              className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border ${svc.activeColor}`}
                            >
                              {svc.label}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              {date.toLocaleDateString()}{" "}
                              {date.toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>
                        </button>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity pt-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => loadHistoryEntry(entry)}
                          >
                            <ChevronRight className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-destructive hover:text-destructive"
                            onClick={() => deleteHistoryEntry(entry.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
