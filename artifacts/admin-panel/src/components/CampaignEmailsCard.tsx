import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { rawFetch } from "@/lib/period-comparison";
import { Mail, Reply, Send } from "lucide-react";

/* The campaign's slice of the Sent Emails page: every send attached to this
   campaign (via its keyword), plus the client's campaign-less sends (welcome).
   A selected email can be replied to — the reply follows the same GHL-first
   delivery as other sends, so it threads into the contact's conversation. */

interface SendRow {
  id: number;
  sentAt: string | null;
  subject: string | null;
  status: string;
  latestStatus: string | null;
  kind: string | null;
  recipients: string[] | null;
  intendedRecipients: string[] | null;
  deliveredVia: string | null;
  meta: { template?: string; keyword?: string } | null;
}

interface CampaignEmailsCardProps {
  clientId: number;
  aeoPlanId: number;
}

function typeLabel(row: SendRow): string {
  if (row.kind === "welcome") return "Welcome";
  if (row.kind === "report") return "Ranking Report";
  if (row.kind === "sales") {
    const t = row.meta?.template;
    if (t === "first_proof") return "First Proof";
    if (t === "free_trial_proof") return "Free-Trial Proof";
    if (t === "second_keyword") return "Founder's Discount";
    if (t === "reply") return "Reply";
    return "Sales";
  }
  return row.kind ?? "—";
}

export function CampaignEmailsCard({
  clientId,
  aeoPlanId,
}: CampaignEmailsCardProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [replyTo, setReplyTo] = useState<SendRow | null>(null);
  const [replySubject, setReplySubject] = useState("");
  const [replyMessage, setReplyMessage] = useState("");

  const queryKey = [
    "/api/sales/email-sends",
    "campaign",
    clientId,
    aeoPlanId,
  ] as const;
  const { data, isLoading } = useQuery<{ sends: SendRow[] }>({
    queryKey,
    queryFn: async () => {
      const res = await rawFetch(
        `/api/sales/email-sends?clientId=${clientId}&aeoPlanId=${aeoPlanId}`,
      );
      if (!res.ok) throw new Error("Failed to load campaign emails");
      return res.json();
    },
    enabled: !!clientId && !!aeoPlanId,
  });
  const sends = data?.sends ?? [];

  const replyMutation = useMutation({
    mutationFn: async () => {
      if (!replyTo) throw new Error("No email selected");
      const res = await rawFetch(`/api/sales/email-sends/${replyTo.id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: replyMessage.trim(),
          subject: replySubject.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Reply failed");
      return body as { safeModeActive?: boolean; recipientsActual: string[] };
    },
    onSuccess: (r) => {
      toast({
        title: r.safeModeActive
          ? `Safe mode: reply sent to ${r.recipientsActual.join(", ")}`
          : "Reply sent",
      });
      setReplyTo(null);
      setReplyMessage("");
      setReplySubject("");
      qc.invalidateQueries({ queryKey });
    },
    onError: (err: unknown) => {
      toast({
        title: err instanceof Error ? err.message : "Reply failed",
        variant: "destructive",
      });
    },
  });

  function openReply(row: SendRow) {
    const base = (row.subject ?? "").replace(/^\[TEST[^\]]*\]\s*/, "");
    setReplyTo(row);
    setReplySubject(base.startsWith("Re:") ? base : `Re: ${base}`);
    setReplyMessage("");
  }

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-4">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Mail className="w-4 h-4 text-primary" />
          Sent Emails · this campaign
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading && (
          <p className="px-4 pb-4 text-sm text-muted-foreground">Loading…</p>
        )}
        {!isLoading && sends.length === 0 && (
          <p className="px-4 pb-4 text-sm text-muted-foreground">
            No emails sent for this campaign yet.
          </p>
        )}
        {sends.length > 0 && (
          <div className="overflow-x-auto">
            <div className="min-w-[640px]">
              <div className="grid grid-cols-12 gap-2 px-4 py-2 text-[11px] uppercase tracking-wide text-muted-foreground border-b">
                <div className="col-span-2">Sent</div>
                <div className="col-span-2">Type</div>
                <div className="col-span-4">Subject</div>
                <div className="col-span-2">To</div>
                <div className="col-span-1">Status</div>
                <div className="col-span-1" />
              </div>
              {sends.map((s) => (
                <div
                  key={s.id}
                  className="grid grid-cols-12 gap-2 px-4 py-2.5 text-sm border-b last:border-b-0 items-center"
                >
                  <div className="col-span-2 text-muted-foreground whitespace-nowrap">
                    {s.sentAt ? format(new Date(s.sentAt), "MMM d, yyyy") : "—"}
                  </div>
                  <div className="col-span-2">
                    <Badge variant="secondary">{typeLabel(s)}</Badge>
                  </div>
                  <div className="col-span-4 truncate" title={s.subject ?? ""}>
                    {s.subject ?? "—"}
                  </div>
                  <div
                    className="col-span-2 truncate text-muted-foreground"
                    title={(s.intendedRecipients ?? s.recipients ?? []).join(
                      ", ",
                    )}
                  >
                    {(s.intendedRecipients ?? s.recipients ?? []).join(", ") ||
                      "—"}
                  </div>
                  <div className="col-span-1">
                    <Badge
                      variant={
                        (s.latestStatus ?? s.status) === "failed"
                          ? "destructive"
                          : "outline"
                      }
                      className="capitalize"
                    >
                      {s.latestStatus ?? s.status}
                    </Badge>
                  </div>
                  <div className="col-span-1 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 text-xs"
                      onClick={() => openReply(s)}
                    >
                      <Reply className="w-3.5 h-3.5" /> Reply
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>

      <Dialog open={replyTo != null} onOpenChange={(o) => !o && setReplyTo(null)}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Reply to email</DialogTitle>
            <DialogDescription>
              Goes to the original recipients (
              {(replyTo?.intendedRecipients ?? replyTo?.recipients ?? []).join(
                ", ",
              )}
              ) via the usual delivery route.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Subject</Label>
              <Input
                value={replySubject}
                onChange={(e) => setReplySubject(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Message</Label>
              <Textarea
                rows={7}
                placeholder="Write your reply…"
                value={replyMessage}
                onChange={(e) => setReplyMessage(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReplyTo(null)}>
              Cancel
            </Button>
            <Button
              className="gap-1.5"
              disabled={!replyMessage.trim() || replyMutation.isPending}
              onClick={() => replyMutation.mutate()}
            >
              <Send className="w-4 h-4" />
              {replyMutation.isPending ? "Sending…" : "Send reply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
