import { useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft, ScrollText, AlertTriangle, Sparkles, ArrowUpDown,
} from "lucide-react";
import { rawFetch } from "@/lib/period-comparison";
import { Markdown } from "@/lib/markdown";
import { format } from "date-fns";

interface AuditRec {
  keyword_id: number;
  platform: string;
  movement: string;
  action: string;
  rationale: string;
  priority: "high" | "medium" | "low";
  evidence: string;
}

interface AuditReportDetail {
  id: number;
  reportDate: string;
  scope: string;
  scopeId: number | null;
  modelUsed: string | null;
  inputSummary: Record<string, unknown> | null;
  reportMarkdown: string | null;
  recommendations: AuditRec[] | null;
  generatedAt: string | null;
  durationMs: number | null;
  costUsd: string | null;
}

const PRIORITY_CLS: Record<AuditRec["priority"], string> = {
  high:   "bg-destructive/10 text-destructive border-destructive/30",
  medium: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  low:    "bg-slate-500/10 text-slate-500 border-slate-500/30",
};

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const;

export default function ReportDetail() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);

  const [sortKey, setSortKey] = useState<"priority" | "kid" | "movement">("priority");

  const { data, isLoading, error } = useQuery<AuditReportDetail>({
    queryKey: [`/api/llm/audit-reports/${id}`],
    queryFn: async () => {
      const res = await rawFetch(`/api/llm/audit-reports/${id}`);
      if (!res.ok) throw new Error(`Failed to load report (${res.status})`);
      return res.json();
    },
    enabled: Number.isFinite(id),
  });

  const sortedRecs = useMemo(() => {
    if (!data?.recommendations) return [];
    const list = [...data.recommendations];
    if (sortKey === "priority") list.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
    if (sortKey === "kid") list.sort((a, b) => a.keyword_id - b.keyword_id);
    if (sortKey === "movement") list.sort((a, b) => a.movement.localeCompare(b.movement));
    return list;
  }, [data?.recommendations, sortKey]);

  if (!Number.isFinite(id)) {
    return <div className="p-6 text-sm text-destructive">Invalid report id.</div>;
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Link href="/reports">
          <Button variant="ghost" size="icon" className="mt-0.5">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center flex-shrink-0">
          <ScrollText className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-foreground">
            {data?.reportDate ?? "—"} <span className="text-sm font-normal text-muted-foreground">·</span> <span className="text-sm font-normal text-muted-foreground">audit report</span>
          </h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <Badge variant="outline" className="text-[10px]">
              {data?.scope === "all" ? "All scope" : data?.scopeId != null ? `${data?.scope} #${data?.scopeId}` : (data?.scope ?? "—")}
            </Badge>
            {data?.modelUsed ? <Badge variant="secondary" className="text-[10px]">{data.modelUsed}</Badge> : null}
            {data?.durationMs ? <Badge variant="outline" className="text-[10px]">{(data.durationMs / 1000).toFixed(1)}s</Badge> : null}
            {data?.costUsd ? <Badge variant="outline" className="text-[10px]">${Number(data.costUsd).toFixed(4)}</Badge> : null}
            {data?.generatedAt ? (
              <span className="text-xs text-muted-foreground">
                Generated {format(new Date(data.generatedAt), "MMM d, h:mm a")}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {error ? (
        <Card className="border-destructive/30">
          <CardContent className="p-4 flex items-center gap-2 text-destructive text-sm">
            <AlertTriangle className="w-4 h-4" />
            {(error as Error).message}
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Card className="border-border/50">
          <CardContent className="p-6 text-sm text-muted-foreground">Loading…</CardContent>
        </Card>
      ) : data ? (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          {/* Recommendations */}
          <Card className="border-border/50 lg:col-span-2 self-start">
            <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-primary" />
                  Recommendations
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  {sortedRecs.length} action{sortedRecs.length === 1 ? "" : "s"} · sorted by {sortKey}
                </p>
              </div>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant={sortKey === "priority" ? "default" : "outline"}
                  className="h-7 text-[11px] px-2"
                  onClick={() => setSortKey("priority")}
                >Priority</Button>
                <Button
                  size="sm"
                  variant={sortKey === "kid" ? "default" : "outline"}
                  className="h-7 text-[11px] px-2"
                  onClick={() => setSortKey("kid")}
                >KID</Button>
                <Button
                  size="sm"
                  variant={sortKey === "movement" ? "default" : "outline"}
                  className="h-7 text-[11px] px-2"
                  onClick={() => setSortKey("movement")}
                >
                  <ArrowUpDown className="w-3 h-3" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {!sortedRecs.length ? (
                <div className="p-4 text-sm text-muted-foreground">No structured recommendations parsed.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-14">Pri</TableHead>
                      <TableHead className="w-12">KID</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead className="w-24">Movement</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedRecs.map((r, i) => (
                      <TableRow key={`${r.keyword_id}-${i}`} className="align-top">
                        <TableCell>
                          <Badge variant="outline" className={`text-[10px] border ${PRIORITY_CLS[r.priority]}`}>
                            {r.priority}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs font-mono">{r.keyword_id}</TableCell>
                        <TableCell>
                          <div className="text-xs font-mono text-foreground">{r.action}</div>
                          <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{r.rationale}</div>
                          {r.evidence ? (
                            <div className="text-[10px] text-muted-foreground/80 mt-1 italic leading-snug">{r.evidence}</div>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <div className="text-[10px] text-muted-foreground">{r.movement}</div>
                          <div className="text-[10px] text-muted-foreground/80">{r.platform}</div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Markdown body */}
          <Card className="border-border/50 lg:col-span-3">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Analyst report</CardTitle>
            </CardHeader>
            <CardContent>
              {data.reportMarkdown ? (
                <Markdown source={data.reportMarkdown} />
              ) : (
                <div className="text-sm text-muted-foreground">No markdown body.</div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
