/**
 * @file proxies.tsx
 * @page /proxies
 *
 * Proxy Pool management page for the Signal AEO device farm.
 * Displays all Decodo mobile/residential proxies as cards and provides
 * full CRUD: add, edit, delete, and quick device-unassignment.
 *
 * Each proxy card shows:
 *   - Label, host:port, proxy type badge
 *   - Username + masked/revealed password with toggle
 *   - Assigned device identifier and model (or an "Assign to device" button)
 *   - Session count and last-used timestamp
 *
 * The add/edit form validates via Zod and auto-builds the proxyUrl string
 * from host/port/username/password so the API always has a ready-to-use URL.
 *
 * Data sources:
 *   GET  /api/proxies   — proxy list (joined with device info)
 *   GET  /api/devices   — device list for the assignment dropdown
 *   POST /api/proxies   — create
 *   PATCH /api/proxies/:id — update
 *   DELETE /api/proxies/:id — delete
 */

import { useState } from "react";
import { useGetProxies, useGetDevices } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Network, Plus, Smartphone, Wifi, ShieldCheck, MoreVertical,
  Loader2, Eye, EyeOff, Trash2, Pencil, Unlink, Link2, Search,
} from "lucide-react";

/** Base URL for API calls — strips trailing slash from Vite BASE_URL */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/* ─── Types ─────────────────────────────────────────────────────────────── */

/** Proxy row as returned by GET /api/proxies (includes joined device fields) */
type ProxyWithDevice = {
  id:               number;
  label:            string | null;
  proxyType:        string;
  host:             string | null;
  port:             number | null;
  username:         string | null;
  password:         string | null;
  deviceId:         number | null;
  sessionCount:     number;
  lastUsed:         string | null;
  deviceIdentifier: string | null; // Joined from devicesTable
  deviceModel:      string | null; // Joined from devicesTable
};

/* ─── Form schema ────────────────────────────────────────────────────────── */

/**
 * Zod validation schema for the add/edit proxy form.
 * Port must be a numeric string to work with HTML <input type="text">.
 */
const proxySchema = z.object({
  label:     z.string().min(1, "Label required"),
  host:      z.string().min(4, "Host required (e.g. gate.decodo.com)"),
  port:      z.string().regex(/^\d+$/, "Port must be a number"),
  username:  z.string().min(1, "Username required"),
  password:  z.string().min(1, "Password required"),
  proxyType: z.enum(["mobile", "residential"]),
  deviceId:  z.string().optional(), // "" or "none" = unassigned
});
type ProxyForm = z.infer<typeof proxySchema>;

/** Default Decodo gateway host pre-filled in the form */
const DEFAULT_DECODO_HOST = "gate.decodo.com";

/**
 * Partially obscures a password for display.
 * Shows the first 3 characters then up to 8 bullet characters.
 * Returns "—" for null/empty passwords.
 */
function maskPassword(p: string | null) {
  if (!p) return "—";
  return p.slice(0, 3) + "•".repeat(Math.min(p.length - 3, 8));
}

