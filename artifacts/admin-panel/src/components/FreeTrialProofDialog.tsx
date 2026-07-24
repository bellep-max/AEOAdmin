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
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { rawFetch } from "@/lib/period-comparison";
import { X, Send, CheckCircle2, Trophy, ImageOff } from "lucide-react";

/* The free-trial proof email is deliberately different from the sales proofs:
   ONE operator-picked screenshot (no before/after), no CTA, "reply to us"
   close. This dialog is opened by the owner-only "Send free-trial proof" button
   on a free-trial client's page. */

interface CampaignShot {
  keywordId: number;
  keyword: string | null;
  platform: string;
  afterRank: number;
  afterRankVisible: boolean | null;
  afterUrl: string | null;
}

interface GalleryResponse {
  shots: CampaignShot[];
}

interface PreviewResponse {
  html: string;
  business: string;
  keyword: string;
  platform: string;
  rank: number;
  cityState: string | null;
  defaultSubject: string;
}

interface RecipientsResponse {
  businessName: string | null;
  contactEmail: string | null;
  accountEmail: string | null;
  billingEmail: string | null;
}

interface FreeTrialProofDialogProps {
  open: boolean;
  onClose: () => void;
  clientId: number | null;
  /* Campaign-page trigger: limit the screenshot pool to one campaign. */
  businessId?: number | null;
  aeoPlanId?: number | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOP3 = 3;

function platformLabel(p: string): string {
  if (p === "chatgpt") return "ChatGPT";
  if (p === "gemini") return "Gemini";
  if (p === "perplexity") return "Perplexity";
  return p;
}

export function FreeTrialProofDialog({
  open,
  onClose,
  clientId,
  businessId,
  aeoPlanId,
}: FreeTrialProofDialogProps) {
  const { toast } = useToast();
  const [recipients, setRecipients] = useState<string[]>([]);
  const [newRecipient, setNewRecipient] = useState("");
  const [cityState, setCityState] = useState("");
  const [subject, setSubject] = useState("");
  const [selected, setSelected] = useState<{
    keywordId: number;
    platform: string;
  } | null>(null);
  const [result, setResult] = useState<{
    ok: boolean;
    message: string;
    safeModeActive?: boolean;
  } | null>(null);

  const { data: defaults } = useQuery<RecipientsResponse>({
    enabled: open && clientId != null,
    queryKey: ["/api/rankings/email-recipients", clientId],
    queryFn: async () => {
      const res = await rawFetch(`/api/rankings/email-recipients/${clientId}`);
      if (!res.ok) throw new Error("Failed to load client emails");
      return res.json();
    },
  });

  const scopeParams = useMemo(() => {
    if (clientId == null) return null;
    const p = new URLSearchParams({ clientId: String(clientId) });
    if (businessId != null) p.set("businessId", String(businessId));
    if (aeoPlanId != null) p.set("aeoPlanId", String(aeoPlanId));
    return p.toString();
  }, [clientId, businessId, aeoPlanId]);

  const { data: gallery, isLoading: galleryLoading } =
    useQuery<GalleryResponse>({
      enabled: open && scopeParams != null,
      queryKey: ["/api/sales/campaign-screenshots", scopeParams],
      queryFn: async () => {
        const res = await rawFetch(
          `/api/sales/campaign-screenshots?${scopeParams}`,
        );
        if (!res.ok) throw new Error("Failed to load screenshots");
        return res.json();
      },
    });

  /* Seed the recipient list from the client's own emails. */
  useEffect(() => {
    if (!defaults) return;
    const candidates = [
      defaults.contactEmail,
      defaults.accountEmail,
      defaults.billingEmail,
    ].filter((e): e is string => Boolean(e && EMAIL_RE.test(e)));
    setRecipients(Array.from(new Set(candidates)));
  }, [defaults]);

  /* Default the featured screenshot to the strongest verified Top-3 shot. */
  const shots = useMemo(() => gallery?.shots ?? [], [gallery]);
  useEffect(() => {
    if (selected != null || shots.length === 0) return;
    const best =
      shots.find((s) => s.afterRank <= TOP3 && s.afterRankVisible === true) ??
      shots[0];
    setSelected({ keywordId: best.keywordId, platform: best.platform });
  }, [shots, selected]);

  /* Reset everything when the dialog target changes. */
  useEffect(() => {
    setSelected(null);
    setCityState("");
    setSubject("");
    setResult(null);
  }, [clientId, businessId, aeoPlanId]);

  const previewParams = useMemo(() => {
    if (clientId == null || selected == null) return null;
    const p = new URLSearchParams({
      clientId: String(clientId),
      keywordId: String(selected.keywordId),
      platform: selected.platform,
    });
    if (businessId != null) p.set("businessId", String(businessId));
    if (aeoPlanId != null) p.set("aeoPlanId", String(aeoPlanId));
    if (cityState.trim()) p.set("cityState", cityState.trim());
    return p.toString();
  }, [clientId, businessId, aeoPlanId, selected, cityState]);

  const { data: preview, isLoading: previewLoading } =
    useQuery<PreviewResponse>({
      enabled: open && previewParams != null,
      queryKey: ["/api/sales/free-trial-proof-preview", previewParams],
      queryFn: async () => {
        const res = await rawFetch(
          `/api/sales/free-trial-proof-preview?${previewParams}`,
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? "Failed to load preview");
        }
        return res.json();
      },
    });

