import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Key } from "lucide-react";

const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: number;
  clientName: string;
  businessId: number;
  businessName: string;
  aeoPlanId: number;
  campaignName: string | null;
  onSaved?: (createdCount: number) => void;
}

export function BulkAddKeywordsDialog({
  open,
  onOpenChange,
  clientId,
  clientName,
  businessId,
  businessName,
  aeoPlanId,
  campaignName,
  onSaved,
}: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [raw, setRaw] = useState("");
  const [keywordType, setKeywordType] = useState("3");
  const [isActive, setIsActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  useEffect(() => {
    if (!open) {
      setRaw("");
      setKeywordType("3");
      setIsActive(true);
      setSubmitting(false);
      setProgress(null);
    }
  }, [open]);

  const lines = raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const unique = Array.from(new Set(lines));
  const duplicateCount = lines.length - unique.length;

  async function handleSave() {
    if (unique.length === 0) {
      toast({ title: "Add at least one keyword", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    setProgress({ done: 0, total: unique.length });
    let succeeded = 0;
    const failed: string[] = [];
    for (const kw of unique) {
      try {
        const res = await fetch(`${BASE}/api/keywords`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId,
            businessId,
            aeoPlanId,
            keywordText: kw,
            keywordType: Number(keywordType),
            isPrimary: 0,
            isActive,
          }),
        });
        if (!res.ok) {
          failed.push(kw);
        } else {
          succeeded++;
        }
      } catch {
        failed.push(kw);
      }
      setProgress({ done: succeeded + failed.length, total: unique.length });
    }
    await queryClient.invalidateQueries({ queryKey: ["/api/keywords"] });
    await queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
    setSubmitting(false);

    if (failed.length === 0) {
      toast({
        title: `Added ${succeeded} keyword${succeeded === 1 ? "" : "s"}`,
        description:
          "Tip: open any keyword's detail page to generate search variants.",
      });
      onSaved?.(succeeded);
      onOpenChange(false);
    } else {
      toast({
        title: `Added ${succeeded} of ${unique.length}`,
        description: `Failed: ${failed.slice(0, 3).join(", ")}${failed.length > 3 ? "…" : ""}`,
        variant: "destructive",
      });
      // Keep dialog open so the user can retry the failed lines.
      setRaw(failed.join("\n"));
      setProgress(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[720px] bg-white max-h-[90vh]">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
              <Key className="w-5 h-5 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold text-black">
                Add Keywords
              </DialogTitle>
              <DialogDescription className="text-sm text-slate-600 mt-0.5">
                {clientName} · {businessName} · {campaignName ?? "Campaign"}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          <div className="space-y-1.5">
            <Label className="text-sm uppercase tracking-widest text-black font-bold">
              Keywords (one per line)
            </Label>
            <Textarea
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder={`airport black car service\nlimo to LAX\nexecutive transportation austin`}
              className="min-h-[220px] text-base text-black bg-slate-50 font-mono"
              disabled={submitting}
            />
            <div className="flex items-center justify-between text-xs text-slate-600">
              <span>
                {unique.length} unique keyword{unique.length === 1 ? "" : "s"}
                {duplicateCount > 0
                  ? ` · ${duplicateCount} duplicate${duplicateCount === 1 ? "" : "s"} ignored`
                  : ""}
              </span>
              {progress ? (
                <span>
                  Saving {progress.done} / {progress.total}…
                </span>
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-slate-600 font-semibold">
                Keyword Type (applied to all)
              </Label>
              <Select
                value={keywordType}
                onValueChange={setKeywordType}
                disabled={submitting}
              >
                <SelectTrigger className="h-10 bg-slate-50 text-black">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="3">3 — Standard</SelectItem>
                  <SelectItem value="2">2</SelectItem>
                  <SelectItem value="1">1</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-slate-600 font-semibold">
                Active
              </Label>
              <div className="h-10 flex items-center gap-2">
                <Switch
                  checked={isActive}
                  onCheckedChange={setIsActive}
                  disabled={submitting}
                />
                <span className="text-sm text-slate-700">
                  {isActive ? "Yes" : "No"}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="pt-4 flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            {submitting ? "Cancel" : "Later"}
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={submitting || unique.length === 0}
            className="h-11 text-base font-bold"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving {progress?.done}/{progress?.total}
              </>
            ) : (
              `Create ${unique.length || ""} Keyword${unique.length === 1 ? "" : "s"}`.trim()
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
