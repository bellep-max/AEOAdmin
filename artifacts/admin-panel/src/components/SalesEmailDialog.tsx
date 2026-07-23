import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { rawFetch } from "@/lib/period-comparison";
import {
  X,
  Send,
  Eye,
  EyeOff,
  TrendingUp,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Trophy,
} from "lucide-react";

interface EmailConfigResponse {
  ready: boolean;
  fromEmail: string | null;
  fromName: string | null;
  hasApiKey: boolean;
  safeRecipientOverride: string | null;
  safeModeActive: boolean;
}

interface EmailRecipientsResponse {
  contactEmail: string | null;
  accountEmail: string | null;
  billingEmail: string | null;
  businessName: string | null;
}

interface PlatformOption {
  platform: string;
  beforeRank: number;
  afterRank: number;
  beforeDate: string | null;
  afterDate: string | null;
  improved: number;
  // OCR rank-visibility per screenshot: true = clear, false = rank not detected
  // (bad screenshot), null = unchecked.
  beforeRankVisible: boolean | null;
  afterRankVisible: boolean | null;
}

interface KeywordOption {
  keywordId: number;
  keyword: string | null;
  maxImproved: number;
  platforms: PlatformOption[];
  /* ISO timestamp of the last sales email sent for this keyword; null = never. */
  lastSentAt?: string | null;
  /* How many sales emails have been sent for this keyword (1 = first email). */
  sentCount?: number;
}

interface SalesPreviewResponse {
  hasImprovement: boolean;
  reason?: string;
  html: string | null;
  business?: string;
  clientName?: string;
  selected: {
    keywordId: number;
    keyword: string | null;
    platform: string;
    beforeRank: number;
    afterRank: number;
    improved: number;
  } | null;
  template?: SalesTemplateKey;
  defaultSubject?: string;
  defaultCtaLabel?: string;
  defaultIntro?: string;
  defaultOffer?: string;
  keywords: KeywordOption[];
  /* ISO timestamp of the most recent sales email sent to this client; null = none. */
  lastCommunicationAt?: string | null;
  strictMode: boolean;
}

interface CampaignShot {
  keywordId: number;
  keyword: string | null;
  platform: string;
  beforeRank: number;
  afterRank: number;
  beforeDate: string | null;
  afterDate: string | null;
  improved: number;
  afterRankVisible: boolean | null;
  beforeUrl: string | null;
  afterUrl: string | null;
}

interface CampaignScreenshotsResponse {
  /* The campaign's own street address(es) — the target to match each shot against. */
  targetAddresses: string[];
  shots: CampaignShot[];
}

type SalesTemplateKey = "first_proof" | "second_keyword";

const TEMPLATE_OPTIONS: { key: SalesTemplateKey; label: string }[] = [
  { key: "first_proof", label: "First proof — “Your first AI ranking is in”" },
  {
    key: "second_keyword",
    label: "Update — another keyword + Founder’s Discount",
  },
];

