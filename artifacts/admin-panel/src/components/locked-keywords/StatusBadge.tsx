import { CheckCircle2, Eye, ArrowUpRight, AlertTriangle, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { STATUS_META, type LockedKeywordStatus } from "./types";

const STYLES: Record<LockedKeywordStatus, string> = {
  healthy: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
  monitor: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
  unlock_recommended: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400",
  unlock_now: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
  insufficient_data: "bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-400",
};

const ICONS: Record<LockedKeywordStatus, React.ComponentType<{ className?: string }>> = {
  healthy: CheckCircle2,
  monitor: Eye,
  unlock_recommended: ArrowUpRight,
  unlock_now: AlertTriangle,
  insufficient_data: Info,
};

export function StatusBadge({ status }: { status: LockedKeywordStatus }) {
  const meta = STATUS_META[status];
  const Icon = ICONS[status];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${STYLES[status]}`}
        >
          <Icon className="w-3.5 h-3.5" aria-hidden="true" />
          {meta.label}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs leading-relaxed">{meta.tooltip}</TooltipContent>
    </Tooltip>
  );
}
