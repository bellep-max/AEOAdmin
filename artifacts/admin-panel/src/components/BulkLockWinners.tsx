import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { RefreshCw, Lock, Loader2 } from "lucide-react";
import { rawFetch } from "@/lib/period-comparison";
import { useToast } from "@/hooks/use-toast";

interface Winner {
  keywordId: number;
  keywordText: string;
  clientId: number;
  triggerPlatform: string;
  triggerPosition: number;
  replacement: string;
  newKeywordId: number | null;
}

/**
 * Global "scan everything → review → bulk lock" panel for the rotation page.
 * Scans all active keywords across clients (dry-run), lists those currently
 * Top-3 on any platform with checkboxes, then locks the selected ones.
 */
export function BulkLockWinners({
  clients,
  onLocked,
}: {
  clients: { id: number; businessName: string }[];
  onLocked?: () => void;
}) {
  const { toast } = useToast();
  const [scanning, setScanning] = useState(false);
  const [locking, setLocking] = useState(false);
  const [winners, setWinners] = useState<Winner[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const clientName = useMemo(() => {
    const m = new Map<number, string>();
    for (const c of clients) m.set(c.id, c.businessName);
    return (id: number) => m.get(id) ?? `Client ${id}`;
  }, [clients]);

  const grouped = useMemo(() => {
    if (!winners) return [];
    const byClient = new Map<number, Winner[]>();
    for (const w of winners) {
      const list = byClient.get(w.clientId);
      if (list) list.push(w);
      else byClient.set(w.clientId, [w]);
    }
    return [...byClient.entries()]
      .map(([cid, ws]) => ({ cid, name: clientName(cid), ws }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [winners, clientName]);

  async function scan(): Promise<void> {
    setScanning(true);
    try {
      const r = await rawFetch("/api/keywords/rotate-winners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: true }),
      });
      if (!r.ok) throw new Error(`scan ${r.status}`);
      const d = (await r.json()) as { scanned: number; locked: Winner[] };
      const found = d.locked ?? [];
      setWinners(found);
      setSelected(new Set(found.map((w) => w.keywordId)));
      toast({ title: `Scanned ${d.scanned} keywords`, description: `${found.length} currently Top-3 and ready to lock.` });
    } catch (e) {
      toast({ title: "Scan failed", description: String(e), variant: "destructive" });
    } finally {
      setScanning(false);
    }
  }

  function toggle(id: number): void {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function toggleAll(): void {
    if (!winners) return;
    setSelected((prev) => (prev.size === winners.length ? new Set() : new Set(winners.map((w) => w.keywordId))));
  }
  function toggleClient(ws: Winner[]): void {
    setSelected((prev) => {
      const n = new Set(prev);
      const allOn = ws.every((w) => n.has(w.keywordId));
      ws.forEach((w) => (allOn ? n.delete(w.keywordId) : n.add(w.keywordId)));
      return n;
    });
  }

  async function lockSelected(): Promise<void> {
    const ids = [...selected];
    if (ids.length === 0) return;
    setLocking(true);
    try {
      const r = await rawFetch("/api/keywords/rotate-winners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywordIds: ids, dryRun: false }),
      });
      if (!r.ok) throw new Error(`lock ${r.status}`);
      const d = (await r.json()) as { locked: Winner[] };
      const n = d.locked?.length ?? 0;
      toast({ title: `Locked & rotated ${n} keyword${n === 1 ? "" : "s"}`, description: "Each locked keyword was archived and given an AI replacement." });
      setWinners((prev) => (prev ? prev.filter((w) => !ids.includes(w.keywordId)) : prev));
      setSelected(new Set());
      onLocked?.();
    } catch (e) {
      toast({ title: "Lock failed", description: String(e), variant: "destructive" });
    } finally {
      setLocking(false);
    }
  }

  return (
    <Card className="border-emerald-500/30">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Lock className="w-4 h-4 text-emerald-600" />
            Bulk lock current winners
            {winners && <span className="text-muted-foreground font-normal">({winners.length} ready)</span>}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="h-8 gap-1" onClick={scan} disabled={scanning || locking}>
              {scanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Scan all winners
            </Button>
            {winners && winners.length > 0 && (
              <Button size="sm" className="h-8 gap-1" onClick={lockSelected} disabled={locking || selected.size === 0}>
                {locking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
                Lock selected ({selected.size})
              </Button>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground pt-1">
          Scans every active keyword across all clients and lists the ones currently Top-3 on any platform. Review, then lock — each locked keyword is archived and gets an AI replacement.
        </p>
      </CardHeader>
      {winners && (
        <CardContent>
          {winners.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No keywords are currently Top-3. Nothing to lock.</p>
          ) : (
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer w-fit">
                <Checkbox checked={selected.size === winners.length} onCheckedChange={toggleAll} />
                Select all ({winners.length})
              </label>
              <div className="max-h-[28rem] overflow-y-auto space-y-3 pr-1">
                {grouped.map(({ cid, name, ws }) => (
                  <div key={cid} className="rounded-lg border border-border/40 overflow-hidden">
                    <label className="flex items-center gap-2 px-3 py-2 bg-muted/20 cursor-pointer text-sm font-semibold">
                      <Checkbox checked={ws.every((w) => selected.has(w.keywordId))} onCheckedChange={() => toggleClient(ws)} />
                      {name} <span className="text-muted-foreground font-normal">({ws.length})</span>
                    </label>
                    <div className="divide-y divide-border/30">
                      {ws.map((w) => (
                        <label key={w.keywordId} className="flex items-center gap-2 px-3 py-1.5 cursor-pointer text-sm hover:bg-muted/20">
                          <Checkbox checked={selected.has(w.keywordId)} onCheckedChange={() => toggle(w.keywordId)} />
                          <span className="flex-1 truncate">{w.keywordText}</span>
                          <Badge className="shrink-0 text-[10px] bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 capitalize">
                            {w.triggerPlatform} #{w.triggerPosition}
                          </Badge>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