  /* Seed City/State + subject once the preview resolves them. */
  useEffect(() => {
    if (!preview) return;
    setCityState((cur) => (cur.trim() ? cur : (preview.cityState ?? "")));
    setSubject((cur) => (cur.trim() ? cur : preview.defaultSubject));
  }, [preview]);

  const sendMutation = useMutation({
    mutationFn: async () => {
      const res = await rawFetch("/api/sales/send-free-trial-proof", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          businessId: businessId ?? undefined,
          aeoPlanId: aeoPlanId ?? undefined,
          keywordId: selected?.keywordId,
          platform: selected?.platform,
          recipients,
          subject: subject.trim() || undefined,
          cityState: cityState.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Send failed");
      return data as {
        deliveredVia: string | null;
        recipientsActual: string[];
        safeModeActive?: boolean;
      };
    },
    onSuccess: (data) => {
      setResult({
        ok: true,
        safeModeActive: data.safeModeActive,
        message: data.safeModeActive
          ? `Safe mode: sent to ${data.recipientsActual.join(", ")} instead of the client.`
          : `Sent via ${data.deliveredVia ?? "email"} to ${data.recipientsActual.join(", ")}.`,
      });
      toast({ title: "Free-trial proof sent" });
    },
    onError: (err: unknown) => {
      setResult({
        ok: false,
        message: err instanceof Error ? err.message : "Send failed",
      });
      toast({ title: "Send failed", variant: "destructive" });
    },
  });

  function addRecipient() {
    const trimmed = newRecipient.trim();
    if (!EMAIL_RE.test(trimmed) || recipients.includes(trimmed)) return;
    setRecipients([...recipients, trimmed]);
    setNewRecipient("");
  }

  function removeRecipient(r: string) {
    setRecipients(recipients.filter((x) => x !== r));
  }

  function handleClose() {
    setResult(null);
    onClose();
  }

  const canSend =
    selected != null &&
    recipients.length > 0 &&
    !sendMutation.isPending &&
    preview != null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-[1400px] w-[96vw] h-[94vh] flex flex-col overflow-hidden">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>Send free-trial proof</DialogTitle>
          <DialogDescription>
            {defaults?.businessName
              ? `Email ${defaults.businessName} a single Top-3 screenshot and move them to the paid plan.`
              : "Pick one ranking screenshot to feature — no before/after comparison."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4 overflow-hidden min-h-0">
          {/* ── Left: controls ── */}
          <div className="overflow-auto space-y-5 pr-1">
            {/* Screenshot gallery */}
            <div className="space-y-2">
              <Label>Screenshot to feature</Label>
              {galleryLoading && (
                <p className="text-sm text-muted-foreground">
                  Loading screenshots…
                </p>
              )}
              {!galleryLoading && shots.length === 0 && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground p-4 border rounded-md">
                  <ImageOff className="w-4 h-4" />
                  No ranking screenshots available for this client yet.
                </div>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {shots.map((s) => {
                  const isSel =
                    selected?.keywordId === s.keywordId &&
                    selected?.platform === s.platform;
                  const isTop3Visible =
                    s.afterRank <= TOP3 && s.afterRankVisible === true;
                  return (
                    <button
                      key={`${s.keywordId}:${s.platform}`}
                      type="button"
                      onClick={() =>
                        setSelected({
                          keywordId: s.keywordId,
                          platform: s.platform,
                        })
                      }
                      className={`relative text-left border rounded-lg overflow-hidden transition-all ${
                        isSel
                          ? "ring-2 ring-primary border-primary"
                          : "hover:border-primary/50"
                      }`}
                    >
                      {s.afterUrl ? (
                        <img
                          src={s.afterUrl}
                          alt={`${s.keyword ?? "keyword"} on ${s.platform}`}
                          className="w-full h-24 object-cover object-top bg-slate-100"
                        />
                      ) : (
                        <div className="w-full h-24 bg-slate-100 flex items-center justify-center">
                          <ImageOff className="w-5 h-5 text-slate-400" />
                        </div>
                      )}
                      <div className="p-1.5 space-y-0.5">
                        <div className="flex items-center gap-1">
                          <Badge
                            variant={isTop3Visible ? "default" : "secondary"}
                            className="text-[10px] px-1 py-0"
                          >
                            #{s.afterRank}
                          </Badge>
                          {isTop3Visible && (
                            <Trophy className="w-3 h-3 text-amber-500" />
                          )}
                          {isSel && (
                            <CheckCircle2 className="w-3 h-3 text-primary ml-auto" />
                          )}
                        </div>
                        <p
                          className="text-[11px] font-medium truncate"
                          title={s.keyword ?? ""}
                        >
                          {s.keyword ?? "—"}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {platformLabel(s.platform)}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* City / State */}
            <div className="space-y-2">
              <Label>City, State</Label>
              <Input
                placeholder="e.g. Middletown, CT"
                value={cityState}
                onChange={(e) => setCityState(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                Used in “When people in {"{City, State}"} search…”. Leave blank
                to drop the location.
              </p>
            </div>

            {/* Subject */}
            <div className="space-y-2">
              <Label>Subject</Label>
              <Input
                placeholder={preview?.defaultSubject ?? "Subject line"}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
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

            {result && (
              <div
                className={`text-sm rounded-md p-3 ${
                  result.ok
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : "bg-destructive/10 text-destructive"
                }`}
              >
                {result.message}
              </div>
            )}
          </div>

          {/* ── Right: live preview ── */}
          <div className="border rounded-md overflow-hidden flex flex-col min-h-0 bg-white">
            <div className="bg-muted/50 px-3 py-2 text-xs text-muted-foreground flex-shrink-0">
              Client preview
              {preview && (
                <span className="ml-2">
                  · “{preview.keyword}” · Top #{preview.rank} on{" "}
                  {platformLabel(preview.platform)}
                </span>
              )}
            </div>
            <div className="flex-1 overflow-auto bg-white min-h-0">
              {previewLoading && (
                <div className="p-4 text-sm text-muted-foreground">
                  Loading preview…
                </div>
              )}
              {!previewLoading && !preview && (
                <div className="p-6 text-sm text-muted-foreground text-center">
                  Pick a screenshot to preview the email.
                </div>
              )}
              {preview?.html && (
                <iframe
                  title="free-trial proof preview"
                  srcDoc={preview.html}
                  className="w-full h-full min-h-[500px] border-0"
                />
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="flex-shrink-0">
          <Button variant="outline" onClick={handleClose}>
            Close
          </Button>
          <Button
            onClick={() => sendMutation.mutate()}
            disabled={!canSend}
            className="gap-1.5"
          >
            <Send className="w-4 h-4" />
            {sendMutation.isPending ? "Sending…" : "Send proof"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
