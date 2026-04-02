import { useState } from "react";
import { useGetKeywords, useUpdateKeyword, useGetClients } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Search, Plus, CheckCircle2, XCircle, Clock, Key, Loader2, Star,
  Filter, X, Link2, MapPin,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const addKeywordSchema = z.object({
  keywordText:   z.string().min(2, "Keyword must be at least 2 characters"),
  clientId:      z.string().min(1, "Please select a client"),
  keywordType:   z.enum(["1", "2"]),    // 1 = Type 1 Geo Specific, 2 = Type 2 Backlink
  isPrimary:     z.boolean(),
  isActive:      z.boolean(),
  backlinkCount: z.coerce.number().min(0).max(100),
});

type AddKeywordForm = z.infer<typeof addKeywordSchema>;

// keywordType → badge display
const TYPE_STYLES: Record<number, { label: string; cls: string; icon: React.ElementType; desc: string }> = {
  1: { label: "Type 1", cls: "bg-primary/10 text-primary border-primary/20",         icon: MapPin, desc: "Geo Specific" },
  2: { label: "Type 2", cls: "bg-amber-500/10 text-amber-400 border-amber-500/20",   icon: Link2,  desc: "Backlink"     },
};

const VERIFY_MAP = {
  verified: { icon: CheckCircle2, label: "Verified",  cls: "text-emerald-400"  },
  failed:   { icon: XCircle,      label: "Failed",    cls: "text-destructive"  },
  pending:  { icon: Clock,        label: "Pending",   cls: "text-amber-400"    },
} as const;