/* ═══════════════════════════════════════════════════════════════════════════ */
export default function Proxies() {
  const queryClient = useQueryClient();
  const { toast }   = useToast();

  // ── Data fetching ────────────────────────────────────────────────────────
  const { data: proxies, isLoading: isProxiesLoading } = useGetProxies();
  const { data: devices, isLoading: isDevicesLoading } = useGetDevices();

  // ── Dialog / modal state ─────────────────────────────────────────────────
  const [addOpen,     setAddOpen]     = useState(false);              // Add dialog open
  const [editProxy,   setEditProxy]   = useState<ProxyWithDevice | null>(null); // Proxy being edited
  const [deleteProxy, setDeleteProxy] = useState<ProxyWithDevice | null>(null); // Proxy pending deletion
  const [saving,      setSaving]      = useState(false);              // Submit in progress

  // ── UI state ─────────────────────────────────────────────────────────────
  // Tracks which proxy card passwords are currently revealed (keyed by proxy ID)
  const [showPw, setShowPw] = useState<Record<number, boolean>>({});
  const [search, setSearch] = useState(""); // Live search filter

  // ── Form ─────────────────────────────────────────────────────────────────
  const form = useForm<ProxyForm>({
    resolver: zodResolver(proxySchema),
    defaultValues: {
      label: "", host: DEFAULT_DECODO_HOST, port: "10000",
      username: "", password: "", proxyType: "mobile", deviceId: "",
    },
  });

  /**
   * Opens the Add dialog with blank defaults pre-filled.
   * Resets any previous form state so edits don't bleed into the add flow.
   */
  function openAdd() {
    form.reset({
      label: "", host: DEFAULT_DECODO_HOST, port: "10000",
      username: "", password: "", proxyType: "mobile", deviceId: "",
    });
    setAddOpen(true);
  }

  /**
   * Opens the Edit dialog pre-filled with the proxy's current values.
   * Falls back to Decodo defaults for host/port when not set.
   */
  function openEdit(p: ProxyWithDevice) {
    form.reset({
      label:     p.label     ?? "",
      host:      p.host      ?? DEFAULT_DECODO_HOST,
      port:      String(p.port ?? 10000),
      username:  p.username  ?? "",
      password:  p.password  ?? "",
      proxyType: (p.proxyType as "mobile" | "residential") ?? "mobile",
      deviceId:  p.deviceId ? String(p.deviceId) : "",
    });
    setEditProxy(p);
  }

  /**
   * Handles both add (POST) and edit (PATCH) form submissions.
   * Invalidates the proxies query on success so the card grid refreshes.
   */
  async function onSave(values: ProxyForm) {
    setSaving(true);
    try {
      const payload = {
        label:     values.label,
        host:      values.host,
        port:      Number(values.port),
        username:  values.username,
        password:  values.password,
        proxyType: values.proxyType,
        // Treat "none" or empty string as unassigned (null deviceId)
        deviceId:  values.deviceId && values.deviceId !== "none"
          ? Number(values.deviceId)
          : null,
      };

      const isEdit = !!editProxy;
      const url    = isEdit ? `${BASE}/api/proxies/${editProxy!.id}` : `${BASE}/api/proxies`;
      const method = isEdit ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");

      await queryClient.invalidateQueries({ queryKey: ["/api/proxies"] });
      toast({ title: isEdit ? "Proxy updated" : "Proxy added" });
      setAddOpen(false);
      setEditProxy(null);
    } catch (err: unknown) {
      toast({
        title: "Save failed",
        description: err instanceof Error ? err.message : "",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  /**
   * Sends a PATCH request to set deviceId = null for a proxy,
   * effectively detaching it from the device it was assigned to.
   */
  async function unassignDevice(id: number) {
    try {
      await fetch(`${BASE}/api/proxies/${id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: null }),
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/proxies"] });
      toast({ title: "Device unassigned" });
    } catch {
      toast({ title: "Failed", variant: "destructive" });
    }
  }

  /**
   * Executes the pending DELETE after the user confirms in the AlertDialog.
   * Clears the deleteProxy state afterwards to close the dialog.
   */
  async function confirmDelete() {
    if (!deleteProxy) return;
    try {
      await fetch(`${BASE}/api/proxies/${deleteProxy.id}`, {
        method: "DELETE", credentials: "include",
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/proxies"] });
      toast({ title: "Proxy deleted" });
    } catch {
      toast({ title: "Delete failed", variant: "destructive" });
    }
    setDeleteProxy(null);
  }

  // ── Derived data ─────────────────────────────────────────────────────────
  const proxyList = (proxies as ProxyWithDevice[] | undefined) ?? [];

  // Client-side filter by label, host, device identifier, or model
  const filtered = proxyList.filter((p) => {
    const q = search.toLowerCase();
    return (
      (p.label            ?? "").toLowerCase().includes(q) ||
      (p.host             ?? "").toLowerCase().includes(q) ||
      (p.deviceIdentifier ?? "").toLowerCase().includes(q) ||
      (p.deviceModel      ?? "").toLowerCase().includes(q)
    );
  });

  // Summary stats shown in the stat cards at the top of the page
  const totalProxies  = proxyList.length;
  const mobileCount   = proxyList.filter((p) => p.proxyType === "mobile").length;
  const assignedCount = proxyList.filter((p) => p.deviceId != null).length;
  const unassigned    = totalProxies - assignedCount;

  // True when the edit dialog should be shown instead of the add dialog
  const isEditing = !!editProxy;

  return (
    <div className="space-y-6">

      {/* ── Page header + Add Proxy button ── */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Proxy Pool</h1>
            {/* Provider tag — all proxies route through Decodo */}
            <span className="text-[10px] font-bold tracking-widest uppercase px-2 py-0.5 rounded-full border border-primary/40 bg-primary/10 text-primary">
              via Decodo
            </span>
          </div>
          <p className="text-muted-foreground text-sm mt-0.5">
            Mobile proxy rotation for AEO sessions · {totalProxies} configured
          </p>
        </div>
        <Button
          className="gap-2"
          style={{
            background: "linear-gradient(135deg,hsl(217,91%,55%),hsl(217,91%,65%))",
            boxShadow:  "0 4px 12px rgba(37,99,235,0.3)",
          }}
          onClick={openAdd}
        >
          <Plus className="w-4 h-4" /> Add Proxy
        </Button>
      </div>

      {/* ── Summary stat cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Proxies",      value: totalProxies,  icon: Network,     color: "text-foreground"  },
          { label: "Mobile",             value: mobileCount,   icon: Wifi,        color: "text-primary"     },
          { label: "Assigned to Device", value: assignedCount, icon: Smartphone,  color: "text-emerald-400" },
          { label: "Unassigned",         value: unassigned,    icon: ShieldCheck, color: "text-amber-400"   },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border/50 bg-card/60 p-4">
            <div className="flex items-center gap-2 mb-2">
              <s.icon className={`w-4 h-4 ${s.color}`} />
              <span className="text-xs text-muted-foreground">{s.label}</span>
            </div>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* ── Search bar ── */}
      <div className="relative max-w-xs">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="Search by label, host, or device…"
          className="pl-9 bg-card/60 border-border/50 h-9 text-sm"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* ── Proxy card grid / loading / empty state ── */}
      {isProxiesLoading ? (
        /* Skeleton grid while loading */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        /* Empty state — shown when no proxies exist or search has no matches */
        <div className="py-16 flex flex-col items-center gap-3 text-muted-foreground rounded-xl border border-dashed border-border/40 bg-card/20">
          <Network className="w-10 h-10 opacity-20" />
          <p className="text-sm">No proxies yet</p>
          <Button size="sm" variant="outline" onClick={openAdd} className="gap-1.5 mt-1">
            <Plus className="w-3.5 h-3.5" /> Add your first Decodo proxy
          </Button>
        </div>
      ) : (
        /* Responsive card grid — 1/2/3 columns */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((p) => {
            const assigned = !!p.deviceId;
            return (
              <div
                key={p.id}
                className="rounded-xl border border-border/50 bg-card/60 hover:bg-card/80 transition-all p-4 flex flex-col gap-3 group relative"
              >
                {/* ── Card top: label + type badge + action menu ── */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-foreground truncate">
                      {p.label ?? "Unnamed Proxy"}
                    </p>
                    {/* Host:port shown in muted text below the label */}
                    <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                      {p.host}:{p.port}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {/* Proxy type badge (Mobile / Residential) */}
                    <Badge variant="outline" className="text-[9px] bg-primary/10 text-primary border-primary/20">
                      <Wifi className="w-2.5 h-2.5 mr-1" />
                      {p.proxyType === "mobile" ? "Mobile" : "Residential"}
                    </Badge>

                    {/* Three-dot action menu — visible on card hover */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost" size="icon"
                          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        >
                          <MoreVertical className="w-3.5 h-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="text-xs">
                        <DropdownMenuItem onClick={() => openEdit(p)} className="gap-2">
                          <Pencil className="w-3.5 h-3.5" /> Edit
                        </DropdownMenuItem>
                        {/* Unassign only shown when a device is currently linked */}
                        {assigned && (
                          <DropdownMenuItem onClick={() => unassignDevice(p.id)} className="gap-2">
                            <Unlink className="w-3.5 h-3.5 text-amber-400" /> Unassign Device
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => setDeleteProxy(p)}
                          className="gap-2 text-destructive"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                {/* ── Credentials box ── */}
                <div className="rounded-lg bg-muted/30 border border-border/30 px-3 py-2 space-y-1.5">
                  {/* Username row */}
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-muted-foreground">Username</span>
                    <span className="font-mono text-foreground/80">{p.username ?? "—"}</span>
                  </div>
                  {/* Password row with show/hide toggle */}
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-muted-foreground">Password</span>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-foreground/80">
                        {showPw[p.id] ? (p.password ?? "—") : maskPassword(p.password)}
                      </span>
                      {/* Eye toggle — keyed per proxy ID so each card is independent */}
                      <button
                        onClick={() => setShowPw((s) => ({ ...s, [p.id]: !s[p.id] }))}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {showPw[p.id]
                          ? <EyeOff className="w-2.5 h-2.5" />
                          : <Eye    className="w-2.5 h-2.5" />}
                      </button>
                    </div>
                  </div>
                </div>

                {/* ── Device assignment row ── */}
                <div className="flex items-center gap-2 mt-auto">
                  {assigned ? (
                    /* Assigned state: shows device identifier and model */
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <div className="w-6 h-6 rounded-full bg-emerald-500/15 flex items-center justify-center shrink-0">
                        <Smartphone className="w-3 h-3 text-emerald-400" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] font-mono text-emerald-400 truncate">
                          {p.deviceIdentifier}
                        </p>
                        <p className="text-[9px] text-muted-foreground/60 truncate">{p.deviceModel}</p>
                      </div>
                    </div>
                  ) : (
                    /* Unassigned state: dashed "Assign to device" button opens edit dialog */
                    <button
                      onClick={() => openEdit(p)}
                      className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-primary transition-colors border border-dashed border-border/40 hover:border-primary/40 rounded-lg px-2 py-1.5 flex-1"
                    >
                      <Link2 className="w-3 h-3" /> Assign to device
                    </button>
                  )}
                  {/* Lifetime session count — shown on all cards */}
                  <span className="text-[9px] text-muted-foreground/50 shrink-0">
                    {p.sessionCount} sessions
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════
          Add / Edit Dialog
          Shared dialog for both add and edit flows.
          isEditing flag determines title and submit button text.
      ════════════════════════════════════════════════════════ */}
      <Dialog
        open={addOpen || isEditing}
        onOpenChange={(o) => {
          // Prevent closing while a save request is in flight
          if (!saving) { setAddOpen(false); setEditProxy(null); }
        }}
      >
        <DialogContent className="sm:max-w-[460px] border-border/60 bg-card">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center">
                <Network className="w-4 h-4 text-primary" />
              </div>
              <div>
                <DialogTitle>{isEditing ? "Edit Proxy" : "Add Decodo Proxy"}</DialogTitle>
                {!isEditing && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Enter your Decodo credentials below
                  </p>
                )}
              </div>
            </div>
            <DialogDescription className="sr-only">
              {isEditing ? "Update proxy settings" : "Add a new Decodo proxy to the pool"}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={form.handleSubmit(onSave)} className="space-y-4 mt-1">

            {/* Label field */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Label <span className="text-destructive">*</span>
              </Label>
              <Input
                className="bg-muted/30 border-border/60 h-10"
                placeholder="e.g. DEV-001 Mobile"
                {...form.register("label")}
              />
              {form.formState.errors.label && (
                <p className="text-xs text-destructive">{form.formState.errors.label.message}</p>
              )}
            </div>

            {/* Host + Port — 2:1 column grid */}
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Host <span className="text-destructive">*</span>
                </Label>
                <Input
                  className="bg-muted/30 border-border/60 h-10 font-mono text-sm"
                  placeholder="gate.decodo.com"
                  {...form.register("host")}
                />
                {form.formState.errors.host && (
                  <p className="text-xs text-destructive">{form.formState.errors.host.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Port <span className="text-destructive">*</span>
                </Label>
                <Input
                  className="bg-muted/30 border-border/60 h-10 font-mono text-sm"
                  placeholder="10000"
                  {...form.register("port")}
                />
                {form.formState.errors.port && (
                  <p className="text-xs text-destructive">{form.formState.errors.port.message}</p>
                )}
              </div>
            </div>

            {/* Username + Password — equal columns */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Username <span className="text-destructive">*</span>
                </Label>
                <Input
                  className="bg-muted/30 border-border/60 h-10 font-mono text-sm"
                  placeholder="spx12345user"
                  {...form.register("username")}
                />
                {form.formState.errors.username && (
                  <p className="text-xs text-destructive">{form.formState.errors.username.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Password <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="password"
                  className="bg-muted/30 border-border/60 h-10 font-mono text-sm"
                  placeholder="••••••••"
                  {...form.register("password")}
                />
                {form.formState.errors.password && (
                  <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>
                )}
              </div>
            </div>

            {/* Proxy type selector — pill-style toggle buttons */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Proxy Type</Label>
              <Controller
                name="proxyType"
                control={form.control}
                render={({ field }) => (
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { value: "mobile",      label: "Mobile",      icon: Wifi,        color: "border-primary/50 bg-primary/10 text-primary"               },
                      { value: "residential", label: "Residential", icon: ShieldCheck, color: "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"   },
                    ] as const).map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => field.onChange(opt.value)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-all ${
                          field.value === opt.value
                            ? opt.color
                            : "border-border/40 text-muted-foreground hover:border-border/70 bg-transparent"
                        }`}
                      >
                        <opt.icon className="w-3.5 h-3.5" />
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              />
            </div>

            {/* Device assignment dropdown — optional */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Assign to Device <span className="text-muted-foreground/50">(optional)</span>
              </Label>
              <Controller
                name="deviceId"
                control={form.control}
                render={({ field }) => (
                  <Select value={field.value ?? ""} onValueChange={field.onChange}>
                    <SelectTrigger className="bg-muted/30 border-border/60 h-10 text-sm">
                      <SelectValue placeholder="Select device…" />
                    </SelectTrigger>
                    <SelectContent className="max-h-48">
                      {/* "None" option to unassign in edit mode */}
                      <SelectItem value="none">
                        <span className="text-muted-foreground">No device assigned</span>
                      </SelectItem>
                      {isDevicesLoading ? (
                        <SelectItem value="" disabled>Loading…</SelectItem>
                      ) : (
                        devices?.map((d) => (
                          <SelectItem key={d.id} value={String(d.id)}>
                            <div className="flex items-center gap-2">
                              <Smartphone className="w-3.5 h-3.5 text-muted-foreground" />
                              <span className="font-mono text-xs">{d.deviceIdentifier}</span>
                              <span className="text-muted-foreground text-xs">— {d.model}</span>
                            </div>
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            {/* Form action buttons */}
            <div className="flex gap-3 pt-1">
              <Button
                type="button" variant="outline"
                className="flex-1 border-border/50"
                onClick={() => { setAddOpen(false); setEditProxy(null); }}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="flex-1 gap-2"
                disabled={saving}
                style={{
                  background: "linear-gradient(135deg,hsl(217,91%,55%),hsl(217,91%,65%))",
                  boxShadow:  "0 4px 12px rgba(37,99,235,0.25)",
                }}
              >
                {saving
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
                  : isEditing
                    ? "Save Changes"
                    : <><Plus className="w-4 h-4" /> Add Proxy</>
                }
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ════════════════════════════════════════════════════════
          Delete Confirmation AlertDialog
          Warns user before permanently removing a proxy.
          Also notes if a device assignment will be lost.
      ════════════════════════════════════════════════════════ */}
      <AlertDialog open={!!deleteProxy} onOpenChange={(o) => !o && setDeleteProxy(null)}>
        <AlertDialogContent className="bg-card border-border/60">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete proxy?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteProxy?.label ?? "This proxy"}</strong> will be permanently removed.
              {/* Warn if deleting an assigned proxy — the device link will be lost */}
              {deleteProxy?.deviceId && " It will also be unassigned from its device."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
