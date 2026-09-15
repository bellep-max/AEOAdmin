/** Collapsible glossary of the terms used across the report. */
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { BookOpen, ChevronDown } from "lucide-react";
import type { Glossary } from "@/lib/summary-report";

export function GlossaryPanel({ glossary }: { glossary: Glossary }) {
  const [open, setOpen] = useState(false);
  const terms = Object.values(glossary.terms);
  if (terms.length === 0) return null;

  return (
    <Card className="border-border/50">
      <CardContent className="py-3">
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 text-sm font-semibold">
            <span className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-primary" />
              Glossary
              <span className="text-xs font-normal text-muted-foreground">
                ({terms.length} terms)
              </span>
            </span>
            <ChevronDown
              className={`h-4 w-4 text-muted-foreground transition-transform ${
                open ? "rotate-180" : ""
              }`}
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            <dl className="grid gap-3 sm:grid-cols-2">
              {terms.map((t) => (
                <div
                  key={t.term}
                  className="rounded-lg border border-border/50 bg-muted/20 p-3"
                >
                  <dt className="text-xs font-semibold">{t.term}</dt>
                  <dd className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {t.definition}
                  </dd>
                </div>
              ))}
            </dl>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
