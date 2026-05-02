import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { rawFetch } from "@/lib/period-comparison";
import { format } from "date-fns";

interface AuditLogRow {
  id: number;
  keywordId: number;
  keywordText: string | null;
  platform: string;
  status: string;
  rankPosition: number | null;
  timestamp: string;
  durationSeconds: number | null;
  bizName: string | null;
}

const PLATFORM_COLORS: Record<string, string> = {
  chatgpt:    "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  gemini:     "bg-blue-500/10 text-blue-600 border-blue-500/30",
  perplexity: "bg-purple-500/10 text-purple-600 border-purple-500/30",
};

function fmtDuration(s: number | null): string {
  if (s == null) return "—";
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}m ${sec}s`;
}

export function CampaignAuditRankingsCard({ campaignId }: { campaignId: number }) {
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery<AuditLogRow[]>({
    queryKey: ["/api/audit-logs", { campaignId }],
    queryFn: async () => {
      const res = await rawFetch(`/api/audit-logs?campaignId=${campaignId}&limit=200`);
      if (!res.ok) throw new Error("Failed");
      const json = await res.json();
      return (json.logs ?? []) as AuditLogRow[];
    },
    enabled: open,
  });

  return (
    <Card className="border-border/50">
      <button type="button" onClick={() => setOpen(!open)} className="w-full text-left">
        <CardHeader className="pb-3 flex flex-row items-center gap-3">
          {open ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
          )}
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/30 to-amber-500/10 flex items-center justify-center shrink-0">
            <Search className="w-5 h-5 text-amber-600" />
          </div>
          <div className="flex-1 min-w-0">
            <CardTitle className="text-sm font-semibold">Audit Rankings</CardTitle>
            <p className="text-xs text-muted-foreground">
              {data != null ? `${data.length} audit log${data.length !== 1 ? "s" : ""}` : "Click to load"}
            </p>
          </div>
        </CardHeader>
      </button>

      {open && (
        <CardContent className="pt-0 pb-4">
          {isLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
          ) : !data || data.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">No audit rankings yet</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Keyword</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead>Rank</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((a) => {
                  const pc = PLATFORM_COLORS[a.platform] ?? "bg-slate-500/10 text-slate-600 border-slate-500/30";
                  return (
                    <TableRow key={a.id}>
                      <TableCell className="text-xs whitespace-nowrap">
                        {format(new Date(a.timestamp), "MMM d, h:mm a")}
                      </TableCell>
                      <TableCell className="text-sm font-medium max-w-[180px] truncate" title={a.keywordText ?? ""}>
                        {a.keywordText ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge className={`text-[10px] border capitalize ${pc}`} variant="outline">
                          {a.platform}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs font-semibold">
                        {a.rankPosition != null ? `#${a.rankPosition}` : "—"}
                      </TableCell>
                      <TableCell className="text-xs">{a.status}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{fmtDuration(a.durationSeconds)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      )}
    </Card>
  );
}
