import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Unlock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { rawFetch } from "@/lib/api-fetch";
import type { LockedKeywordRecord } from "./types";

const REASON_OPTIONS: { value: string; label: string }[] = [
  { value: "retention_below_50", label: "Retention below 50%" },
  { value: "absent_two_consecutive", label: "Absent in two consecutive checks" },
  { value: "manual_campaign_adjustment", label: "Manual campaign adjustment" },
  { value: "incorrectly_locked", label: "Incorrectly locked" },
  { value: "other", label: "Other" },
];

export function UnlockConfirmationDialog({
  record,
  defaultReason,
  onOpenChange,
  onUnlocked,
}: {
  record: LockedKeywordRecord | null;
  defaultReason?: string;
  onOpenChange: (open: boolean) => void;
  onUnlocked: () => void;
}) {
  const { toast } = useToast();
  const [reason, setReason] = useState<string>("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (record) {
      setReason(defaultReason ?? "");
      setNote("");
      setError(null);
    }
  }, [record, defaultReason]);

  const unlock = useMutation({
    mutationFn: async () => {
      if (!record) throw new Error("No keyword selected");
      const r = await rawFetch(`/api/admin/locked-keywords/${record.id}/unlock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason, note: note.trim() || undefined }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to unlock");
      }
      return r.json();
    },
    onSuccess: () => onUnlocked(),
    onError: (e: Error) => {
      setError(e.message);
      toast({
        title: "The keyword could not be unlocked. No campaign data was changed.",
        description: e.message,
        variant: "destructive",
      });
    },
  });

  const needsNote = reason === "other";
  const canConfirm = reason !== "" && (!needsNote || note.trim().length > 0);

  return (
    <Dialog open={record != null} onOpenChange={(open) => !open && onOpenChange(false)}>
      <DialogContent className="max-w-lg">
        {record && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Unlock className="w-5 h-5 text-destructive" />
                Unlock this keyword variant?
              </DialogTitle>
              <DialogDescription>
                This variant will return to the active keyword rotation and may receive a larger share of future
                campaign sessions.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-1">
              <div className="rounded-lg border px-3 py-2.5 text-sm space-y-1">
                <p className="font-medium">{record.keywordText}</p>
                <p className="text-xs text-muted-foreground">
                  {record.clientName ?? "—"}
                  {record.businessName ? ` · ${record.businessName}` : ""}
                  {record.campaignName ? ` · ${record.campaignName}` : ""}
                </p>
                <div className="flex items-center gap-4 pt-1 text-xs">
                  <span>
                    Retention:{" "}
                    <strong>{record.retentionRate == null ? "—" : `${Math.round(record.retentionRate * 10) / 10}%`}</strong>
                  </span>
                  <span>
                    Consecutive absent: <strong>{record.consecutiveAbsentChecks}</strong>
                  </span>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="unlock-reason">Reason</Label>
                <Select value={reason} onValueChange={setReason}>
                  <SelectTrigger id="unlock-reason"><SelectValue placeholder="Choose a reason…" /></SelectTrigger>
                  <SelectContent>
                    {REASON_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="unlock-note">
                  Note {needsNote ? <span className="text-destructive">(required)</span> : <span className="text-muted-foreground">(optional)</span>}
                </Label>
                <Textarea
                  id="unlock-note"
                  placeholder="Add context for this decision…"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="min-h-[70px]"
                />
              </div>

              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={unlock.isPending}>
                Cancel
              </Button>
              <Button variant="destructive" disabled={!canConfirm || unlock.isPending} onClick={() => unlock.mutate()}>
                {unlock.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Unlock className="w-4 h-4 mr-1.5" />}
                Confirm Unlock
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