interface SalesEmailDialogProps {
  open: boolean;
  onClose: () => void;
  clientId: number | null;
  /* Rankings-page cascade filter — when set, the improvement pool is limited
     to that business / campaign; null means the client's whole pool. */
  businessId?: number | null;
  aeoPlanId?: number | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function platformLabel(p: string): string {
  if (p === "chatgpt") return "ChatGPT";
  if (p === "gemini") return "Gemini";
  if (p === "perplexity") return "Perplexity";
  return p;
}

type ScreenshotQuality = "bad" | "good" | "unverified";

/** Worst-case screenshot quality across a platform's before + after images.
 *  bad = OCR could not find the rank in an image (a "not good" screenshot to
 *  review); good = both OCR-verified; unverified = at least one not checked. */
function platformQuality(p: PlatformOption): ScreenshotQuality {
  if (p.beforeRankVisible === false || p.afterRankVisible === false)
    return "bad";
  if (p.beforeRankVisible === true && p.afterRankVisible === true)
    return "good";
  return "unverified";
}

const TOP3 = 3;

interface FlatOption {
  keywordId: number;
  keyword: string | null;
  platform: string;
  beforeRank: number;
  afterRank: number;
  improved: number;
  quality: ScreenshotQuality;
  /* top-3 finish AND the rank is OCR-verified visible in the current screenshot */
  topAndVisible: boolean;
  lastSentAt: string | null;
  sentCount: number;
}

/** Every keyword × platform screenshot flattened into one tagged, sorted list.
 *  Order: verified top-3 finishes first (a #1 before a #2), then good
 *  screenshots, then the rest — nothing is hidden, only tagged. Tags describe
 *  the current/"after" proof screenshot. */
function buildFlatOptions(keywords: KeywordOption[]): FlatOption[] {
  const qRank = (q: ScreenshotQuality) =>
    q === "good" ? 0 : q === "unverified" ? 1 : 2;
  const opts: FlatOption[] = [];
  for (const k of keywords)
    for (const p of k.platforms)
      opts.push({
        keywordId: k.keywordId,
        keyword: k.keyword,
        platform: p.platform,
        beforeRank: p.beforeRank,
        afterRank: p.afterRank,
        improved: p.improved,
        quality: platformQuality(p),
        topAndVisible: p.afterRank <= TOP3 && p.afterRankVisible === true,
        lastSentAt: k.lastSentAt ?? null,
        sentCount: k.sentCount ?? 0,
      });
  return opts.sort((a, b) => {
    if (a.topAndVisible !== b.topAndVisible) return a.topAndVisible ? -1 : 1;
    if (a.topAndVisible && a.afterRank !== b.afterRank)
      return a.afterRank - b.afterRank;
    if (qRank(a.quality) !== qRank(b.quality))
      return qRank(a.quality) - qRank(b.quality);
    return b.improved - a.improved;
  });
}

function QualityMark({ quality }: { quality: ScreenshotQuality }) {
  if (quality === "bad")
    return <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0" />;
  if (quality === "good")
    return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />;
  return null;
}

export function SalesEmailDialog({
  open,
  onClose,
  clientId,
  businessId,
  aeoPlanId,
}: SalesEmailDialogProps) {
  const { toast } = useToast();
  const [recipients, setRecipients] = useState<string[]>([]);
  const [newRecipient, setNewRecipient] = useState("");
  const [subject, setSubject] = useState("");
  const [introMessage, setIntroMessage] = useState("");
  const [offerText, setOfferText] = useState("");
  const [ctaLabel, setCtaLabel] = useState("");
  const [ctaUrl, setCtaUrl] = useState("");
  const [template, setTemplate] = useState<SalesTemplateKey>("first_proof");
  const [aiInstruction, setAiInstruction] = useState("");
  /* null = "strongest improvement" default (server picks) */
  const [selectedKeywordId, setSelectedKeywordId] = useState<number | null>(
    null,
  );
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);
  const seededRef = useRef(false);
  const [mobilePreviewOpen, setMobilePreviewOpen] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    message: string;
    safeModeActive?: boolean;
  } | null>(null);

  const { data: emailConfig } = useQuery<EmailConfigResponse>({
    enabled: open,
    queryKey: ["/api/rankings/email-config"],
    queryFn: async () => {
      const res = await rawFetch("/api/rankings/email-config");
      if (!res.ok) throw new Error("Failed to load email config");
      return res.json();
    },
  });

  const { data: defaults } = useQuery<EmailRecipientsResponse>({
    enabled: open && clientId != null,
    queryKey: ["/api/rankings/email-recipients", clientId],
    queryFn: async () => {
      const res = await rawFetch(`/api/rankings/email-recipients/${clientId}`);
      if (!res.ok) throw new Error("Failed to load client emails");
      return res.json();
    },
  });

  useEffect(() => {
    if (!defaults) return;
    const candidates = [
      defaults.contactEmail,
      defaults.accountEmail,
      defaults.billingEmail,
    ].filter((e): e is string => Boolean(e && EMAIL_RE.test(e)));
    setRecipients(Array.from(new Set(candidates)));
  }, [defaults]);

  /* Keyword/platform picks from a previous scope are meaningless for the
     next one — reset to "strongest improvement" and the first template
     whenever the scope changes. */
  useEffect(() => {
    setSelectedKeywordId(null);
    setSelectedPlatform(null);
    setIntroMessage("");
    setOfferText("");
    setTemplate("first_proof");
    seededRef.current = false;
  }, [clientId, businessId, aeoPlanId]);

  /* Switching templates loads that template's copy — clear the editable boxes
     and re-seed from the new defaults, and drop the keyword pick so the update
     email auto-features a keyword the client hasn't been emailed yet. */
  useEffect(() => {
    setSelectedKeywordId(null);
    setSelectedPlatform(null);
    setIntroMessage("");
    setOfferText("");
    setSubject("");
    setCtaLabel("");
    seededRef.current = false;
  }, [template]);

  const previewQueryParams = useMemo(() => {
    if (clientId == null) return null;
    const p = new URLSearchParams({ clientId: String(clientId) });
    if (businessId != null) p.set("businessId", String(businessId));
    if (aeoPlanId != null) p.set("aeoPlanId", String(aeoPlanId));
    p.set("template", template);
    if (selectedKeywordId != null)
      p.set("keywordId", String(selectedKeywordId));
    if (selectedPlatform != null) p.set("platform", selectedPlatform);
    if (introMessage.trim()) p.set("introMessage", introMessage.trim());
    if (offerText.trim()) p.set("offerText", offerText.trim());
    if (ctaLabel.trim()) p.set("ctaLabel", ctaLabel.trim());
    if (ctaUrl.trim()) p.set("ctaUrl", ctaUrl.trim());
    return p.toString();
  }, [
    clientId,
    businessId,
    aeoPlanId,
    template,
    selectedKeywordId,
    selectedPlatform,
    introMessage,
    offerText,
    ctaLabel,
    ctaUrl,
  ]);

  const { data: preview, isFetching: previewLoading } =
    useQuery<SalesPreviewResponse>({
      enabled: open && previewQueryParams != null,
      queryKey: ["/api/sales/email-preview", previewQueryParams],
      queryFn: async () => {
        const res = await rawFetch(
          `/api/sales/email-preview?${previewQueryParams}`,
        );
        if (!res.ok) throw new Error("Preview failed");
        return res.json();
      },
    });

  /* Campaign-scoped screenshot gallery — the operator sees the actual images
     for the selected campaign and clicks the one to feature, matching each
     against the campaign's own street address (shown above the grid). */
  const galleryParams = useMemo(() => {
    if (clientId == null) return null;
    const p = new URLSearchParams({ clientId: String(clientId) });
    if (businessId != null) p.set("businessId", String(businessId));
    if (aeoPlanId != null) p.set("aeoPlanId", String(aeoPlanId));
    return p.toString();
  }, [clientId, businessId, aeoPlanId]);

  const { data: gallery } = useQuery<CampaignScreenshotsResponse>({
    enabled: open && galleryParams != null,
    queryKey: ["/api/sales/campaign-screenshots", galleryParams],
    queryFn: async () => {
      const res = await rawFetch(
        `/api/sales/campaign-screenshots?${galleryParams}`,
      );
      if (!res.ok) throw new Error("Failed to load campaign screenshots");
      return res.json();
    },
  });

  /* Seed the editable Intro/Offer boxes with the resolved default template so
     the operator sees the actual copy and can extend it. Seed once per scope;
     don't clobber edits the user already made. */
  useEffect(() => {
    if (!preview?.hasImprovement || seededRef.current) return;
    if (introMessage === "" && preview.defaultIntro)
      setIntroMessage(preview.defaultIntro);
    if (offerText === "" && preview.defaultOffer)
      setOfferText(preview.defaultOffer);
    if (subject === "" && preview.defaultSubject)
      setSubject(preview.defaultSubject);
    if (ctaLabel === "" && preview.defaultCtaLabel)
      setCtaLabel(preview.defaultCtaLabel);
    seededRef.current = true;
  }, [preview, introMessage, offerText, subject, ctaLabel]);

  const activeKeyword = useMemo<KeywordOption | null>(() => {
    if (!preview?.keywords?.length) return null;
    return (
      preview.keywords.find(
        (k) =>
          k.keywordId === (selectedKeywordId ?? preview.selected?.keywordId),
      ) ?? preview.keywords[0]
    );
  }, [preview, selectedKeywordId]);

  // The platform option actually being sent (explicit pick, else the server's
  // default) — drives the persistent screenshot-quality note under the picker.
  const activePlatformOption = useMemo<PlatformOption | null>(() => {
    if (!activeKeyword) return null;
    const target = selectedPlatform ?? preview?.selected?.platform ?? null;
    return (
      (target
        ? activeKeyword.platforms.find((p) => p.platform === target)
        : null) ??
      activeKeyword.platforms[0] ??
      null
    );
  }, [activeKeyword, selectedPlatform, preview]);

  const aiSuggest = useMutation({
    mutationFn: async () => {
      const res = await rawFetch("/api/sales/email-ai-suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          businessId: businessId ?? undefined,
          aeoPlanId: aeoPlanId ?? undefined,
          keywordId: selectedKeywordId ?? undefined,
          platform: selectedPlatform ?? undefined,
          instruction: aiInstruction.trim() || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok)
        throw new Error(body?.detail ?? body?.error ?? "AI generation failed");
      return body as {
        intro: string;
        offer: string;
        costUsd: number;
        tokens: number;
      };
    },
    onSuccess: (data) => {
      setIntroMessage(data.intro);
      if (data.offer) setOfferText(data.offer);
    },
  });

  const send = useMutation({
    mutationFn: async () => {
      const res = await rawFetch("/api/sales/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          businessId: businessId ?? undefined,
          aeoPlanId: aeoPlanId ?? undefined,
          keywordId: selectedKeywordId ?? undefined,
          platform: selectedPlatform ?? undefined,
          template,
          recipients,
          subject: subject.trim() || undefined,
          introMessage: introMessage.trim() || undefined,
          offerText: offerText.trim() || undefined,
          ctaLabel: ctaLabel.trim() || undefined,
          ctaUrl: ctaUrl.trim() || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok)
        throw new Error(body?.detail ?? body?.error ?? "Send failed");
      return body;
    },
    onSuccess: (data) => {
      const actual: string[] = data.recipientsActual ?? [];
      toast({
        title: data.safeModeActive
          ? "✓ Email sent (safe-mode override)"
          : "✓ Email sent",
        description:
          actual.length > 0
            ? `Delivered to ${actual.join(", ")}`
            : "SendGrid accepted the message.",
      });
      // Success — close the modal; the toast stays visible outside it.
      handleClose();
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Send failed";
      setResult({ ok: false, message: msg });
      toast({ title: "Send failed", description: msg, variant: "destructive" });
    },
  });

  function addRecipient() {
    const trimmed = newRecipient.trim();
    if (!trimmed) return;
    if (!EMAIL_RE.test(trimmed)) return;
    if (recipients.includes(trimmed)) return;
    setRecipients([...recipients, trimmed]);
    setNewRecipient("");
  }

  function removeRecipient(r: string) {
    setRecipients(recipients.filter((x) => x !== r));
  }

  function handleClose() {
    setResult(null);
    setMobilePreviewOpen(false);
    setIntroMessage("");
    setOfferText("");
    setCtaLabel("");
    setCtaUrl("");
    setAiInstruction("");
    setSubject("");
    setTemplate("first_proof");
    setSelectedKeywordId(null);
    setSelectedPlatform(null);
    seededRef.current = false;
    onClose();
  }

  const noImprovement = preview != null && !preview.hasImprovement;

  const previewBlock = (
    <div className="border rounded-md overflow-hidden flex flex-col h-full bg-white">
      <div className="bg-muted/50 px-3 py-2 text-xs text-muted-foreground flex items-center justify-between flex-shrink-0">
        <span>
          Client preview
          {preview?.selected && (
            <span className="ml-2">
              · “{preview.selected.keyword}” · #{preview.selected.beforeRank} →
              #{preview.selected.afterRank} on{" "}
              {platformLabel(preview.selected.platform)}
            </span>
          )}
        </span>
      </div>
      <div className="flex-1 overflow-auto bg-white min-h-0">
        {previewLoading && !preview && (
          <div className="p-4 text-sm text-muted-foreground">
            Loading preview…
          </div>
        )}
        {noImprovement && (
          <div className="p-6 text-sm text-muted-foreground text-center space-y-2">
            <TrendingUp className="w-8 h-8 mx-auto opacity-30" />
            <div className="font-medium text-foreground">
              No verified improvement to show yet
            </div>
            <div className="text-xs">
              {preview?.reason ??
                "This client has no keyword with a verified before/after ranking improvement."}
            </div>
          </div>
        )}
        {preview?.html && (
          <iframe
            title="sales email preview"
            srcDoc={preview.html}
            className="w-full h-full min-h-[500px] border-0"
          />
        )}
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-[1500px] w-[96vw] h-[94vh] flex flex-col overflow-hidden">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>Send sales email</DialogTitle>
          <DialogDescription>
            {defaults?.businessName
              ? `Email ${defaults.businessName} their before/after ranking proof.`
              : "Email the selected client their before/after ranking proof."}
          </DialogDescription>
          {preview != null && (
            <p className="text-xs text-muted-foreground">
              {preview.lastCommunicationAt
                ? `Last email sent: ${format(new Date(preview.lastCommunicationAt), "MMM d, yyyy")}`
                : "No emails sent yet."}
            </p>
          )}
        </DialogHeader>

        <div className="flex-1 grid grid-cols-1 md:grid-cols-5 gap-4 overflow-hidden min-h-0">
          {/* LEFT: form (2/5) */}
          <div className="overflow-y-auto space-y-4 pr-1 md:col-span-2">
            {emailConfig && !emailConfig.ready && (
              <div className="p-3 rounded-md text-sm bg-amber-50 border border-amber-300 text-amber-900">
                <div className="font-semibold mb-1">
                  Sending is disabled — sender not configured
                </div>
                <div className="text-xs space-y-0.5">
                  {!emailConfig.fromEmail && (
                    <div>
                      • No FROM address set
                      <span className="opacity-70">
                        {" "}
                        (SENDGRID_FROM_EMAIL in Secrets Manager)
                      </span>
                    </div>
                  )}
                  {!emailConfig.hasApiKey && (
                    <div>
                      • No SendGrid API key{" "}
                      <span className="opacity-70">(SENDGRID_API_KEY)</span>
                    </div>
                  )}
                  <div className="opacity-70 mt-1">
                    You can still preview the email below.
                  </div>
                </div>
              </div>
            )}
            {emailConfig?.ready && emailConfig.safeModeActive && (
              <div className="p-2 rounded-md text-xs bg-blue-50 border border-blue-200 text-blue-900">
                Safe test mode is active — all sends will go to{" "}
                <strong>{emailConfig.safeRecipientOverride}</strong>, not the
                listed recipients.
              </div>
            )}
            {preview?.strictMode && (
              <div className="p-2 rounded-md text-xs bg-emerald-50 border border-emerald-200 text-emerald-900">
                Strict mode — only OCR-verified screenshots are offered as
                proof.
              </div>
            )}

            {/* Email template */}
            <div className="space-y-2">
              <Label>Email template</Label>
              <Select
                value={template}
                onValueChange={(v) => setTemplate(v as SalesTemplateKey)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TEMPLATE_OPTIONS.map((t) => (
                    <SelectItem key={t.key} value={t.key}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                The update email features a different keyword and the Founder’s
                Discount offer. Switching reloads the subject and copy.
              </p>
            </div>

            {/* Proof picker — one flat list of every keyword × platform
                screenshot, tagged by quality and top-3 visibility */}
            <div className="space-y-2">
              <Label>Screenshot to feature</Label>
              <Select
                value={
                  selectedKeywordId != null && selectedPlatform != null
                    ? `${selectedKeywordId}:${selectedPlatform}`
                    : "auto"
                }
                onValueChange={(v) => {
                  if (v === "auto") {
                    setSelectedKeywordId(null);
                    setSelectedPlatform(null);
                    return;
                  }
                  const [kid, plat] = v.split(":");
                  setSelectedKeywordId(Number(kid));
                  setSelectedPlatform(plat);
                }}
                disabled={!preview?.keywords?.length}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Strongest improvement (default)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">
                    Strongest improvement (default)
                  </SelectItem>
                  {buildFlatOptions(preview?.keywords ?? []).map((o) => (
                    <SelectItem
                      key={`${o.keywordId}:${o.platform}`}
                      value={`${o.keywordId}:${o.platform}`}
                    >
                      <span className="flex w-full min-w-0 items-center gap-2">
                        {o.topAndVisible ? (
                          <span className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
                            <Trophy className="w-3 h-3" /> Top {o.afterRank}
                          </span>
                        ) : (
                          <span className="shrink-0">
                            <QualityMark quality={o.quality} />
                          </span>
                        )}
                        <span className="truncate font-medium">
                          {o.keyword ?? `Keyword ${o.keywordId}`}
                        </span>
                        {o.sentCount > 0 && (
                          <span
                            className="ml-auto shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 border border-amber-200"
                            title={
                              o.lastSentAt
                                ? `Last emailed ${format(new Date(o.lastSentAt), "MMM d, yyyy")}${o.sentCount > 1 ? ` · ${o.sentCount} sends` : ""}`
                                : "Already emailed"
                            }
                          >
                            Sent
                            {o.lastSentAt
                              ? ` ${format(new Date(o.lastSentAt), "MMM d")}`
                              : ""}
                          </span>
                        )}
                        <span
                          className={`${o.sentCount > 0 ? "" : "ml-auto "}shrink-0 text-xs text-muted-foreground tabular-nums`}
                        >
                          {platformLabel(o.platform)} · #{o.beforeRank}→#
                          {o.afterRank}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Visual picker — the selected campaign's actual screenshots.
                  Match each against the target address, click to feature. */}
              {gallery && gallery.shots.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  {gallery.targetAddresses.length > 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      Campaign address —{" "}
                      <span className="font-medium text-foreground">
                        {gallery.targetAddresses.join(" · ")}
                      </span>
                      . Click the screenshot whose result matches it.
                    </p>
                  )}
                  <div className="grid grid-cols-3 gap-2 max-h-[320px] overflow-y-auto pr-1">
                    {gallery.shots.map((shot) => {
                      const featured =
                        selectedKeywordId != null && selectedPlatform != null
                          ? shot.keywordId === selectedKeywordId &&
                            shot.platform === selectedPlatform
                          : shot.keywordId === preview?.selected?.keywordId &&
                            shot.platform === preview?.selected?.platform;
                      const verified =
                        shot.afterRank <= TOP3 &&
                        shot.afterRankVisible === true;
                      return (
                        <button
                          type="button"
                          key={`${shot.keywordId}:${shot.platform}`}
                          onClick={() => {
                            setSelectedKeywordId(shot.keywordId);
                            setSelectedPlatform(shot.platform);
                          }}
                          title={`${shot.keyword ?? `Keyword ${shot.keywordId}`} · ${platformLabel(shot.platform)} · #${shot.beforeRank} → #${shot.afterRank}`}
                          className={`group relative rounded-md border overflow-hidden text-left transition ${
                            featured
                              ? "border-primary ring-2 ring-primary"
                              : "border-border hover:border-primary/60"
                          }`}
                        >
                          {shot.afterUrl ? (
                            <img
                              src={shot.afterUrl}
                              alt={`${shot.keyword ?? ""} ${shot.platform}`}
                              loading="lazy"
                              className="w-full h-24 object-cover object-top bg-muted"
                            />
                          ) : (
                            <div className="w-full h-24 bg-muted" />
                          )}
                          <div className="absolute top-1 left-1 flex items-center gap-1">
                            <span className="px-1 py-0.5 rounded text-[9px] font-semibold bg-black/70 text-white tabular-nums">
                              #{shot.afterRank}
                            </span>
                            {verified && (
                              <span className="px-1 py-0.5 rounded text-[9px] font-semibold bg-emerald-500 text-white inline-flex items-center gap-0.5">
                                <Trophy className="w-2.5 h-2.5" />
                              </span>
                            )}
                          </div>
                          <div className="px-1.5 py-1 border-t bg-background">
                            <div className="text-[10px] font-medium truncate">
                              {shot.keyword ?? `Keyword ${shot.keywordId}`}
                            </div>
                            <div className="text-[9px] text-muted-foreground tabular-nums">
                              {platformLabel(shot.platform)} · #
                              {shot.beforeRank}→#{shot.afterRank}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <p className="text-[11px] text-muted-foreground">
                One before/after pair per email, across all platforms. 🏆 = a
                top-3 finish verified visible in the screenshot; ✓ =
                OCR-verified; ⚠ = rank not clearly visible — review before
                sending. An amber “Sent” tag marks a keyword already emailed to
                this client; the update email skips those by default.
              </p>
              {activePlatformOption &&
                platformQuality(activePlatformOption) === "bad" && (
                  <div className="flex items-start gap-1.5 p-2 rounded-md text-xs bg-red-50 border border-red-200 text-red-800">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>
                      Heads up — the rank isn’t clearly visible in one of these
                      screenshots (failed OCR check). Open the preview and
                      confirm the ranking reads well before sending.
                    </span>
                  </div>
                )}
              {activePlatformOption &&
                platformQuality(activePlatformOption) === "unverified" && (
                  <p className="text-[11px] text-muted-foreground">
                    Not OCR-verified yet — worth a quick look at the preview to
                    confirm the rank reads clearly.
                  </p>
                )}
            </div>

            {/* Recipients */}
            <div className="space-y-2">
              <Label>Recipients</Label>
              <div className="flex flex-wrap gap-1.5 p-2 border rounded-md min-h-[40px]">
                {recipients.length === 0 && (
                  <span className="text-xs text-muted-foreground self-center">
                    No recipients — add at least one
                  </span>
                )}
                {recipients.map((r) => (
                  <Badge key={r} variant="secondary" className="gap-1">
                    {r}
                    <button
                      type="button"
                      onClick={() => removeRecipient(r)}
                      className="hover:text-destructive"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  type="email"
                  placeholder="add another email…"
                  value={newRecipient}
                  onChange={(e) => setNewRecipient(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addRecipient();
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={addRecipient}
                  disabled={!EMAIL_RE.test(newRecipient.trim())}
                >
                  Add
                </Button>
              </div>
            </div>

            {/* Subject */}
            <div className="space-y-2">
              <Label htmlFor="sales-subject">Subject (optional)</Label>
              <Input
                id="sales-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Defaults to: Your AI search ranking is climbing — {business}"
              />
            </div>

            {/* AI generate */}
            <div className="space-y-2 p-3 border border-amber-200 bg-amber-50/40 rounded-md">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-600" />
                <Label className="m-0">AI-generated sales copy</Label>
              </div>
              <Input
                placeholder="Optional hint (e.g., 'roofing contractor, push urgency')"
                value={aiInstruction}
                onChange={(e) => setAiInstruction(e.target.value)}
                disabled={aiSuggest.isPending}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5 border-amber-300 text-amber-700 hover:bg-amber-100 w-full"
                onClick={() => aiSuggest.mutate()}
                disabled={
                  clientId == null ||
                  aiSuggest.isPending ||
                  !preview?.hasImprovement
                }
              >
                <Sparkles className="w-3.5 h-3.5" />
                {aiSuggest.isPending
                  ? "Generating…"
                  : "Generate intro + offer with DeepSeek (uses real data)"}
              </Button>
              {aiSuggest.isError && (
                <p className="text-[11px] text-red-600">
                  {aiSuggest.error instanceof Error
                    ? aiSuggest.error.message
                    : "AI generation failed"}
                </p>
              )}
              {aiSuggest.isSuccess && aiSuggest.data && (
                <p className="text-[11px] text-muted-foreground">
                  Generated · {aiSuggest.data.tokens} tokens · $
                  {aiSuggest.data.costUsd.toFixed(5)}
                </p>
              )}
            </div>

            {/* Intro message */}
            <div className="space-y-2">
              <Label htmlFor="sales-intro">
                Intro copy — editable (shown above the proof)
              </Label>
              <Textarea
                id="sales-intro"
                value={introMessage}
                onChange={(e) => setIntroMessage(e.target.value)}
                placeholder="The default intro loads here — edit it or add more text…"
                rows={8}
                className="font-mono text-sm"
              />
            </div>

            {/* Offer copy */}
            <div className="space-y-2">
              <Label htmlFor="sales-offer">
                Offer copy — editable (shown above the button)
              </Label>
              <Textarea
                id="sales-offer"
                value={offerText}
                onChange={(e) => setOfferText(e.target.value)}
                placeholder="The default closing loads here — edit it or add more text…"
                rows={6}
                className="font-mono text-sm"
              />
            </div>

            {/* CTA */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label htmlFor="sales-cta-label">Button label</Label>
                <Input
                  id="sales-cta-label"
                  value={ctaLabel}
                  onChange={(e) => setCtaLabel(e.target.value)}
                  placeholder="See Your Live AI Rankings"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sales-cta-url">Button link</Label>
                <Input
                  id="sales-cta-url"
                  value={ctaUrl}
                  onChange={(e) => setCtaUrl(e.target.value)}
                  placeholder="Defaults to the client portal"
                />
              </div>
            </div>

            {/* Mobile-only: preview toggle */}
            <div className="md:hidden">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5 w-full"
                onClick={() => setMobilePreviewOpen((v) => !v)}
                disabled={clientId == null}
              >
                {mobilePreviewOpen ? (
                  <EyeOff className="w-3.5 h-3.5" />
                ) : (
                  <Eye className="w-3.5 h-3.5" />
                )}
                {mobilePreviewOpen ? "Hide preview" : "Show preview"}
              </Button>
              {mobilePreviewOpen && (
                <div className="mt-3 h-[400px]">{previewBlock}</div>
              )}
            </div>

            {/* Result */}
            {result && (
              <div
                className={`p-3 rounded-md text-sm ${
                  result.ok
                    ? "bg-green-50 text-green-900 border border-green-200"
                    : "bg-red-50 text-red-900 border border-red-200"
                }`}
              >
                {result.ok ? "✓ " : "✗ "}
                {result.message}
                {result.safeModeActive && (
                  <div className="text-xs mt-1 opacity-75">
                    Safe mode active — re-routed to test inbox.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* RIGHT: live preview (desktop only, 3/5 — wide enough for the
              email's real 640px width) */}
          <div className="hidden md:flex flex-col min-h-0 md:col-span-3">
            {previewBlock}
          </div>
        </div>

        <DialogFooter className="flex-shrink-0">
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={() => send.mutate()}
            disabled={
              recipients.length === 0 ||
              clientId == null ||
              send.isPending ||
              emailConfig?.ready === false ||
              noImprovement ||
              !preview?.hasImprovement
            }
            className="gap-1.5"
            title={
              emailConfig?.ready === false
                ? "Sender not configured — set SENDGRID_FROM_EMAIL in Secrets Manager"
                : noImprovement
                  ? "No verified before/after improvement to send"
                  : undefined
            }
          >
            <Send className="w-3.5 h-3.5" />
            {send.isPending ? "Sending…" : "Send email"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
