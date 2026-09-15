import { ArrowUp, ArrowDown, ChevronLeft, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "./StatusBadge";
import { RetentionCell } from "./RetentionCell";
import { DueDateCell } from "./DueDateCell";
import { PlatformCoverageCell } from "./PlatformCoverageCell";
import type { LockedKeywordRecord, LockedKeywordListResponse } from "./types";

type SortKey = "retention" | "dueDate" | "lastValidCheckAt" | "consecutiveAbsent" | "lockedAt";

const SORTABLE_COLUMNS: { key: SortKey; label: string }[] = [
  { key: "retention", label: "Retention" },
  { key: "dueDate", label: "Next Check Due" },
  { key: "lastValidCheckAt", label: "Last Valid Check" },
  { key: "consecutiveAbsent", label: "Consecutive Absent" },
  { key: "lockedAt", label: "Locked Since" },
];

function SortableHead({
  label,
  sortKey,
  activeSort,
  direction,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  activeSort: string;
  direction: "asc" | "desc";
  onSort: (key: SortKey) => void;
}) {
  const active = activeSort === sortKey;
  return (
    <TableHead>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="flex items-center gap-1 text-[11px] uppercase tracking-wide font-semibold text-muted-foreground hover:text-foreground transition-colors"
      >
        {label}
        {active && (direction === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
      </button>
    </TableHead>
  );
}

export function LockedKeywordTable({
  data,
  isLoading,
  hasActiveFilters,
  sort,
  direction,
  onSortChange,
  onPageChange,
  onPageSizeChange,
  onRowClick,
}: {
  data: LockedKeywordListResponse | undefined;
  isLoading: boolean;
  hasActiveFilters: boolean;
  sort: string;
  direction: "asc" | "desc";
  onSortChange: (key: SortKey) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onRowClick: (record: LockedKeywordRecord) => void;
}) {
  if (isLoading) {
    return <div className="space-y-2">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>;
  }

  if (!data || data.items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-2 border rounded-lg">
        <p className="text-sm font-medium">
          {hasActiveFilters ? "No locked keywords match the selected filters." : "No locked keyword variants found."}
        </p>
        <p className="text-xs opacity-70 max-w-sm">
          {hasActiveFilters
            ? "Try clearing a filter."
            : "Keywords appear here once they lock — every AI platform holding Top 1–3 for two consecutive bi-weekly runs."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="border rounded-lg overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client / Business</TableHead>
              <TableHead>Keyword</TableHead>
              <TableHead>Platform Coverage</TableHead>
              {SORTABLE_COLUMNS.slice(0, 3).map((c) => (
                <SortableHead key={c.key} label={c.label} sortKey={c.key} activeSort={sort} direction={direction} onSort={onSortChange} />
              ))}
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.map((r) => (
              <TableRow key={r.id} className="cursor-pointer hover:bg-muted/40" onClick={() => onRowClick(r)}>
                <TableCell className="max-w-[160px]">
                  <p className="text-sm font-medium truncate">{r.clientName ?? "—"}</p>
                  {r.businessName && <p className="text-xs text-muted-foreground truncate">{r.businessName}</p>}
                </TableCell>
                <TableCell className="max-w-[200px]">
                  <p className="text-sm truncate">{r.keywordText}</p>
                  {r.campaignName && <p className="text-xs text-muted-foreground truncate">{r.campaignName}</p>}
                </TableCell>
                <TableCell><PlatformCoverageCell platformChecks={r.platformChecks} /></TableCell>
                <TableCell><RetentionCell retentionRate={r.retentionRate} topThreeChecks={r.topThreeChecks} validChecks={r.validChecks} /></TableCell>
                <TableCell><DueDateCell nextCheckDueAt={r.nextCheckDueAt} nextCheckDueNow={r.nextCheckDueNow} /></TableCell>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {r.lastValidCheckAt ? format(new Date(r.lastValidCheckAt), "MMM d, yyyy") : "—"}
                </TableCell>
                <TableCell><StatusBadge status={r.status} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between gap-4 flex-wrap text-sm">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Rows per page</span>
          <Select value={String(data.pagination.pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
            <SelectTrigger className="w-20 h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="25">25</SelectItem>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="100">100</SelectItem>
            </SelectContent>
          </Select>
          <span>
            {data.pagination.totalItems === 0
              ? "0 results"
              : `${(data.pagination.page - 1) * data.pagination.pageSize + 1}–${Math.min(data.pagination.page * data.pagination.pageSize, data.pagination.totalItems)} of ${data.pagination.totalItems}`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1"
            disabled={data.pagination.page <= 1}
            onClick={() => onPageChange(data.pagination.page - 1)}
          >
            <ChevronLeft className="w-3.5 h-3.5" /> Prev
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {data.pagination.page} of {data.pagination.totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1"
            disabled={data.pagination.page >= data.pagination.totalPages}
            onClick={() => onPageChange(data.pagination.page + 1)}
          >
            Next <ChevronRight className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
