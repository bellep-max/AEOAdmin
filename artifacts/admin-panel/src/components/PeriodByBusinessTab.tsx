import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight, Building2 } from "lucide-react";
import {
  usePeriodComparison,
  countStatuses,
  fmtPos,
  periodLabel,
  type Period,
  type PeriodRow,
} from "@/lib/period-comparison";
import { StatusBadge, PlatformPill, ChangeCell } from "@/components/period-badges";

interface Props {
  period: Period;
  clientId: number | null;
  businessId: number | null;
  aeoPlanId: number | null;
}

interface BusinessGroup {
  businessId: number;
  businessName: string;
  clientId: number | null;
  clientName: string | null;
  rows: PeriodRow[];
}

const UNASSIGNED = 0;

export function PeriodByBusinessTab({ period, clientId, businessId, aeoPlanId }: Props) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const { data, isLoading } = usePeriodComparison({ period, clientId, businessId, aeoPlanId });
  const label = periodLabel(period);

  const groups = useMemo<BusinessGroup[]>(() => {
    const map = new Map<number, BusinessGroup>();
    for (const r of data?.rows ?? []) {
      const bid = r.businessId ?? UNASSIGNED;
      const existing = map.get(bid);
      if (existing) existing.rows.push(r);
      else
        map.set(bid, {
          businessId: bid,
          businessName: r.businessName ?? "Unassigned",
          clientId: r.clientId,
          clientName: r.clientName,
          rows: [r],
        });
    }
    return [...map.values()].sort((a, b) => {
      const ac = (a.clientName ?? "").toLowerCase();
      const bc = (b.clientName ?? "").toLowerCase();
      if (ac !== bc) return ac.localeCompare(bc);
      return a.businessName.toLowerCase().localeCompare(b.businessName.toLowerCase());
    });
  }, [data]);

  function toggle(bid: number): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(bid)) next.delete(bid);
      else next.add(bid);
      return next;
    });
  }

  if (isLoading) {
    return <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>;
  }
  if (!data || data.rows.length === 0) {
    return (
      <Card className="border-border/50">
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          No ranking data for {label.long.toLowerCase()} yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {groups.map((g) => {
        const isOpen = expanded.has(g.businessId);
        const counts = countStatuses(g.rows);
        const keywordCount = new Set(g.rows.map((r) => r.keywordId)).size;
        return (
          <Card key={g.businessId} className="border-border/50 overflow-hidden">
            <button type="button" onClick={() => toggle(g.businessId)} className="w-full text-left">
              <CardHeader className="pb-3 flex flex-row items-center gap-3">
                {isOpen ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center shrink-0">
                  <Building2 className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <CardTitle className="text-sm font-semibold truncate">{g.businessName}</CardTitle>
                  <p className="text-xs text-muted-foreground truncate">Client: {g.clientName ?? "—"}</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap shrink-0">
                  <Badge variant="outline" className="text-[10px]">{keywordCount} keyword{keywordCount !== 1 ? "s" : ""}</Badge>
                  {counts.improved > 0 && <Badge className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 text-[10px]">↑ {counts.improved}</Badge>}
                  {counts.declined > 0 && <Badge className="bg-red-500/20 text-red-700 dark:text-red-300 border-red-500/30 text-[10px]">↓ {counts.declined}</Badge>}
                  {counts.steady > 0 && <Badge variant="outline" className="text-[10px]">= {counts.steady}</Badge>}
                  {counts.newCount > 0 && <Badge className="bg-blue-500/20 text-blue-700 dark:text-blue-300 border-blue-500/30 text-[10px]">+ {counts.newCount}</Badge>}
                </div>
              </CardHeader>
            </button>
            {isOpen && (
              <CardContent className="pt-0 pb-4">
                <div className="grid grid-cols-12 gap-2 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-2 pb-2">
                  <div className="col-span-4">Keyword</div>
                  <div className="col-span-2">Platform</div>
                  <div className="col-span-2">{label.previousLabel}</div>
                  <div className="col-span-2">{label.currentLabel}</div>
                  <div className="col-span-1">Change</div>
                  <div className="col-span-1">Status</div>
                </div>
                <div className="space-y-1">
                  {[...g.rows]
                    .sort((a, b) => a.keywordText.localeCompare(b.keywordText) || a.platform.localeCompare(b.platform))
                    .map((r) => (
                      <div key={`${r.keywordId}-${r.platform}`} className="grid grid-cols-12 gap-2 items-center text-sm px-2 py-1.5 rounded bg-muted/20">
                        <div className="col-span-4 truncate font-medium">{r.keywordText}</div>
                        <div className="col-span-2"><PlatformPill platform={r.platform} /></div>
                        <div className="col-span-2 text-muted-foreground">{fmtPos(r.previousPosition)}</div>
                        <div className="col-span-2 font-semibold">{fmtPos(r.currentPosition)}</div>
                        <div className="col-span-1"><ChangeCell change={r.change} /></div>
                        <div className="col-span-1"><StatusBadge status={r.status} /></div>
                      </div>
                    ))}
                </div>
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