export default function Keywords() {
  const [search, setSearch]           = useState("");
  const [typeFilter, setTypeFilter]   = useState<string>("all");
  const [dialogOpen, setDialogOpen]   = useState(false);
  const [submitting, setSubmitting]   = useState(false);

  const { data: keywords, isLoading } = useGetKeywords();
  const { data: clients }             = useGetClients();
  const updateKeyword                 = useUpdateKeyword();
  const { toast }                     = useToast();
  const queryClient                   = useQueryClient();

  const form = useForm<AddKeywordForm>({
    resolver: zodResolver(addKeywordSchema),
    defaultValues: {
      keywordText:   "",
      clientId:      "",
      keywordType:   "1",
      isPrimary:     false,
      isActive:      true,
      backlinkCount: 0,
    },
  });

  const filtered = keywords?.filter((k) => {
    const matchText = k.keywordText.toLowerCase().includes(search.toLowerCase());
    const matchType = typeFilter === "all" || String(k.keywordType) === typeFilter;
    return matchText && matchType;
  });

  function handleToggle(id: number, isActive: boolean) {
    updateKeyword.mutate(
      { id, data: { isActive } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["/api/keywords"] });
          toast({ title: "Keyword updated" });
        },
        onError: () => toast({ title: "Update failed", variant: "destructive" }),
      },
    );
  }

  async function onSubmit(values: AddKeywordForm) {
    setSubmitting(true);
    try {
      const res = await fetch(`${BASE}/api/keywords`, {
        method:      "POST",
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body: JSON.stringify({
          keywordText:   values.keywordText,
          clientId:      Number(values.clientId),
          tierLabel:     "aeo",
          keywordType:   Number(values.keywordType),
          isPrimary:     values.isPrimary ? 1 : 0,
          isActive:      values.isActive,
          backlinkCount: values.backlinkCount,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to create keyword");
      }

      await queryClient.invalidateQueries({ queryKey: ["/api/keywords"] });
      toast({ title: "Keyword added successfully" });
      form.reset();
      setDialogOpen(false);
    } catch (err: unknown) {
      toast({
        title:       "Failed to add keyword",
        description: err instanceof Error ? err.message : "Unknown error",
        variant:     "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  const activeCount    = keywords?.filter((k) => k.isActive).length ?? 0;
  const type1Count     = keywords?.filter((k) => k.keywordType === 1).length ?? 0;
  const type2Count     = keywords?.filter((k) => k.keywordType === 2).length ?? 0;

  const watchType = form.watch("keywordType");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">AEO Keywords</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Prompt search keywords — Type 1 (Geo Specific) and Type 2 (Backlink)
          </p>
        </div>
        <Button
          className="gap-2 shadow-sm"
          style={{ background: "linear-gradient(135deg,hsl(217,91%,55%),hsl(217,91%,65%))", boxShadow: "0 4px 12px rgba(37,99,235,0.3)" }}
          onClick={() => setDialogOpen(true)}
        >
          <Plus className="w-4 h-4" />
          Add Keyword
        </Button>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Total Keywords", value: keywords?.length ?? 0, color: "text-foreground"  },
          { label: "Active",          value: activeCount,           color: "text-emerald-400" },
          { label: "Type 1 (Geo)",   value: type1Count,            color: "text-primary"     },
          { label: "Type 2 (Link)",  value: type2Count,            color: "text-amber-400"   },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-border/50 bg-card/60 px-4 py-3 flex items-center justify-between"
          >
            <span className="text-xs text-muted-foreground">{s.label}</span>
            <span className={`text-lg font-bold tabular-nums ${s.color}`}>{s.value}</span>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            type="search"
            placeholder="Search keywords…"
            className="pl-9 bg-card/60 border-border/50 h-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          {[
            { id: "all", label: "All" },
            { id: "1",   label: "Type 1 – Geo" },
            { id: "2",   label: "Type 2 – Backlink" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTypeFilter(t.id)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                typeFilter === t.id
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground bg-transparent"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {(search || typeFilter !== "all") && (
          <button
            onClick={() => { setSearch(""); setTypeFilter("all"); }}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-3.5 h-3.5" /> Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border/50 bg-card/40 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border/50 hover:bg-transparent">
              <TableHead className="text-xs uppercase tracking-wider text-muted-foreground/70 font-semibold w-8"></TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-muted-foreground/70 font-semibold">Keyword</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-muted-foreground/70 font-semibold">Client</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-muted-foreground/70 font-semibold">Prompt Type</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-muted-foreground/70 font-semibold text-right">Clicks</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-muted-foreground/70 font-semibold text-right">30d</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-muted-foreground/70 font-semibold">Status</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-muted-foreground/70 font-semibold text-center">Active</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i} className="border-border/30">
                  {Array.from({ length: 8 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : filtered?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-32 text-center">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Key className="w-8 h-8 opacity-30" />
                    <p className="text-sm">No keywords found</p>
                    <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)} className="mt-1 gap-1.5">
                      <Plus className="w-3.5 h-3.5" /> Add your first keyword
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filtered?.map((kw) => {
                const verify   = VERIFY_MAP[kw.verificationStatus as keyof typeof VERIFY_MAP] ?? VERIFY_MAP.pending;
                const VerifyIcon = verify.icon;
                const client   = clients?.find((c) => c.id === kw.clientId);
                const typeInfo = TYPE_STYLES[kw.keywordType] ?? TYPE_STYLES[1];
                const TypeIcon = typeInfo.icon;
                return (
                  <TableRow key={kw.id} className="border-border/30 hover:bg-muted/20 transition-colors">
                    <TableCell className="w-8 pl-4">
                      {kw.isPrimary ? (
                        <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                      ) : (
                        <span className="w-3.5 h-3.5 block" />
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="font-medium text-sm text-foreground">{kw.keywordText}</span>
                    </TableCell>
                    <TableCell>
                      {client ? (
                        <div>
                          <p className="text-xs font-medium text-foreground">{client.businessName}</p>
                          <p className="text-[10px] text-muted-foreground">{client.city}, {client.state}</p>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground font-mono">#{kw.clientId}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`text-[10px] font-semibold gap-1 ${typeInfo.cls}`}
                      >
                        <TypeIcon className="w-2.5 h-2.5" />
                        {typeInfo.label}
                        <span className="text-[9px] opacity-70">· {typeInfo.desc}</span>
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="text-sm font-mono font-semibold text-foreground">{kw.clickCount}</span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="text-sm font-mono text-muted-foreground">{kw.last30DaysClickCount}</span>
                    </TableCell>
                    <TableCell>
                      <span className={`flex items-center gap-1 text-xs font-medium ${verify.cls}`}>
                        <VerifyIcon className="w-3.5 h-3.5 flex-shrink-0" />
                        {verify.label}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={kw.isActive}
                        onCheckedChange={(val) => handleToggle(kw.id, val)}
                        className="data-[state=checked]:bg-emerald-500"
                      />
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* ── Add Keyword Dialog ───────────────────────────────── */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(o) => { if (!submitting) { setDialogOpen(o); if (!o) form.reset(); } }}
      >
        <DialogContent className="sm:max-w-[480px] border-border/60 bg-card">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center">
                <Key className="w-4 h-4 text-primary" />
              </div>
              <DialogTitle className="text-lg">Add AEO Keyword</DialogTitle>
            </div>
            <DialogDescription>
              All keywords are AEO (prompt-based). Select Type 1 (geo-specific) or Type 2 (backlink).
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mt-2">
            {/* Keyword text */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Keyword <span className="text-destructive">*</span>
              </Label>
              <Input
                placeholder="e.g. best dentist near me Detroit"
                className="bg-muted/30 border-border/60 h-10"
                {...form.register("keywordText")}
              />
              {form.formState.errors.keywordText && (
                <p className="text-xs text-destructive">{form.formState.errors.keywordText.message}</p>
              )}
            </div>

            {/* Client */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Client <span className="text-destructive">*</span>
              </Label>
              <Controller
                name="clientId"
                control={form.control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="bg-muted/30 border-border/60 h-10">
                      <SelectValue placeholder="Select a client…" />
                    </SelectTrigger>
                    <SelectContent>
                      {clients?.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          <span className="font-medium">{c.businessName}</span>
                          <span className="text-muted-foreground ml-2 text-xs">{c.city}, {c.state}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {form.formState.errors.clientId && (
                <p className="text-xs text-destructive">{form.formState.errors.clientId.message}</p>
              )}
            </div>

            {/* Prompt Type */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                AEO Prompt Type <span className="text-destructive">*</span>
              </Label>
              <Controller
                name="keywordType"
                control={form.control}
                render={({ field }) => (
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { value: "1", label: "Type 1 — Geo Specific",   desc: "60% budget · 100% search rate",  icon: MapPin, accent: "border-primary/50 bg-primary/10 text-primary"    },
                      { value: "2", label: "Type 2 — Backlink",        desc: "10% budget · 1st keyword only",  icon: Link2,  accent: "border-amber-400/50 bg-amber-500/10 text-amber-400" },
                    ].map((opt) => {
                      const Icon     = opt.icon;
                      const selected = field.value === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => field.onChange(opt.value)}
                          className={`flex flex-col items-start gap-1 rounded-lg border px-3 py-2.5 text-left transition-all ${
                            selected
                              ? opt.accent
                              : "border-border/50 bg-muted/20 text-muted-foreground hover:border-border/80"
                          }`}
                        >
                          <div className="flex items-center gap-1.5">
                            <Icon className="w-3.5 h-3.5" />
                            <span className="text-xs font-semibold">{opt.label}</span>
                          </div>
                          <span className="text-[10px] opacity-70">{opt.desc}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              />
            </div>

            {/* Backlink count (only Type 2) */}
            {watchType === "2" && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Backlink Count
                  <span className="ml-1 text-[10px] text-amber-400 normal-case font-normal">(1st/primary keyword only)</span>
                </Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  placeholder="0"
                  className="bg-muted/30 border-border/60 h-10"
                  {...form.register("backlinkCount")}
                />
              </div>
            )}

            {/* Toggles */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center justify-between rounded-lg border border-border/40 bg-muted/20 px-3 py-2.5">
                <div>
                  <p className="text-sm font-medium text-foreground">Primary</p>
                  <p className="text-[10px] text-muted-foreground">1st keyword flag</p>
                </div>
                <Controller
                  name="isPrimary"
                  control={form.control}
                  render={({ field }) => (
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  )}
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border/40 bg-muted/20 px-3 py-2.5">
                <div>
                  <p className="text-sm font-medium text-foreground">Active</p>
                  <p className="text-[10px] text-muted-foreground">Include in sessions</p>
                </div>
                <Controller
                  name="isActive"
                  control={form.control}
                  render={({ field }) => (
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      className="data-[state=checked]:bg-emerald-500"
                    />
                  )}
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1 border-border/50"
                onClick={() => { setDialogOpen(false); form.reset(); }}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="flex-1 gap-2"
                disabled={submitting}
                style={{
                  background:  "linear-gradient(135deg,hsl(217,91%,55%),hsl(217,91%,65%))",
                  boxShadow:   "0 4px 12px rgba(37,99,235,0.25)",
                }}
              >
                {submitting ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Adding…</>
                ) : (
                  <><Plus className="w-4 h-4" /> Add Keyword</>
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
