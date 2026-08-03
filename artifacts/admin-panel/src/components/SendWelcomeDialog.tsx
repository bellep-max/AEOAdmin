import { useEffect, useState } from "react";
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
import { X, Send, AlertTriangle } from "lucide-react";

/* Manual welcome send. The signup flow mails this automatically; this covers
   what automation can't — a signup from before the automation existed, a send
   that failed, a corrected address, or a hand-onboarded client. Body and
   subject come from the same server-side builder as the automated mail. */

interface PreviewResponse {
  html: string;
  defaultSubject: string;
  business: string;
  firstName: string | null;
  city: string | null;
  isDirect: boolean;
  defaultRecipient: string | null;
  /** Set when a welcome is already on record — guards a duplicate send. */
  alreadySentAt: string | null;
}

interface RecipientsResponse {
  businessName: string | null;
  contactEmail: string | null;
  accountEmail: string | null;
  billingEmail: string | null;
}

interface SendWelcomeDialogProps {
  open: boolean;
  onClose: () => void;
  clientId: number | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SendWelcomeDialog({
  open,
  onClose,
  clientId,
}: SendWelcomeDialogProps) {
  const { toast } = useToast();
  const [recipients, setRecipients] = useState<string[]>([]);
  const [newRecipient, setNewRecipient] = useState("");
  const [subject, setSubject] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    message: string;
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

  const { data: preview, isLoading: previewLoading } =
    useQuery<PreviewResponse>({
      enabled: open && clientId != null,
      queryKey: ["/api/sales/welcome-preview", clientId],
      queryFn: async () => {
        const res = await rawFetch(
          `/api/sales/welcome-preview?clientId=${clientId}`,
        );
        if (!res.ok)
          throw new Error((await res.json()).error ?? "Preview failed");
        return res.json();
      },
    });

  /* Seed recipients from the client's own address once the data lands. */
  useEffect(() => {
    if (!open) return;
    const seed =
      preview?.defaultRecipient ??
      defaults?.accountEmail ??
      defaults?.contactEmail ??
      null;
    if (seed) setRecipients((prev) => (prev.length ? prev : [seed]));
  }, [open, preview?.defaultRecipient, defaults]);

  const addRecipient = () => {
    const v = newRecipient.trim();
    if (!EMAIL_RE.test(v)) {
      toast({ title: "Enter a valid email address", variant: "destructive" });
      return;
    }
    if (!recipients.includes(v)) setRecipients([...recipients, v]);
    setNewRecipient("");
  };
  const removeRecipient = (r: string) =>
    setRecipients(recipients.filter((x) => x !== r));

  const sendMutation = useMutation({
    mutationFn: async () => {
      const res = await rawFetch("/api/sales/send-welcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          recipients,
          ...(subject.trim() ? { subject: subject.trim() } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Send failed");
      return json as {
        deliveredVia: string | null;
        safeModeActive?: boolean;
        recipientsActual: string[];
      };
    },
    onSuccess: (d) => {
      setResult({
        ok: true,
        message: d.safeModeActive
          ? `Safe mode — redirected to ${d.recipientsActual.join(", ")}`
          : `Welcome email sent via ${d.deliveredVia ?? "email"}.`,
      });
      toast({ title: "Welcome email sent" });
    },
    onError: (e: Error) => {
      setResult({ ok: false, message: e.message });
      toast({
        title: "Send failed",
        description: e.message,
        variant: "destructive",
      });
    },
  });

  const handleClose = () => {
    setRecipients([]);
    setNewRecipient("");
    setSubject("");
    setResult(null);
    onClose();
  };

  const canSend =
    recipients.length > 0 && !sendMutation.isPending && preview != null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-[1200px] w-[94vw] h-[92vh] flex flex-col overflow-hidden">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>Send welcome email</DialogTitle>
          <DialogDescription>
            The same welcome the signup flow sends automatically. Use this when
            the automated one didn’t go out, went to the wrong address, or the
            client was onboarded by hand.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4 overflow-hidden min-h-0">
          <div className="overflow-auto space-y-5 pr-1">
            {preview?.alreadySentAt && (
              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>
                  A welcome email was already sent to this client on{" "}
                  {new Date(preview.alreadySentAt).toLocaleString()}. Sending
                  again will deliver a second copy.
                </span>
              </div>
            )}

            <div className="space-y-2">
              <Label>Subject</Label>
              <Input
                placeholder={preview?.defaultSubject ?? "Subject line"}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                Leave blank to use the default: {preview?.defaultSubject ?? "…"}
              </p>
            </div>

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
                {recipients.length === 0 && (
                  <span className="text-xs text-muted-foreground self-center">
                    No recipients yet
                  </span>
                )}
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

            {preview && (
              <div className="text-xs text-muted-foreground space-y-1">
                <p>
                  <span className="font-semibold text-foreground">
                    Template:
                  </span>{" "}
                  {preview.isDirect ? "Direct signup" : "Free trial"}
                  {preview.city ? ` · localized to ${preview.city}` : ""}
                </p>
                <p>
                  <span className="font-semibold text-foreground">
                    Greeting:
                  </span>{" "}
                  {preview.firstName ? `Hi ${preview.firstName},` : "Hi there,"}
                </p>
              </div>
            )}

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

          <div className="border rounded-md flex flex-col overflow-hidden min-h-0">
            <div className="px-3 py-2 border-b bg-muted/40 text-xs font-semibold">
              Client preview
              {preview && (
                <span className="text-muted-foreground font-normal">
                  {" "}
                  · {preview.business}
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
                  Could not build a preview for this client.
                </div>
              )}
              {preview?.html && (
                <iframe
                  title="welcome preview"
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
            {sendMutation.isPending ? "Sending…" : "Send welcome"}
          </Button>
        </DialogFooter>

        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Send the welcome email?</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2 text-sm">
                  <p>This goes to the client now and cannot be unsent.</p>
                  <p>
                    <span className="font-semibold text-foreground">To:</span>{" "}
                    {recipients.join(", ")}
                  </p>
                  {preview?.alreadySentAt && (
                    <p className="text-amber-700">
                      A welcome was already sent on{" "}
                      {new Date(preview.alreadySentAt).toLocaleString()} — this
                      will be a second copy.
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
