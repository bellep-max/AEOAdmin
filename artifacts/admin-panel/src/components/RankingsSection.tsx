import { useState, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart3, ChevronDown, ChevronRight } from "lucide-react";
import { PeriodByBusinessTab } from "@/components/PeriodByBusinessTab";
import { PeriodKeywordsCompact } from "@/components/PeriodKeywordsCompact";
import type { Period } from "@/lib/period-comparison";

type Mode = "by-business" | "compact";

interface Props {
  title?: ReactNode;
  mode: Mode;
  clientId: number | null;
  businessId: number | null;
  aeoPlanId: number | null;
  defaultOpen?: boolean;
}

export function RankingsSection({ title = "Rankings", mode, clientId, businessId, aeoPlanId, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [period, setPeriod] = useState<Period>("weekly");

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-2 hover:text-primary transition-colors"
          >
            {open ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
            <BarChart3 className="w-4 h-4 text-primary" />
            <CardTitle className="text-sm font-semibold">{title}</CardTitle>
          </button>
          {open && (
            <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
              <SelectTrigger className="w-36 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="quarterly">Quarterly</SelectItem>
                <SelectItem value="lifetime">Since start</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>
      </CardHeader>
      {open && (
        <CardContent className="pt-0">
          {mode === "by-business" ? (
            <PeriodByBusinessTab period={period} clientId={clientId} businessId={businessId} aeoPlanId={aeoPlanId} />
          ) : (
            <PeriodKeywordsCompact period={period} clientId={clientId} businessId={businessId} aeoPlanId={aeoPlanId} />
          )}
        </CardContent>
      )}
    </Card>
  );
}
