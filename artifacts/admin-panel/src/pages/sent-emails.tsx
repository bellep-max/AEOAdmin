import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { rawFetch } from "@/lib/period-comparison";
import { MailCheck, Eye } from "lucide-react";

interface SendRow {
  id: number;
  clientId: number | null;
  clientName: string | null;
  sentAt: string;
  recipients: string[];
  intendedRecipients: string[] | null;
  subject: string;
  status: string;
  kind: string | null;
  meta: {
    keyword?: string;
    platform?: string;
    beforeRank?: number;
    afterRank?: number;
    business?: string;
    mode?: string;
  } | null;
  ghlStatus: string | null;
  error: string | null;
}

interface SendDetail extends SendRow {
  html: string | null;
}

function platformLabel(p: string | undefined): string {
  if (p === "chatgpt") return "ChatGPT";
  if (p === "gemini") return "Gemini";
  if (p === "perplexity") return "Perplexity";
  return p ?? "";
}

function fmtWhen(s: string): string {
  return new Date(s).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

function GhlChip({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs text-muted-foreground">—</span>;
  const posted = status === "posted";
  const failed = status.startsWith("failed");
  return (
    <Badge
      variant="outline"
      className={
        posted
          ? "border-emerald-300 text-emerald-700 bg-emerald-50"
          : failed
            ? "border-red-300 text-red-700 bg-red-50"
            : "border-slate-300 text-slate-600 bg-slate-50"
      }
      title={status}
    >
      {posted ? "GHL ✓" : failed ? "GHL ✗" : status}
    </Badge>
  );
}

export default function SentEmails() {
  const [kind, setKind] = useState<string>("all");
  const [viewId, setViewId] = useState<number | null>(null);

  const { data, isLoading } = useQuery<{ sends: SendRow[] }>({
    queryKey: ["/api/sales/email-sends", kind],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (kind !== "all") p.set("kind", kind);
      const res = await rawFetch(`/api/sales/email-sends?${p}`);
      if (!res.ok) throw new Error("Failed to load sent emails");
      return res.json();
    },
  });

  const { data: detail, isFetching: detailLoading } = useQuery<SendDetail>({
    enabled: viewId != null,
    queryKey: ["/api/sales/email-sends", "detail", viewId],
    queryFn: async () => {
      const res = await rawFetch(`/api/sales/email-sends/${viewId}`);
      if (!res.ok) throw new Error("Failed to load email");
      return res.json();
    },
  });

  const sends = data?.sends ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center">
            <MailCheck className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Sent Emails</h1>
            <p className="text-sm text-muted-foreground">
              Every report & sales email sent from the admin panel — click one
              to see exactly what the recipient got.
            </p>
          </div>
        </div>
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All kinds</SelectItem>
            <SelectItem value="sales">Sales emails</SelectItem>
            <SelectItem value="report">Ranking reports</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="grid grid-cols-12 gap-2 px-4 py-2 text-[11px] uppercase tracking-wide text-muted-foreground border-b">
            <div className="col-span-2">Sent</div>
            <div className="col-span-2">Client</div>
            <div className="col-span-3">Subject</div>
            <div className="col-span-2">Proof</div>
            <div className="col-span-1">Kind</div>
            <div className="col-span-1">Status</div>
            <div className="col-span-1" />
          </div>
          {isLoading && (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          )}
          {!isLoading && sends.length === 0 && (
            <div className="p-6 text-sm text-muted-foreground">
              No emails sent yet.
            </div>
          )}
          {sends.map((s) => (
            <div
              key={s.id}
              className="grid grid-cols-12 gap-2 px-4 py-2.5 items-center text-sm border-b last:border-b-0 hover:bg-muted/30"
            >
              <div className="col-span-2 text-xs text-muted-foreground">
                {fmtWhen(s.sentAt)}
              </div>
              <div className="col-span-2 truncate font-medium">
                {s.clientName ?? "—"}
              </div>
              <div className="col-span-3 truncate" title={s.subject}>
                {s.subject}
              </div>
              <div className="col-span-2 text-xs text-muted-foreground truncate">
                {s.meta?.keyword ? (
                  <>
                    “{s.meta.keyword}” · #{s.meta.beforeRank} → #
                    {s.meta.afterRank} {platformLabel(s.meta.platform)}
                  </>
                ) : (
                  (s.meta?.mode ?? "—")
                )}
              </div>
              <div className="col-span-1">
                <Badge variant="secondary" className="capitalize">
                  {s.kind ?? "—"}
                </Badge>
              </div>
              <div className="col-span-1 flex flex-col gap-1">
                <Badge
                  variant="outline"
                  className={
                    s.status === "sent"
                      ? "border-emerald-300 text-emerald-700 bg-emerald-50"
                      : "border-red-300 text-red-700 bg-red-50"
                  }
                >
                  {s.status}
                </Badge>
                {s.kind === "sales" && <GhlChip status={s.ghlStatus} />}
              </div>
              <div className="col-span-1 text-right">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={() => setViewId(s.id)}
                >
                  <Eye className="w-3.5 h-3.5" /> View
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={viewId != null} onOpenChange={(o) => !o && setViewId(null)}>
        <DialogContent className="max-w-4xl h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>{detail?.subject ?? "Sent email"}</DialogTitle>
            <DialogDescription>
              {detail
                ? `Sent ${fmtWhen(detail.sentAt)} to ${(detail.intendedRecipients ?? detail.recipients).join(", ")}`
                : "Loading…"}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0 border rounded-md overflow-hidden bg-white">
            {detailLoading && (
              <div className="p-4 text-sm text-muted-foreground">Loading…</div>
            )}
            {detail?.html ? (
              <iframe
                title="sent email"
                srcDoc={detail.html}
                className="w-full h-full border-0"
              />
            ) : (
              !detailLoading && (
                <div className="p-4 text-sm text-muted-foreground">
                  No stored copy for this send (sent before archiving was
                  added).
                </div>
              )
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
