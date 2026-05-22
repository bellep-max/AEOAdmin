import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
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
import { rawFetch } from "@/lib/period-comparison";
import { X, Send, Eye, EyeOff, Sparkles } from "lucide-react";

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

interface PreviewResponse {
  html: string;
  clientName: string;
  keywordCount: number;
  rowCount: number;
  withScreenshotCount: number;
}

interface EmailTemplate {
  id: string;
  name: string;
  body: string;
}

interface TemplatesResponse {
  vars: Record<string, string | number | null>;
  templates: EmailTemplate[];
}

interface SendReportDialogProps {
  open: boolean;
  onClose: () => void;
  clientId: number | null;
  businessId?: number | null;
  aeoPlanId?: number | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SendReportDialog({
  open,
  onClose,
  clientId,
  businessId,
  aeoPlanId,
}: SendReportDialogProps) {
  const [recipients, setRecipients] = useState<string[]>([]);
  const [newRecipient, setNewRecipient] = useState("");
  const [subject, setSubject] = useState("");
  const [customMessage, setCustomMessage] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [mode, setMode] = useState<"comparison" | "current" | "previous">(
    "comparison",
  );
  const [mobilePreviewOpen, setMobilePreviewOpen] = useState(false);
  const [aiInstruction, setAiInstruction] = useState("");
  const [result, setResult] = useState<{
    ok: boolean;
    message: string;
    safeModeActive?: boolean;
    recipientsActual?: string[];
  } | null>(null);

  /* Pre-fill recipients from client's stored email fields when client changes. */
  /* Sender-side config: tells us if the backend can actually send. */
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

  /* Load templates (with data already interpolated) when dialog opens. */
  const { data: templatesData } = useQuery<TemplatesResponse>({
    enabled: open && clientId != null,
    queryKey: [
      "/api/rankings/email-templates",
      clientId,
      businessId ?? null,
      aeoPlanId ?? null,
    ],
    queryFn: async () => {
      const p = new URLSearchParams({ clientId: String(clientId) });
      if (businessId != null) p.set("businessId", String(businessId));
      if (aeoPlanId != null) p.set("aeoPlanId", String(aeoPlanId));
      const res = await rawFetch(`/api/rankings/email-templates?${p}`);
      if (!res.ok) throw new Error("Failed to load templates");
      return res.json();
    },
  });

  function applyTemplate(id: string) {
    setSelectedTemplateId(id);
    const t = templatesData?.templates.find((x) => x.id === id);
    if (t) setCustomMessage(t.body);
  }

  const aiSuggest = useMutation({
    mutationFn: async () => {
      const res = await rawFetch("/api/rankings/email-ai-suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          businessId: businessId ?? undefined,
          aeoPlanId: aeoPlanId ?? undefined,
          instruction: aiInstruction.trim() || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok)
        throw new Error(body?.detail ?? body?.error ?? "AI generation failed");
      return body as { body: string; costUsd: number; tokens: number };
    },
    onSuccess: (data) => {
      setCustomMessage(data.body);
      setSelectedTemplateId(""); // clear template selection since AI replaced it
    },
  });

  const previewQueryParams = useMemo(() => {
    if (clientId == null) return null;
    const p = new URLSearchParams({ clientId: String(clientId) });
    if (businessId != null) p.set("businessId", String(businessId));
    if (aeoPlanId != null) p.set("aeoPlanId", String(aeoPlanId));
    if (customMessage.trim()) p.set("customMessage", customMessage.trim());
    p.set("mode", mode);
    return p.toString();
  }, [clientId, businessId, aeoPlanId, customMessage, mode]);

  const { data: preview, isFetching: previewLoading } =
    useQuery<PreviewResponse>({
      enabled: open && previewQueryParams != null,
      queryKey: ["/api/rankings/email-preview", previewQueryParams],
      queryFn: async () => {
        const res = await rawFetch(
          `/api/rankings/email-preview?${previewQueryParams}`,
        );
        if (!res.ok) throw new Error("Preview failed");
        return res.json();
      },
    });

  const send = useMutation({
    mutationFn: async () => {
      const res = await rawFetch("/api/rankings/send-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          businessId: businessId ?? undefined,
          aeoPlanId: aeoPlanId ?? undefined,
          recipients,
          subject: subject.trim() || undefined,
          customMessage: customMessage.trim() || undefined,
          mode,
        }),
      });
      const body = await res.json();
      if (!res.ok)
        throw new Error(body?.detail ?? body?.error ?? "Send failed");
      return body;
    },
    onSuccess: (data) => {
      setResult({
        ok: true,
        message: `Sent to ${(data.recipientsActual ?? []).join(", ")}`,
        safeModeActive: data.safeModeActive,
        recipientsActual: data.recipientsActual,
      });
    },
    onError: (err: unknown) => {
      setResult({
        ok: false,
        message: err instanceof Error ? err.message : "Send failed",
      });
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
    setCustomMessage("");
    setSelectedTemplateId("");
    setSubject("");
    onClose();
  }

