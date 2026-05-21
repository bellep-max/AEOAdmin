import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, ImageOff, ExternalLink } from "lucide-react";
import { rawFetch } from "@/lib/period-comparison";

interface Props {
  /* Null when the dialog should be closed. The id is passed through to the
     `endpoint` so multiple consumers (ranking-reports, sessions, audit-logs)
     can share this component. */
  recordId: number | null;
  /* Endpoint template using {id} as the placeholder, e.g.
     "/api/ranking-reports/{id}/screenshot-url" or
     "/api/sessions/{id}/screenshot-url". */
  endpoint: string;
  onClose: () => void;
  /* Optional context for the header. */
  title?: string;
  subtitle?: string;
  rank?: number | null;
  date?: string | null;
}

interface ScreenshotResponse {
  url: string | null;
  kind: "s3" | "external" | "local" | "none";
  expiresIn?: number;
  originalPath?: string;
}

export function RankingScreenshotDialog({
  recordId,
  endpoint,
  onClose,
  title,
  subtitle,
  rank,
  date,
}: Props) {
  const open = recordId !== null;
  const resolvedUrl =
    recordId != null ? endpoint.replace("{id}", String(recordId)) : null;
  /* Re-fetch every time the dialog opens with a new id; signed URLs expire
     in 15 min so stale data is harmless within a session. */
  const { data, isLoading, error } = useQuery<ScreenshotResponse>({
    queryKey: [endpoint, recordId, "screenshot-url"],
    enabled: open && resolvedUrl != null,
    queryFn: async () => {
      const res = await rawFetch(resolvedUrl as string);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as ScreenshotResponse;
    },
    staleTime: 10 * 60 * 1000,
  });

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-base">
            {title ?? "Audit screenshot"}
          </DialogTitle>
          {(subtitle || rank != null || date) && (
            <p className="text-xs text-muted-foreground">
              {subtitle ? <span>{subtitle}</span> : null}
              {subtitle && (rank != null || date) ? " · " : ""}
              {rank != null ? <span>Rank #{rank}</span> : null}
              {rank != null && date ? " · " : ""}
              {date ? <span>{date}</span> : null}
            </p>
          )}
        </DialogHeader>

        <div className="min-h-[200px] flex items-center justify-center">
          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Loading screenshot…</span>
            </div>
          )}

          {error && !isLoading && (
            <div className="flex flex-col items-center gap-2 text-sm text-destructive">
              <ImageOff className="w-8 h-8" />
              <span>Could not load screenshot</span>
              <span className="text-xs">
                {(error as Error).message ?? "Unknown error"}
              </span>
            </div>
          )}

          {!isLoading && !error && data && data.kind === "s3" && data.url && (
            <a
              href={data.url}
              target="_blank"
              rel="noopener noreferrer"
              title="Open full-size in a new tab"
              className="block"
            >
              <img
                src={data.url}
                alt="Audit screenshot"
                className="max-w-full max-h-[70vh] rounded border shadow-sm"
              />
            </a>
          )}

          {!isLoading &&
            !error &&
            data &&
            data.kind === "external" &&
            data.url && (
              <a
                href={data.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                <ExternalLink className="w-4 h-4" />
                Open external screenshot
              </a>
            )}

          {!isLoading && !error && data && data.kind === "local" && (
            <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
              <ImageOff className="w-8 h-8" />
              <span>Screenshot exists locally on the operator device</span>
              <code className="text-[11px] bg-muted px-2 py-1 rounded">
                {data.originalPath}
              </code>
              <span className="text-[11px]">
                Awaiting S3 upload to view in the admin.
              </span>
            </div>
          )}

          {!isLoading && !error && data && data.kind === "none" && (
            <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
              <ImageOff className="w-8 h-8" />
              <span>No screenshot recorded for this audit.</span>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
