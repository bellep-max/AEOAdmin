/** Summary Overview — the client-facing write-up that leads the report. Each
 *  block is a heading followed by one or more paragraphs (body split on "\n\n").
 *  Collapsible (open by default) so the reader can fold the write-up away and
 *  jump to the data. Renders nothing when there are no blocks; shows a skeleton
 *  while the narrative fetch is in flight. */
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronDown } from "lucide-react";
import type { OverviewBlock } from "@/lib/summary-report";

export function OverviewNarrative({
  blocks,
  isLoading,
}: {
  blocks: OverviewBlock[];
  isLoading: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (isLoading && blocks.length === 0) {
    return (
      <Card className="border-primary/20 bg-primary/[0.04]">
        <CardContent className="space-y-2 py-4">
          <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
          <div className="h-2.5 w-11/12 animate-pulse rounded bg-muted" />
          <div className="h-2.5 w-4/5 animate-pulse rounded bg-muted" />
        </CardContent>
      </Card>
    );
  }

  if (blocks.length === 0) return null;

  return (
    <Card className="border-primary/20 bg-primary/[0.04]">
      <CardHeader className="pb-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex w-full items-center gap-2 text-left"
        >
          <CardTitle className="text-sm font-semibold">
            Summary Overview
          </CardTitle>
          <ChevronDown
            className={`ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`}
          />
        </button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-5 pt-0">
          {blocks.map((block) => (
            <section key={block.heading} className="space-y-1.5">
              {block.heading &&
                block.heading.trim().toLowerCase() !== "overview" && (
                  <h3 className="text-sm font-semibold text-foreground">
                    {block.heading}
                  </h3>
                )}
              {block.body.split("\n\n").map((para, i) => (
                <p
                  key={i}
                  className="text-sm leading-relaxed text-muted-foreground"
                >
                  {para}
                </p>
              ))}
            </section>
          ))}
        </CardContent>
      )}
    </Card>
  );
}
