import { useState, useEffect } from "react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Box, Plus, Trash2, Calendar, User, Palette } from "lucide-react";
import { PLAN_META } from "@/lib/plan-meta";
import { format } from "date-fns";

const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
function rawFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> ?? {}),
  };
  if (BASE.includes("ngrok")) headers["ngrok-skip-browser-warning"] = "true";
  return fetch(BASE + path, { ...init, headers });
}

const CREATORS = ["Belle", "Mary", "Erik", "Erven", "Sales Teams", "Development Teams"] as const;

const COLOR_OPTIONS = [
  { label: "Violet",  hex: "#7c3aed", bg: "bg-violet-100",  text: "text-violet-700",  border: "border-violet-300" },
  { label: "Blue",    hex: "#2563eb", bg: "bg-blue-100",    text: "text-blue-700",    border: "border-blue-300" },
  { label: "Emerald", hex: "#059669", bg: "bg-emerald-100", text: "text-emerald-700", border: "border-emerald-300" },
  { label: "Amber",   hex: "#d97706", bg: "bg-amber-100",   text: "text-amber-700",   border: "border-amber-300" },
  { label: "Orange",  hex: "#ea580c", bg: "bg-orange-100",  text: "text-orange-700",  border: "border-orange-300" },
  { label: "Pink",    hex: "#db2777", bg: "bg-pink-100",    text: "text-pink-700",    border: "border-pink-300" },
  { label: "Rose",    hex: "#e11d48", bg: "bg-rose-100",    text: "text-rose-700",    border: "border-rose-300" },
  { label: "Cyan",    hex: "#0891b2", bg: "bg-cyan-100",    text: "text-cyan-700",    border: "border-cyan-300" },
  { label: "Indigo",  hex: "#4338ca", bg: "bg-indigo-100",  text: "text-indigo-700",  border: "border-indigo-300" },
  { label: "Teal",    hex: "#0d9488", bg: "bg-teal-100",    text: "text-teal-700",    border: "border-teal-300" },
  { label: "Slate",   hex: "#475569", bg: "bg-slate-100",   text: "text-slate-700",   border: "border-slate-300" },
  { label: "Fuchsia", hex: "#a21caf", bg: "bg-fuchsia-100", text: "text-fuchsia-700", border: "border-fuchsia-300" },
];

interface CustomPkg {
  id: number;
  name: string;
  description: string | null;
  target: string | null;
  features: string | null;
  color: string;
  tier: string | null;
  createdBy: string;
  createdAt: string;
}

const PACKAGE_DETAILS: Record<string, { description: string; target: string; features: string[] }> = {
  "The AEO Suite":       { description: "The complete answer-engine optimization bundle - covers all AEO channels end-to-end.", target: "Enterprise clients",       features: ["Full AEO audit", "Multi-channel deployment", "Priority support", "Monthly reporting"] },
  "Agency Solutions":    { description: "Designed for agencies managing multiple client accounts under a single dashboard.",    target: "Marketing agencies",        features: ["White-label reports", "Bulk keyword tracking", "Team access"] },
  "Performance Tiers":   { description: "Tiered approach scaled to traffic and performance targets, growing with results.",     target: "Growth-stage businesses",   features: ["Baseline benchmarking", "Tier advancement plan", "Performance dashboards"] },
  "Growth Bundles":      { description: "Pre-packaged growth strategies bundled for faster deployment and measurable ROI.",     target: "SMBs scaling up",           features: ["Strategy templates", "Local SEO boost", "Citation building"] },
  "Optimization Tracks": { description: "Structured optimization workflows with defined checkpoints and measurable outcomes.",  target: "Established businesses",    features: ["Workflow automation", "On-page optimization", "Technical audits"] },
  "Success Roadmaps":    { description: "Milestone-based roadmaps guiding businesses to long-term AEO dominance.",             target: "New market entrants",       features: ["90-day roadmap", "Goal milestone tracking", "Onboarding support"] },
};

function getColorOption(hex: string) {
  return COLOR_OPTIONS.find((c) => c.hex === hex) ?? COLOR_OPTIONS[0];
}

