import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Trophy, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { rawFetch } from "@/lib/api-fetch";
import { useToast } from "@/hooks/use-toast";
import { LockedKeywordTable } from "./LockedKeywordTable";
import { LockedKeywordDetailDrawer } from "./LockedKeywordDetailDrawer";
import { UnlockConfirmationDialog } from "./UnlockConfirmationDialog";
import type { LockedKeywordListResponse, LockedKeywordRecord } from "./types";

/* Campaign-scoped slice of the Locked Keyword Monitoring page: the same
   retention/status table, detail drawer, and unlock flow, pre-filtered to one
   campaign. Renders nothing when the campaign has no locked keywords. */

interface CampaignLockedMonitoringCardProps {
  aeoPlanId: number;
}

export function CampaignLockedMonitoringCard({
  aeoPlanId,
}: CampaignLockedMonitoringCardProps) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [sort, setSort] = useState("");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selected, setSelected] = useState<LockedKeywordRecord | null>(null);
  const [unlockTarget, setUnlockTarget] = useState<{
    record: LockedKeywordRecord;
    suggestedReason?: string;
  } | null>(null);

  const queryKey = [
    "locked-keywords",
    "campaign",
    aeoPlanId,
    sort,
    direction,
    page,
    pageSize,
  ];
  const { data, isLoading } = useQuery<LockedKeywordListResponse>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({
        aeoPlanId: String(aeoPlanId),
        page: String(page),
        pageSize: String(pageSize),
      });
      if (sort) {
        params.set("sort", sort);
        params.set("direction", direction);
      }
      const r = await rawFetch(`/api/admin/locked-keywords?${params}`);
      if (!r.ok) throw new Error("Failed to load locked keywords");
      return r.json();
    },
    enabled: !!aeoPlanId,
  });

  if (!isLoading && (data?.summary?.totalLocked ?? 0) === 0) return null;

  const s = data?.summary;

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Trophy className="w-4 h-4 text-emerald-500" />
            Locked Keyword Monitoring · this campaign
            {s && <Badge variant="secondary">{s.totalLocked}</Badge>}
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            {s && s.unlockNow > 0 && (
              <Badge variant="destructive">{s.unlockNow} unlock now</Badge>
            )}
            {s && s.unlockRecommended > 0 && (
              <Badge className="border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-400">
                {s.unlockRecommended} unlock recommended
              </Badge>
            )}
            {s && s.monitor > 0 && (
              <Badge variant="outline">{s.monitor} monitor</Badge>
            )}
            {s && s.healthy > 0 && (
              <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                {s.healthy} healthy
              </Badge>
            )}
            <Link
              href={`/keyword-rotation/locked?aeoPlanId=${aeoPlanId}`}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Full view <ExternalLink className="w-3 h-3" />
            </Link>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <LockedKeywordTable
          data={data}
          isLoading={isLoading}
          hasActiveFilters={false}
          sort={sort}
          direction={direction}
          onSortChange={(key) => {
            if (sort === key) {
              setDirection((d) => (d === "asc" ? "desc" : "asc"));
            } else {
              setSort(key);
              setDirection("asc");
            }
          }}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
          onRowClick={setSelected}
        />

        <LockedKeywordDetailDrawer
          record={selected}
          onOpenChange={(open) => !open && setSelected(null)}
          onUnlockClick={(record) => setUnlockTarget({ record })}
        />

        <UnlockConfirmationDialog
          record={unlockTarget?.record ?? null}
          defaultReason={unlockTarget?.suggestedReason}
          onOpenChange={(open) => !open && setUnlockTarget(null)}
          onUnlocked={() => {
            qc.invalidateQueries({ queryKey: ["locked-keywords"] });
            setSelected(null);
            setUnlockTarget(null);
            toast({
              title: "Keyword unlocked and returned to active rotation.",
            });
          }}
        />
      </CardContent>
    </Card>
  );
}
