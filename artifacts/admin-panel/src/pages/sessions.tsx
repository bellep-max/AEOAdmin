import { useState } from "react";
import { useGetSessions } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Search, ExternalLink, MessageSquare, Plus, Loader2,
  MessagesSquare, ChevronRight, Camera, Link2, PencilLine, X,
} from "lucide-react";
import { format } from "date-fns";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/* ── Suggested follow-up prompts ─────────────────────── */
const FOLLOWUP_SUGGESTIONS = [
  "Can you give me more details about that business?",
  "What are people saying about their services?",
  "Are there any recent reviews I should know about?",
  "What are their hours and contact information?",
  "How do they compare to similar businesses nearby?",
  "Do they offer any promotions or special deals?",
  "What's the best way to get in touch with them?",
  "Are they currently accepting new clients?",
];

type Session = {
  id: number;
  clientId: number;
  clientName?: string | null;
  keywordText?: string | null;
  aiPlatform: string;
  deviceIdentifier?: string | null;
  followupText?: string | null;
  screenshotUrl?: string | null;
  timestamp: string;
  durationSeconds?: number | null;
};

export default function Sessions() {
  const [search, setSearch]       = useState("");
  const [platformFilter, setPF]   = useState<string>("all");

  /* Dialog state */
  const [viewSession, setViewSession]     = useState<Session | null>(null);
  const [editSession, setEditSession]     = useState<Session | null>(null);
  const [followupDraft, setFollowupDraft] = useState("");
  const [saving, setSaving]               = useState(false);

  /* Screenshot dialogs */
  const [lightboxSession, setLightboxSession]   = useState<Session | null>(null);
  const [screenshotEdit, setScreenshotEdit]     = useState<Session | null>(null);
  const [screenshotDraft, setScreenshotDraft]   = useState("");
  const [savingShot, setSavingShot]             = useState(false);

  function isImageUrl(url: string) {
    return /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?.*)?$/i.test(url);
  }

  function openScreenshotEdit(s: Session) {
    setScreenshotEdit(s);
    setScreenshotDraft(s.screenshotUrl ?? "");
    setLightboxSession(null);
  }

  async function saveScreenshot() {
    if (!screenshotEdit) return;
    setSavingShot(true);
    try {
      const res = await fetch(`${BASE}/api/sessions/${screenshotEdit.id}/screenshot`, {
        method:      "PATCH",
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body:        JSON.stringify({ screenshotUrl: screenshotDraft }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      await queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
      toast({ title: "Screenshot URL saved" });
      setScreenshotEdit(null);
    } catch (err: unknown) {
      toast({ title: "Save failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    } finally {
      setSavingShot(false);
    }
  }

  const { data: sessionsData, isLoading } = useGetSessions({ limit: 100 });
  const queryClient = useQueryClient();
  const { toast }   = useToast();

  const sessions = sessionsData?.sessions as Session[] | undefined;

  const filtered = sessions?.filter((s) => {
    const matchText =
      (s.clientName  ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (s.keywordText ?? "").toLowerCase().includes(search.toLowerCase());
    const matchPF = platformFilter === "all" || s.aiPlatform === platformFilter;
    return matchText && matchPF;
  });

  const platformColor = (p: string) =>
    p === "gemini"     ? "bg-blue-500/10 text-blue-400 border-blue-500/20" :
    p === "chatgpt"    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
    p === "perplexity" ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
                         "bg-muted text-muted-foreground";

  /* Stats */
  const withFollowup = sessions?.filter((s) => s.followupText).length ?? 0;
  const withoutFollowup = (sessions?.length ?? 0) - withFollowup;

  /* Open view dialog */
  function openView(s: Session) { setViewSession(s); }

  /* Open edit dialog */
  function openEdit(s: Session) {
    setEditSession(s);
    setFollowupDraft(s.followupText ?? "");
  }

  /* Save follow-up */
  async function saveFollowup() {
    if (!editSession) return;
    setSaving(true);
    try {
      const res = await fetch(`${BASE}/api/sessions/${editSession.id}/followup`, {
        method:      "PATCH",
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body:        JSON.stringify({ followupText: followupDraft }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      await queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
      toast({ title: "Follow-up prompt saved" });
      setEditSession(null);
    } catch (err: unknown) {
      toast({ title: "Save failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Session Log</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Raw log of all executed AEO prompt sessions.</p>
      </div>

      {/* ── Summary strip ── */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Total Sessions",   value: sessions?.length ?? 0,  color: "text-foreground"  },
          { label: "With Follow-up",   value: withFollowup,            color: "text-emerald-400" },
          { label: "No Follow-up",     value: withoutFollowup,         color: "text-amber-400"   },
          { label: "Follow-up Rate",   value: sessions?.length ? `${Math.round((withFollowup / sessions.length) * 100)}%` : "0%", color: "text-primary" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border/50 bg-card/60 px-4 py-3 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{s.label}</span>
            <span className={`text-lg font-bold tabular-nums ${s.color}`}>{s.value}</span>
          </div>
        ))}
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            type="search"
            placeholder="Search by client or keyword…"
            className="pl-9 bg-card/60 border-border/50 h-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          {["all", "gemini", "chatgpt", "perplexity"].map((p) => (
            <button
              key={p}
              onClick={() => setPF(p)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                platformFilter === p
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border/50 text-muted-foreground hover:border-border bg-transparent"
              }`}
            >
              {p === "all" ? "All" : p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* ── Table ── */}
      <div className="rounded-xl border border-border/50 bg-card/40 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border/50 hover:bg-transparent">
              <TableHead className="text-xs uppercase tracking-wider text-muted-foreground/70 font-semibold">Timestamp</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-muted-foreground/70 font-semibold">Client</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-muted-foreground/70 font-semibold">Keyword</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-muted-foreground/70 font-semibold">Platform</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-muted-foreground/70 font-semibold">Device</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-muted-foreground/70 font-semibold">Follow-up Prompt</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-muted-foreground/70 font-semibold text-right">Screenshot</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i} className="border-border/30">
                  {Array.from({ length: 7 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : filtered?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-28 text-center text-muted-foreground text-sm">
                  No sessions found.
                </TableCell>
              </TableRow>
            ) : (
              filtered?.map((s) => (
                <TableRow key={s.id} className="border-border/30 hover:bg-muted/20 transition-colors group">
                  <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                    {format(new Date(s.timestamp), "MMM d, yyyy HH:mm")}
                  </TableCell>
                  <TableCell className="font-medium text-sm text-foreground">
                    {s.clientName || `Client #${s.clientId}`}
                  </TableCell>
                  <TableCell className="max-w-[180px]">
                    <span className="text-sm truncate block" title={s.keywordText ?? ""}>
                      {s.keywordText || "—"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-[10px] font-semibold ${platformColor(s.aiPlatform)}`}>
                      {s.aiPlatform}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {s.deviceIdentifier || "—"}
                  </TableCell>

                  {/* ── Follow-up cell ── */}
                  <TableCell>
                    {s.followupText ? (
                      /* Has follow-up — click to view full text */
                      <button
                        onClick={() => openView(s)}
                        className="flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300 transition-colors group/btn"
                        title="Click to read follow-up prompt"
                      >
                        <MessageSquare className="w-3.5 h-3.5 flex-shrink-0" />
                        <span className="max-w-[160px] truncate">{s.followupText}</span>
                        <ChevronRight className="w-3 h-3 opacity-0 group-hover/btn:opacity-100 transition-opacity flex-shrink-0" />
                      </button>
                    ) : (
                      /* No follow-up — click to add one */
                      <button
                        onClick={() => openEdit(s)}
                        className="flex items-center gap-1 text-xs text-muted-foreground/50 hover:text-primary transition-colors group/add"
                        title="Add follow-up prompt"
                      >
                        <Plus className="w-3 h-3" />
                        <span className="opacity-0 group-hover/add:opacity-100 transition-opacity">Add prompt</span>
                      </button>
                    )}
                  </TableCell>

                  <TableCell className="text-right">
                    {s.screenshotUrl ? (
                      <button
                        onClick={() => setLightboxSession(s)}
                        className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors font-medium bg-primary/10 hover:bg-primary/20 border border-primary/20 rounded-lg px-2.5 py-1"
                        title="View screenshot"
                      >
                        <Camera className="w-3 h-3" />
                        View
                      </button>
                    ) : (
                      <button
                        onClick={() => openScreenshotEdit(s)}
                        className="text-xs text-muted-foreground/40 hover:text-primary transition-colors border border-dashed border-border/30 hover:border-primary/40 rounded-lg px-2 py-1 flex items-center gap-1"
                        title="Add screenshot URL"
                      >
                        <Plus className="w-2.5 h-2.5" />
                        Add
                      </button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* ════════════════════════════════════════
          View Follow-up Dialog (read mode)
      ════════════════════════════════════════ */}
      <Dialog open={!!viewSession} onOpenChange={(o) => { if (!o) setViewSession(null); }}>
        <DialogContent className="sm:max-w-[500px] border-border/60 bg-card">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/15 flex items-center justify-center">
                <MessagesSquare className="w-4 h-4 text-emerald-400" />
              </div>
              <DialogTitle>Follow-up Prompt</DialogTitle>
            </div>
            <DialogDescription>
              {viewSession?.clientName} · {viewSession?.keywordText}
            </DialogDescription>
          </DialogHeader>

          {viewSession && (
            <div className="space-y-4 mt-1">
              {/* Context */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "Platform", value: viewSession.aiPlatform },
                  { label: "Device",   value: viewSession.deviceIdentifier ?? "—" },
                  { label: "Time",     value: format(new Date(viewSession.timestamp), "MMM d, HH:mm") },
                ].map((c) => (
                  <div key={c.label} className="rounded-lg bg-muted/30 border border-border/40 px-3 py-2 text-center">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{c.label}</p>
                    <p className="text-xs font-semibold text-foreground mt-0.5">{c.value}</p>
                  </div>
                ))}
              </div>

              {/* Follow-up text */}
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wide mb-2">Follow-up Prompt</p>
                <p className="text-sm text-foreground leading-relaxed">{viewSession.followupText}</p>
              </div>

              <div className="flex gap-2 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 border-border/50 flex-1"
                  onClick={() => { setViewSession(null); openEdit(viewSession); }}
                >
                  <MessageSquare className="w-3.5 h-3.5" /> Edit Prompt
                </Button>
                <Button
                  size="sm"
                  className="flex-1"
                  onClick={() => setViewSession(null)}
                >
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ════════════════════════════════════════
          Screenshot Lightbox Dialog
      ════════════════════════════════════════ */}
      <Dialog open={!!lightboxSession} onOpenChange={(o) => { if (!o) setLightboxSession(null); }}>
        <DialogContent className="sm:max-w-[700px] border-border/60 bg-card p-0 overflow-hidden">
          <DialogHeader className="px-5 pt-5 pb-3 border-b border-border/40">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
                  <Camera className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <DialogTitle className="text-sm">{lightboxSession?.clientName}</DialogTitle>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {lightboxSession?.keywordText} · {lightboxSession?.aiPlatform} · {lightboxSession && format(new Date(lightboxSession.timestamp), "MMM d, HH:mm")}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => openScreenshotEdit(lightboxSession!)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors border border-border/50 hover:border-border rounded-lg px-2.5 py-1.5"
                >
                  <PencilLine className="w-3 h-3" /> Edit URL
                </button>
                {lightboxSession?.screenshotUrl && (
                  <a
                    href={lightboxSession.screenshotUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors border border-primary/30 rounded-lg px-2.5 py-1.5"
                  >
                    <ExternalLink className="w-3 h-3" /> Open tab
                  </a>
                )}
              </div>
            </div>
            <DialogDescription className="sr-only">Screenshot viewer</DialogDescription>
          </DialogHeader>

          {/* Image / URL preview area */}
          <div className="p-5">
            {lightboxSession?.screenshotUrl && isImageUrl(lightboxSession.screenshotUrl) ? (
              <div className="rounded-xl overflow-hidden border border-border/40 bg-muted/20">
                <img
                  src={lightboxSession.screenshotUrl}
                  alt="Session screenshot"
                  className="w-full max-h-[480px] object-contain"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                    e.currentTarget.nextElementSibling?.classList.remove("hidden");
                  }}
                />
                <div className="hidden p-8 text-center text-muted-foreground text-sm">
                  <Camera className="w-8 h-8 mx-auto mb-2 opacity-20" />
                  Could not load image. <a href={lightboxSession.screenshotUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">Open directly →</a>
                </div>
              </div>
            ) : (
              /* Non-image URL — show as styled link card */
              <div className="rounded-xl border border-border/40 bg-muted/20 p-6 flex flex-col items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <ExternalLink className="w-6 h-6 text-primary" />
                </div>
                <div className="text-center">
                  <p className="text-sm text-muted-foreground mb-2">Screenshot stored at:</p>
                  <p className="font-mono text-xs text-foreground/70 break-all max-w-[500px] bg-muted/40 px-3 py-2 rounded-lg border border-border/30">
                    {lightboxSession?.screenshotUrl}
                  </p>
                </div>
                <a
                  href={lightboxSession?.screenshotUrl ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-primary border border-primary/30 hover:bg-primary/10 transition-colors"
                >
                  <ExternalLink className="w-4 h-4" /> Open screenshot
                </a>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ════════════════════════════════════════
          Add / Edit Screenshot URL Dialog
      ════════════════════════════════════════ */}
      <Dialog open={!!screenshotEdit} onOpenChange={(o) => { if (!o && !savingShot) setScreenshotEdit(null); }}>
        <DialogContent className="sm:max-w-[440px] border-border/60 bg-card">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center">
                <Camera className="w-4 h-4 text-primary" />
              </div>
              <div>
                <DialogTitle>{screenshotEdit?.screenshotUrl ? "Edit Screenshot URL" : "Add Screenshot URL"}</DialogTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {screenshotEdit?.clientName} · {screenshotEdit?.aiPlatform}
                </p>
              </div>
            </div>
            <DialogDescription className="sr-only">Add or edit the screenshot URL for this session</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-1">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Screenshot URL
              </Label>
              <div className="relative">
                <Link2 className="absolute left-3 top-3 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  className="pl-9 bg-muted/30 border-border/60 h-10 font-mono text-sm"
                  placeholder="https://drive.google.com/… or https://…/screenshot.png"
                  value={screenshotDraft}
                  onChange={(e) => setScreenshotDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveScreenshot()}
                />
              </div>
              <p className="text-[10px] text-muted-foreground">
                Paste a direct image URL, Google Drive link, or any URL. Leave blank to remove.
              </p>
            </div>

            {screenshotDraft && (
              <a
                href={screenshotDraft}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Preview URL
              </a>
            )}

            <div className="flex gap-3 pt-1">
              <Button
                variant="outline"
                className="flex-1 border-border/50"
                onClick={() => setScreenshotEdit(null)}
                disabled={savingShot}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 gap-2"
                onClick={saveScreenshot}
                disabled={savingShot}
                style={{ background: "linear-gradient(135deg,hsl(217,91%,55%),hsl(217,91%,65%))", boxShadow: "0 4px 12px rgba(37,99,235,0.25)" }}
              >
                {savingShot ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : "Save URL"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ════════════════════════════════════════
          Add / Edit Follow-up Dialog
      ════════════════════════════════════════ */}
      <Dialog open={!!editSession} onOpenChange={(o) => { if (!o && !saving) setEditSession(null); }}>
        <DialogContent className="sm:max-w-[520px] border-border/60 bg-card">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center">
                <MessageSquare className="w-4 h-4 text-primary" />
              </div>
              <DialogTitle>
                {editSession?.followupText ? "Edit Follow-up Prompt" : "Add Follow-up Prompt"}
              </DialogTitle>
            </div>
            <DialogDescription>
              {editSession?.clientName} · <span className="text-foreground/70">{editSession?.keywordText}</span>
              {" "}<span className="text-muted-foreground/60">on {editSession?.aiPlatform}</span>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            {/* Suggested prompts */}
            <div className="space-y-2">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Quick Suggestions
              </Label>
              <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                {FOLLOWUP_SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setFollowupDraft(s)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-all ${
                      followupDraft === s
                        ? "bg-primary/20 text-primary border-primary/40"
                        : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground bg-transparent"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Text area */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Follow-up Prompt Text
              </Label>
              <Textarea
                placeholder="e.g. Can you tell me more about this business?"
                className="bg-muted/30 border-border/60 min-h-[90px] resize-none text-sm"
                value={followupDraft}
                onChange={(e) => setFollowupDraft(e.target.value)}
              />
              <p className="text-[10px] text-muted-foreground text-right">{followupDraft.length} chars</p>
            </div>

            <div className="flex gap-3 pt-1">
              <Button
                type="button"
                variant="outline"
                className="flex-1 border-border/50"
                onClick={() => setEditSession(null)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="flex-1 gap-2"
                onClick={saveFollowup}
                disabled={saving || !followupDraft.trim()}
                style={{
                  background:  "linear-gradient(135deg,hsl(217,91%,55%),hsl(217,91%,65%))",
                  boxShadow:   "0 4px 12px rgba(37,99,235,0.25)",
                }}
              >
                {saving ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
                ) : (
                  <><MessageSquare className="w-4 h-4" /> Save Prompt</>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