export default function Packages() {
  const { toast } = useToast();
  const [customPkgs, setCustomPkgs]   = useState<CustomPkg[]>([]);
  const [loading,    setLoading]      = useState(true);
  const [addOpen,    setAddOpen]      = useState(false);
  const [saving,     setSaving]       = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CustomPkg | null>(null);

  // Form state
  const [form, setForm] = useState({
    name: "", description: "", target: "", features: "", tier: "", color: COLOR_OPTIONS[0].hex, createdBy: "",
  });
  function setF(k: string, v: string) { setForm((p) => ({ ...p, [k]: v })); }

  async function fetchCustom() {
    setLoading(true);
    try {
      const r = await rawFetch("/api/packages");
      if (r.ok) setCustomPkgs(await r.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  useEffect(() => { fetchCustom(); }, []);

  async function handleAdd() {
    if (!form.name.trim()) { toast({ title: "Plan name is required", variant: "destructive" }); return; }
    if (!form.createdBy)   { toast({ title: "Please select who created this plan", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const features = form.features.trim()
        ? form.features.split(",").map((f) => f.trim()).filter(Boolean)
        : [];
      const r = await rawFetch("/api/packages", {
        method: "POST",
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim() || null,
          target: form.target.trim() || null,
          features,
          color: form.color,
          tier: form.tier.trim() || null,
          createdBy: form.createdBy,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Failed");
      toast({ title: "Plan added successfully" });
      setAddOpen(false);
      setForm({ name: "", description: "", target: "", features: "", tier: "", color: COLOR_OPTIONS[0].hex, createdBy: "" });
      await fetchCustom();
    } catch (err) {
      toast({ title: "Failed to add plan", description: err instanceof Error ? err.message : "", variant: "destructive" });
    } finally { setSaving(false); }
  }

  async function handleDelete(pkg: CustomPkg) {
    try {
      const r = await rawFetch(`/api/packages/${pkg.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Failed");
      toast({ title: `"${pkg.name}" removed` });
      setDeleteTarget(null);
      await fetchCustom();
    } catch {
      toast({ title: "Failed to delete plan", variant: "destructive" });
    }
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <Box className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Plan Options</h1>
            <p className="text-sm text-muted-foreground">All available service plans offered to clients</p>
          </div>
        </div>
        <Button onClick={() => setAddOpen(true)} className="gap-2 font-bold">
          <Plus className="w-4 h-4" /> Add Plan
        </Button>
      </div>

      {/* -- Standard plans -- */}
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2 px-1">Standard Plans</p>
        <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="w-[200px] font-semibold">Plan Name</TableHead>
                <TableHead className="font-semibold">Description</TableHead>
                <TableHead className="font-semibold">Best For</TableHead>
                <TableHead className="font-semibold">Key Features</TableHead>
                <TableHead className="text-right font-semibold">Tier</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {PLAN_META.map((pkg, index) => {
                const details = PACKAGE_DETAILS[pkg.name] ?? { description: "", target: "", features: [] };
                return (
                  <TableRow key={pkg.name} className={index % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                    <TableCell className="align-top py-4">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${pkg.badgeClass} whitespace-nowrap`}>
                        {pkg.name}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground align-top py-4 max-w-[280px]">{details.description}</TableCell>
                    <TableCell className="align-top py-4"><span className="text-sm font-medium">{details.target}</span></TableCell>
                    <TableCell className="align-top py-4">
                      <div className="flex flex-wrap gap-1">
                        {details.features.map((f) => (
                          <Badge key={f} variant="outline" className="text-xs font-normal text-muted-foreground">{f}</Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-right align-top py-4">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${pkg.tierClass}`}>{pkg.tier}</span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* -- Custom plans -- */}
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2 px-1">Custom Plans</p>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
        ) : customPkgs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 dark:bg-slate-800/30 px-6 py-10 text-center">
            <Box className="w-8 h-8 text-slate-400 mx-auto mb-2" />
            <p className="text-sm font-medium text-slate-500">No custom plans yet</p>
            <p className="text-xs text-slate-400 mt-1">Click <strong>Add Plan</strong> to create your first custom plan</p>
          </div>
        ) : (
          <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="font-semibold">Plan Name</TableHead>
                  <TableHead className="font-semibold">Description</TableHead>
                  <TableHead className="font-semibold">Best For</TableHead>
                  <TableHead className="font-semibold">Features</TableHead>
                  <TableHead className="font-semibold">Tier</TableHead>
                  <TableHead className="font-semibold">Created By</TableHead>
                  <TableHead className="font-semibold">Date Created</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {customPkgs.map((pkg, index) => {
                  const col = getColorOption(pkg.color);
                  const featureList: string[] = pkg.features ? JSON.parse(pkg.features) : [];
                  return (
                    <TableRow key={pkg.id} className={index % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                      <TableCell className="align-top py-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${col.bg} ${col.text} ${col.border} whitespace-nowrap`}
                        >
                          {pkg.name}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground align-top py-4 max-w-[220px]">
                        {pkg.description || <span className="italic text-slate-400">-</span>}
                      </TableCell>
                      <TableCell className="align-top py-4">
                        <span className="text-sm font-medium">{pkg.target || <span className="italic text-slate-400">-</span>}</span>
                      </TableCell>
                      <TableCell className="align-top py-4">
                        {featureList.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {featureList.map((f) => (
                              <Badge key={f} variant="outline" className="text-xs font-normal text-muted-foreground">{f}</Badge>
                            ))}
                          </div>
                        ) : <span className="text-xs text-slate-400 italic">-</span>}
                      </TableCell>
                      <TableCell className="align-top py-4">
                        {pkg.tier ? (
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${col.bg} ${col.text} ${col.border}`}>
                            {pkg.tier}
                          </span>
                        ) : <span className="text-xs text-slate-400 italic">-</span>}
                      </TableCell>
                      <TableCell className="align-top py-4">
                        <div className="flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 text-slate-400" />
                          <span className="text-sm font-medium">{pkg.createdBy}</span>
                        </div>
                      </TableCell>
                      <TableCell className="align-top py-4">
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          <Calendar className="w-3.5 h-3.5" />
                          {format(new Date(pkg.createdAt), "MMM d, yyyy")}
                        </div>
                      </TableCell>
                      <TableCell className="align-top py-4 text-right">
                        <button
                          onClick={() => setDeleteTarget(pkg)}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {PLAN_META.length} standard · {customPkgs.length} custom · {PLAN_META.length + customPkgs.length} total plans
      </p>

      {/* -- Add Plan Dialog -- */}
      <Dialog open={addOpen} onOpenChange={(o) => { if (!o && !saving) { setAddOpen(false); } }}>
        <DialogContent className="w-[95vw] max-w-[820px] max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                <Box className="w-5 h-5 text-primary" />
              </div>
              <DialogTitle className="text-lg font-bold">Add Custom Plan</DialogTitle>
            </div>
            <DialogDescription>Create a new service plan. Fields marked <span className="text-red-500">*</span> are required.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            {/* Name */}
            <div className="space-y-1.5">
              <Label className="text-sm font-bold uppercase tracking-widest">Plan Name <span className="text-red-500">*</span></Label>
              <Input
                placeholder="e.g. Premium Local Bundle"
                value={form.name}
                onChange={(e) => setF("name", e.target.value)}
                className="h-11"
              />
            </div>

            {/* Color palette */}
            <div className="space-y-1.5">
              <Label className="text-sm font-bold uppercase tracking-widest flex items-center gap-2">
                <Palette className="w-4 h-4" /> Color <span className="text-red-500">*</span>
              </Label>
              <div className="flex flex-wrap gap-2">
                {COLOR_OPTIONS.map((c) => (
                  <button
                    key={c.hex}
                    type="button"
                    onClick={() => setF("color", c.hex)}
                    title={c.label}
                    className={`w-8 h-8 rounded-full border-2 transition-all ${form.color === c.hex ? "border-slate-800 scale-110 shadow-md" : "border-transparent hover:border-slate-400"}`}
                    style={{ backgroundColor: c.hex }}
                  />
                ))}
              </div>
              {/* Preview */}
              <div className="mt-1">
                {(() => {
                  const col = getColorOption(form.color);
                  return (
                    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border ${col.bg} ${col.text} ${col.border}`}>
                      {form.name || "Preview"}
                    </span>
                  );
                })()}
              </div>
            </div>

            {/* Description · Best For · Tier Label - 3 columns */}
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-sm font-bold uppercase tracking-widest">Description</Label>
                <Input placeholder="Short description" value={form.description} onChange={(e) => setF("description", e.target.value)} className="h-11" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-bold uppercase tracking-widest">Best For</Label>
                <Input placeholder="e.g. New businesses" value={form.target} onChange={(e) => setF("target", e.target.value)} className="h-11" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-bold uppercase tracking-widest">Tier Label</Label>
                <Input placeholder="e.g. Starter" value={form.tier} onChange={(e) => setF("tier", e.target.value)} className="h-11" />
              </div>
            </div>

            {/* Key Features · Created By - 2 columns */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-sm font-bold uppercase tracking-widest">Key Features</Label>
                <Input placeholder="Comma-separated" value={form.features} onChange={(e) => setF("features", e.target.value)} className="h-11" />
                <p className="text-xs text-muted-foreground">e.g. Local SEO, Citations, Monthly report</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-bold uppercase tracking-widest flex items-center gap-2">
                  <User className="w-4 h-4" /> Created By <span className="text-red-500">*</span>
                </Label>
                <Select value={form.createdBy} onValueChange={(v) => setF("createdBy", v)}>
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder="Select who created this plan..." />
                  </SelectTrigger>
                  <SelectContent>
                    {CREATORS.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <Button variant="outline" className="flex-1 h-11 font-bold" onClick={() => setAddOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              className="flex-1 h-11 font-bold gap-2"
              disabled={saving || !form.name.trim() || !form.createdBy}
              onClick={handleAdd}
            >
              {saving ? "Saving..." : <><Plus className="w-4 h-4" /> Add Plan</>}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* -- Delete confirmation -- */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete custom plan?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>"{deleteTarget?.name}"</strong>? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => deleteTarget && handleDelete(deleteTarget)}
            >
              Yes, delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

