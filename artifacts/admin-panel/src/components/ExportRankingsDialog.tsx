import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Loader2, Download, FileDown } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  fmtDayET,
  rawFetch,
  buildPeriodUrl,
  type Period,
  type PeriodResponse,
} from "@/lib/period-comparison";

export type CompareMode = "period" | "lifetime";

export interface ExportClientRow {
  id: number;
  businessName: string;
}
export interface ExportBusinessRow {
  id: number;
  clientId: number;
  name: string;
}
export interface ExportPlanRow {
  id: number;
  clientId: number;
  businessId: number | null;
  name: string | null;
  planType: string;
}

export interface ExportFiltersValue {
  clientId: number | null;
  businessId: number | null;
  aeoPlanId: number | null;
  period: Period;
  compareMode: CompareMode;
  auditDate: string;
  comparisonOnly: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "csv" | "pdf";
  defaults: ExportFiltersValue;
  clients: ExportClientRow[];
  businesses: ExportBusinessRow[];
  plans: ExportPlanRow[];
  onConfirm: (values: ExportFiltersValue) => Promise<void> | void;
}

const byName = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? "").localeCompare(b ?? "", undefined, { sensitivity: "base" });

export function ExportRankingsDialog({
  open,
  onOpenChange,
  mode,
  defaults,
  clients,
  businesses,
  plans,
  onConfirm,
}: Props) {
  const [vals, setVals] = useState<ExportFiltersValue>(defaults);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setVals(defaults);
      setSubmitting(false);
    }
  }, [open, defaults]);

  const effectivePeriod: Period =
    vals.compareMode === "lifetime" ? "lifetime" : vals.period;

  const clientsSorted = useMemo(
    () => [...clients].sort((a, b) => byName(a.businessName, b.businessName)),
    [clients],
  );
  const businessScope = useMemo(
    () =>
      businesses
        .filter((b) => vals.clientId === null || b.clientId === vals.clientId)
        .sort((a, b) => byName(a.name, b.name)),
    [businesses, vals.clientId],
  );
  const planScope = useMemo(
    () =>
      plans
        .filter(
          (p) =>
            (vals.clientId === null || p.clientId === vals.clientId) &&
            (vals.businessId === null || p.businessId === vals.businessId),
        )
        .sort((a, b) => byName(a.name ?? a.planType, b.name ?? b.planType)),
    [plans, vals.clientId, vals.businessId],
  );

  // Live preview row count + available audit dates for the current scope
  const { data: preview, isFetching } = useQuery<PeriodResponse>({
    enabled: open,
    queryKey: [
      "export-preview",
      effectivePeriod,
      vals.clientId,
      vals.businessId,
      vals.aeoPlanId,
    ],
    queryFn: async () => {
      const res = await rawFetch(
        buildPeriodUrl({
          period: effectivePeriod,
          clientId: vals.clientId,
          businessId: vals.businessId,
          aeoPlanId: vals.aeoPlanId,
        }),
      );
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const auditDates = useMemo<string[]>(() => {
    const set = new Set<string>();
    for (const r of preview?.rows ?? []) {
      if (r.currentDate) set.add(r.currentDate.slice(0, 10));
    }
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [preview]);

  // Count rows after applying audit-date + comparison-only filters.
  // Mirrors filterByCurrentDate + filterComparisonOnly in rankings.tsx.
  const filteredCount = useMemo(() => {
    if (!preview?.rows) return 0;
    let rows = preview.rows;
    if (vals.auditDate !== "all") {
      rows = rows.filter(
        (r) => (r.currentDate ?? "").slice(0, 10) === vals.auditDate,
      );
    }
    if (vals.comparisonOnly) {
      const kwWithPrev = new Set<number>();
      for (const r of rows) {
        if (r.previousPosition != null) kwWithPrev.add(r.keywordId);
      }
      rows = rows.filter((r) => kwWithPrev.has(r.keywordId));
    }
    return rows.length;
  }, [preview, vals.auditDate, vals.comparisonOnly]);

  const set = <K extends keyof ExportFiltersValue>(
    k: K,
    v: ExportFiltersValue[K],
  ) => setVals((p) => ({ ...p, [k]: v }));

  async function handleExport() {
    setSubmitting(true);
    try {
      await onConfirm(vals);
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  const Icon = mode === "pdf" ? FileDown : Download;
  const title = mode === "pdf" ? "Export PDF" : "Export CSV";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px] bg-white max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 border border-blue-200 flex items-center justify-center shrink-0">
              <Icon className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold text-black">
                {title}
              </DialogTitle>
              <DialogDescription className="text-sm text-slate-600 mt-0.5">
                Review or change the filter scope before exporting. Changes here
                don&apos;t affect the page.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Scope: client → business → campaign */}
          <div className="grid grid-cols-1 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-slate-600 font-semibold">
                Client
              </Label>
              <Select
                value={vals.clientId !== null ? String(vals.clientId) : "all"}
                onValueChange={(v) => {
                  const next = v === "all" ? null : Number(v);
                  setVals((p) => ({
                    ...p,
                    clientId: next,
                    businessId: null,
                    aeoPlanId: null,
                  }));
                }}
              >
                <SelectTrigger className="h-10 bg-slate-50 text-black">
                  <SelectValue placeholder="All Clients" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Clients</SelectItem>
                  {clientsSorted.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.businessName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-slate-600 font-semibold">
                Business
              </Label>
              <Select
                value={
                  vals.businessId !== null ? String(vals.businessId) : "all"
                }
                onValueChange={(v) => {
                  const next = v === "all" ? null : Number(v);
                  setVals((p) => ({
                    ...p,
                    businessId: next,
                    aeoPlanId: null,
                  }));
                }}
                disabled={businessScope.length === 0}
              >
                <SelectTrigger className="h-10 bg-slate-50 text-black">
                  <SelectValue placeholder="All Businesses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Businesses</SelectItem>
                  {businessScope.map((b) => (
                    <SelectItem key={b.id} value={String(b.id)}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-slate-600 font-semibold">
                Campaign
              </Label>
              <Select
                value={vals.aeoPlanId !== null ? String(vals.aeoPlanId) : "all"}
                onValueChange={(v) =>
                  set("aeoPlanId", v === "all" ? null : Number(v))
                }
                disabled={planScope.length === 0}
              >
                <SelectTrigger className="h-10 bg-slate-50 text-black">
                  <SelectValue placeholder="All Campaigns" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Campaigns</SelectItem>
                  {planScope.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name ?? p.planType}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Period + lifetime toggle */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-slate-600 font-semibold">
                Compare against
              </Label>
              <Select
                value={vals.compareMode}
                onValueChange={(v) => set("compareMode", v as CompareMode)}
              >
                <SelectTrigger className="h-10 bg-slate-50 text-black">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="period">Prior period</SelectItem>
                  <SelectItem value="lifetime">
                    Since start (lifetime)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-slate-600 font-semibold">
                Period
              </Label>
              <Select
                value={vals.period}
                onValueChange={(v) => set("period", v as Period)}
                disabled={vals.compareMode === "lifetime"}
              >
                <SelectTrigger className="h-10 bg-slate-50 text-black">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="weekly">Biweekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Audit-date + comparison-only */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-slate-600 font-semibold">
                Audit date
              </Label>
              <Select
                value={vals.auditDate}
                onValueChange={(v) => set("auditDate", v)}
              >
                <SelectTrigger className="h-10 bg-slate-50 text-black">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All audits</SelectItem>
                  {auditDates.map((d, i) => (
                    <SelectItem key={d} value={d}>
                      {fmtDayET(d)}
                      {i === 0 ? " (latest)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-slate-600 font-semibold">
                Comparison only
              </Label>
              <div className="h-10 flex items-center gap-2">
                <Switch
                  checked={vals.comparisonOnly}
                  onCheckedChange={(v) => set("comparisonOnly", v)}
                />
                <span className="text-sm text-slate-700">
                  {vals.comparisonOnly ? "Yes" : "No"}
                </span>
              </div>
            </div>
          </div>

          {/* Summary preview */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-slate-600 font-semibold">
                Rows to export
              </span>
              {isFetching ? (
                <span className="text-slate-500 flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  loading…
                </span>
              ) : (
                <Badge
                  variant={filteredCount > 0 ? "default" : "destructive"}
                  className="text-sm"
                >
                  {filteredCount.toLocaleString()}
                </Badge>
              )}
            </div>
            {preview?.window ? (
              <div className="text-xs text-slate-500 mt-1.5">
                Window: {fmtDayET(preview.window.currentStart)}–
                {fmtDayET(preview.window.currentEnd)} vs{" "}
                {fmtDayET(preview.window.previousStart)}–
                {fmtDayET(preview.window.previousEnd)}
              </div>
            ) : null}
          </div>
        </div>

        <div className="pt-4 flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleExport}
            disabled={submitting || isFetching || filteredCount === 0}
            className="h-10 text-base font-bold"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Exporting…
              </>
            ) : (
              <>
                <Icon className="w-4 h-4 mr-1.5" />
                Export {mode.toUpperCase()}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
