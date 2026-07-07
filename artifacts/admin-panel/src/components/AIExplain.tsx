import { Sparkles } from "lucide-react";
import {
  useExplainPerformance,
  type ExplainSection,
} from "@/lib/explain-performance";

interface Props {
  section: ExplainSection;
  name: string | null | undefined;
  clientId: number | null;
  businessId: number | null;
  aeoPlanId: number | null;
}

/** A small AI "what this means" blurb attached to a single dashboard visual
 *  (the overall stats, the trend chart, the movers list, the platform strip).
 *  Shares one cached network call across every AIExplain on the page. Renders
 *  nothing when there is no ranking data or this section came back empty. */
export function AIExplain({
  section,
  name,
  clientId,
  businessId,
  aeoPlanId,
}: Props) {
  const { data, isLoading, isError, hasData } = useExplainPerformance({
    name,
    clientId,
    businessId,
    aeoPlanId,
  });

  if (!hasData || isError) return null;

  const text = data?.sections?.[section]?.trim();
  // Nothing to explain for this section (e.g. no per-platform data) — stay hidden.
  if (!isLoading && !text) return null;

  return (
    <div className="mt-2 flex items-start gap-2 rounded-md border border-primary/20 bg-primary/[0.04] px-3 py-2">
      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
      {isLoading ? (
        <div className="flex-1 space-y-1.5 py-0.5">
          <div className="h-2.5 w-11/12 animate-pulse rounded bg-muted" />
          <div className="h-2.5 w-3/4 animate-pulse rounded bg-muted" />
        </div>
      ) : (
        <p className="text-xs leading-relaxed text-muted-foreground">
          <span className="font-semibold text-primary">AI: </span>
          {text}
        </p>
      )}
    </div>
  );
}
