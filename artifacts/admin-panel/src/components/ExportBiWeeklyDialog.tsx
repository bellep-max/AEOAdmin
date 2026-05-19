import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { Badge } from "@/components/ui/badge";
import { Loader2, Download, FileDown } from "lucide-react";
import { rawFetch, fmtDayET } from "@/lib/period-comparison";
import type { BiWeeklyReport } from "@/components/BiWeeklyReportTab";

export interface BiWeeklyClientRow {
  id: number;
  businessName: string;
}
export interface BiWeeklyBusinessRow {
  id: number;
  clientId: number;
  name: string;
}
export interface BiWeeklyPlanRow {
  id: number;
  clientId: number;
  businessId: number | null;
  name: string | null;
  planType: string;
}

export interface BiWeeklyExportValue {
  clientId: number | null;
  businessId: number | null;
  aeoPlanId: number | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "csv" | "pdf";
  defaults: BiWeeklyExportValue;
  clients: BiWeeklyClientRow[];
  businesses: BiWeeklyBusinessRow[];
  plans: BiWeeklyPlanRow[];
  onConfirm: (
    values: BiWeeklyExportValue,
    report: BiWeeklyReport,
  ) => Promise<void> | void;
}

const byName = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? "").localeCompare(b ?? "", undefined, { sensitivity: "base" });

export function ExportBiWeeklyDialog({
  open,
  onOpenChange,
  mode,
  defaults,
  clients,
  businesses,
  plans,
  onConfirm,
}: Props) {
  const [vals, setVals] = useState<BiWeeklyExportValue>(defaults);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setVals(defaults);
      setSubmitting(false);
    }
  }, [open, defaults]);

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

  // Live row count + window preview by hitting the bi-weekly endpoint.
  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (vals.clientId !== null) p.set("clientId", String(vals.clientId));
    if (vals.businessId !== null) p.set("businessId", String(vals.businessId));
    if (vals.aeoPlanId !== null) p.set("aeoPlanId", String(vals.aeoPlanId));
    return p.toString();
  }, [vals]);

  const { data: preview, isFetching } = useQuery<BiWeeklyReport>({
    enabled: open,
    queryKey: ["export-bi-weekly-preview", qs],
    queryFn: async () => {
      const res = await rawFetch(
        `/api/ranking-reports/bi-weekly-report${qs ? `?${qs}` : ""}`,
      );
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const comboCount = preview?.details?.oldCombos?.length ?? 0;

  async function handleExport() {
    if (!preview) return;
    setSubmitting(true);
    try {
      await onConfirm(vals, preview);
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  const Icon = mode === "pdf" ? FileDown : Download;
  const title =
    mode === "pdf" ? "Export Bi-Weekly PDF" : "Export Bi-Weekly CSV";

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
                Review or change scope before exporting. Changes here don&apos;t
                affect the page.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="grid grid-cols-1 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-slate-600 font-semibold">
                Client
              </Label>
              <Select
                value={vals.clientId !== null ? String(vals.clientId) : "all"}
                onValueChange={(v) => {
                  const next = v === "all" ? null : Number(v);
                  setVals({
                    clientId: next,
                    businessId: null,
                    aeoPlanId: null,
                  });
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
                  setVals((p) => ({ ...p, businessId: next, aeoPlanId: null }));
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
                  setVals((p) => ({
                    ...p,
                    aeoPlanId: v === "all" ? null : Number(v),
                  }))
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

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-slate-600 font-semibold">
                Combos to export
              </span>
              {isFetching ? (
                <span className="text-slate-500 flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  loading…
                </span>
              ) : (
                <Badge
                  variant={comboCount > 0 ? "default" : "destructive"}
                  className="text-sm"
                >
                  {comboCount.toLocaleString()}
                </Badge>
              )}
            </div>
            {preview?.currentBatch ? (
              <div className="text-xs text-slate-500 mt-1.5">
                Latest batch: {fmtDayET(preview.currentBatch.batchDate)} · Next
                due: {fmtDayET(preview.currentBatch.nextDueDate)}
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
            disabled={submitting || isFetching || comboCount === 0}
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
