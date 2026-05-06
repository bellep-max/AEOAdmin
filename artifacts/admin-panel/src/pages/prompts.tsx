import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, Lock } from "lucide-react";
import { rawFetch } from "@/lib/period-comparison";

interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  variables: string[];
  template: string;
}

interface PromptTemplatesResponse {
  templates: PromptTemplate[];
}

export default function Prompts() {
  const { data, isLoading } = useQuery<PromptTemplatesResponse>({
    queryKey: ["/api/prompt-templates"],
    queryFn: async () => {
      const res = await rawFetch("/api/prompt-templates");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center">
          <FileText className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Prompt Library</h1>
          <p className="text-sm text-muted-foreground">
            Templates that drive variant generation, AI search queries, and follow-up prompts.
          </p>
        </div>
        <Badge variant="outline" className="ml-auto text-[11px] gap-1">
          <Lock className="w-3 h-3" /> Read-only
        </Badge>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="space-y-5">
          {data?.templates.map((t, idx) => (
            <Card key={t.id} className="border-border/50">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">
                        {idx + 1}
                      </span>
                      {t.name}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground mt-1">{t.description}</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
                    Variables
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {t.variables.map((v) => (
                      <Badge key={v} variant="secondary" className="text-[11px] font-mono">
                        {`{{${v}}}`}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
                    Template
                  </p>
                  <pre className="text-xs bg-muted/40 rounded-lg p-3 whitespace-pre-wrap font-mono text-foreground/80 leading-relaxed border border-border/50">
                    {t.template}
                  </pre>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