  const previewBlock = (
    <div className="border rounded-md overflow-hidden flex flex-col h-full bg-white">
      <div className="bg-muted/50 px-3 py-2 text-xs text-muted-foreground flex items-center justify-between flex-shrink-0">
        <span>
          Live preview
          {preview && (
            <span className="ml-2">
              · {preview.keywordCount} keywords · {preview.rowCount} rows ·{" "}
              {preview.withScreenshotCount} screenshots
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
        {preview && (
          <iframe
            title="email preview"
            srcDoc={preview.html}
            className="w-full h-full min-h-[500px] border-0"
          />
        )}
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-6xl h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>Send rankings report</DialogTitle>
          <DialogDescription>
            {defaults?.businessName
              ? `Email the latest rankings & screenshots to ${defaults.businessName}.`
              : "Email the latest rankings & screenshots to the selected client."}
          </DialogDescription>
        </DialogHeader>

        {/* Side-by-side on md+, stacked on mobile */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 overflow-hidden min-h-0">
          {/* LEFT: form */}
          <div className="overflow-y-auto space-y-4 pr-1">
            {/* Config warning */}
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
                    You can still preview the email and try AI generation below.
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

            {/* Mode picker — controls what columns show in the email table */}
            <div className="space-y-2">
              <Label>Include in email</Label>
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  onClick={() => setMode("comparison")}
                  className={`text-xs px-3 py-2 rounded-md border transition-colors ${
                    mode === "comparison"
                      ? "bg-indigo-600 border-indigo-600 text-white font-semibold"
                      : "bg-background border-input hover:bg-muted"
                  }`}
                >
                  Comparison
                  <div className="text-[10px] opacity-75 font-normal mt-0.5">
                    Current vs Previous
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setMode("current")}
                  className={`text-xs px-3 py-2 rounded-md border transition-colors ${
                    mode === "current"
                      ? "bg-indigo-600 border-indigo-600 text-white font-semibold"
                      : "bg-background border-input hover:bg-muted"
                  }`}
                >
                  Current only
                  <div className="text-[10px] opacity-75 font-normal mt-0.5">
                    Latest audit
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setMode("previous")}
                  className={`text-xs px-3 py-2 rounded-md border transition-colors ${
                    mode === "previous"
                      ? "bg-indigo-600 border-indigo-600 text-white font-semibold"
                      : "bg-background border-input hover:bg-muted"
                  }`}
                >
                  Previous only
                  <div className="text-[10px] opacity-75 font-normal mt-0.5">
                    Last ~2 weeks
                  </div>
                </button>
              </div>
            </div>

            {/* Template picker */}
            <div className="space-y-2">
              <Label>Template</Label>
              <Select
                value={selectedTemplateId}
                onValueChange={applyTemplate}
                disabled={!templatesData?.templates?.length}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pick a template to start…" />
                </SelectTrigger>
                <SelectContent>
                  {templatesData?.templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Templates use real bi-weekly data — client name, date, keyword
                count, improved/declined counts, top result. Edit freely after
                picking.
              </p>
            </div>

            {/* AI generate */}
            <div className="space-y-2 p-3 border border-indigo-200 bg-indigo-50/40 rounded-md">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-600" />
                <Label className="m-0">AI-generated message</Label>
              </div>
              <Input
                placeholder="Optional hint (e.g., 'focus on the wins, keep it short')"
                value={aiInstruction}
                onChange={(e) => setAiInstruction(e.target.value)}
                disabled={aiSuggest.isPending}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5 border-indigo-300 text-indigo-700 hover:bg-indigo-100 w-full"
                onClick={() => aiSuggest.mutate()}
                disabled={clientId == null || aiSuggest.isPending}
              >
                <Sparkles className="w-3.5 h-3.5" />
                {aiSuggest.isPending
                  ? "Generating…"
                  : "Generate with DeepSeek (uses real data)"}
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
              <Label htmlFor="subject">Subject (optional)</Label>
              <Input
                id="subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Defaults to: AEO Rankings Report — {client} ({date})"
              />
            </div>

            {/* Custom message */}
            <div className="space-y-2">
              <Label htmlFor="message">Message body</Label>
              <Textarea
                id="message"
                value={customMessage}
                onChange={(e) => setCustomMessage(e.target.value)}
                placeholder="Pick a template above, or write your own message here…"
                rows={10}
                className="font-mono text-sm"
              />
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

          {/* RIGHT: live preview (desktop only) */}
          <div className="hidden md:flex flex-col min-h-0">{previewBlock}</div>
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
              emailConfig?.ready === false
            }
            className="gap-1.5"
            title={
              emailConfig?.ready === false
                ? "Sender not configured — set SENDGRID_FROM_EMAIL in Secrets Manager"
                : undefined
            }
          >
            <Send className="w-3.5 h-3.5" />
            {send.isPending ? "Sending…" : "Send report"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
