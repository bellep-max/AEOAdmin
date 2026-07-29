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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { rawFetch } from "@/lib/period-comparison";
import { X, Send, CheckCircle2, Trophy, ImageOff } from "lucide-react";

/* Declined-payment follow-up: after a free-trial proof send whose paid
   conversion charge was declined, ask the client to update their payment
   method (fixed Stripe billing-portal button in the template). Cites the same
   keyword/platform/rank the proof announced — the operator picks which. */

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
  defaultSubject: string;
}

interface RecipientsResponse {
  businessName: string | null;
  contactEmail: string | null;
  accountEmail: string | null;
  billingEmail: string | null;
}

interface DeclinedPaymentDialogProps {
  open: boolean;
  onClose: () => void;
  clientId: number | null;
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

export function DeclinedPaymentDialog({
  open,
  onClose,
  clientId,
  businessId,
  aeoPlanId,
}: DeclinedPaymentDialogProps) {
  const { toast } = useToast();
  const [recipients, setRecipients] = useState<string[]>([]);
  const [newRecipient, setNewRecipient] = useState("");
  const [subject, setSubject] = useState("");
  const [selected, setSelected] = useState<{
    keywordId: number;
    platform: string;
  } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
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

  useEffect(() => {
    if (!defaults) return;
    const candidates = [
      defaults.contactEmail,
      defaults.accountEmail,
      defaults.billingEmail,
    ].filter((e): e is string => Boolean(e && EMAIL_RE.test(e)));
    setRecipients(Array.from(new Set(candidates)));
  }, [defaults]);

  const shots = useMemo(() => gallery?.shots ?? [], [gallery]);
  useEffect(() => {
    if (selected != null || shots.length === 0) return;
    const best =
      shots.find((s) => s.afterRank <= TOP3 && s.afterRankVisible === true) ??
      shots[0];
    setSelected({ keywordId: best.keywordId, platform: best.platform });
  }, [shots, selected]);

  useEffect(() => {
    setSelected(null);
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
    return p.toString();
  }, [clientId, businessId, aeoPlanId, selected]);

  const { data: preview, isLoading: previewLoading } =
    useQuery<PreviewResponse>({
      enabled: open && previewParams != null,
      queryKey: ["/api/sales/declined-payment-preview", previewParams],
      queryFn: async () => {
        const res = await rawFetch(
          `/api/sales/declined-payment-preview?${previewParams}`,
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? "Failed to load preview");
        }
        return res.json();
      },
    });

  useEffect(() => {
    if (!preview) return;
    setSubject((cur) => (cur.trim() ? cur : preview.defaultSubject));
  }, [preview]);

  const sendMutation = useMutation({
    mutationFn: async () => {
      const res = await rawFetch("/api/sales/send-declined-payment", {
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
      toast({ title: "Declined-payment email sent" });
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
          <DialogTitle>Send declined-payment email</DialogTitle>
          <DialogDescription>
            Ask the client to update their payment method after a failed
            conversion charge. Cites the ranking you pick — the email itself has
            no screenshot, just the fixed “Update Payment Method” button.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4 overflow-hidden min-h-0">
          <div className="overflow-auto space-y-5 pr-1">
            {/* Ranking to cite */}
            <div className="space-y-2">
              <Label>Ranking to mention</Label>
              {galleryLoading && (
                <p className="text-sm text-muted-foreground">
                  Loading rankings…
                </p>
              )}
              {!galleryLoading && shots.length === 0 && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground p-4 border rounded-md">
                  <ImageOff className="w-4 h-4" />
                  No rankings available for this client yet.
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
                      className={`text-left border rounded-lg p-2 transition-all ${
                        isSel
                          ? "ring-2 ring-primary border-primary"
                          : "hover:border-primary/50"
                      }`}
                    >
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
                        className="text-[11px] font-medium truncate mt-1"
                        title={s.keyword ?? ""}
                      >
                        {s.keyword ?? "—"}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {platformLabel(s.platform)}
                      </p>
                    </button>
                  );
                })}
              </div>
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
                {recipients.map((r) => (
                  <Badge key={r} variant="secondary" className="gap-1">
                    {r}
                    <button type="button" onClick={() => removeRecipient(r)}>
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
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
                <Button type="button" variant="outline" onClick={addRecipient}>
                  Add
                </Button>
              </div>
            </div>

            {result && (
              <div
                className={`rounded-md border px-3 py-2 text-sm ${
                  result.ok
                    ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                    : "border-red-300 bg-red-50 text-red-700"
                }`}
              >
                {result.message}
              </div>
            )}
          </div>

          {/* Preview */}
          <div className="border rounded-md flex flex-col overflow-hidden min-h-0">
            <div className="px-3 py-2 border-b bg-muted/40 text-xs font-semibold flex items-center gap-2">
              Client preview
              {preview && (
                <span className="text-muted-foreground font-normal">
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
                  Pick a ranking to preview the email.
                </div>
              )}
              {preview?.html && (
                <iframe
                  title="declined-payment preview"
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
            onClick={() => setConfirmOpen(true)}
            disabled={!canSend}
            className="gap-1.5"
          >
            <Send className="w-4 h-4" />
            {sendMutation.isPending ? "Sending…" : "Send email"}
          </Button>
        </DialogFooter>

        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Send the declined-payment email?
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2 text-sm">
                  <p>
                    This tells the client their conversion charge failed and
                    asks them to update their payment method. It cannot be
                    unsent.
                  </p>
                  <p>
                    <span className="font-semibold text-foreground">To:</span>{" "}
                    {recipients.join(", ")}
                  </p>
                  {preview && (
                    <p>
                      <span className="font-semibold text-foreground">
                        Cites:
                      </span>{" "}
                      “{preview.keyword}” · Top #{preview.rank} on{" "}
                      {platformLabel(preview.platform)}
                    </p>
                  )}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setConfirmOpen(false);
                  sendMutation.mutate();
                }}
              >
                Yes, send it
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
