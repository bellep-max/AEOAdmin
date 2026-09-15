/** Static, numbered "How AEO works" steps, supplied by the narrative endpoint. */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Workflow } from "lucide-react";
import type { NarrativeStep } from "@/lib/summary-report";

export function HowAeoWorks({ steps }: { steps: NarrativeStep[] }) {
  if (steps.length === 0) return null;
  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Workflow className="h-4 w-4 text-primary" />
          How AEO works
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <ol className="space-y-3">
          {steps.map((s, i) => (
            <li key={s.title} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                {i + 1}
              </span>
              <div>
                <p className="text-sm font-medium">{s.title}</p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {s.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
