import { useState } from "react";
import { useGetDevices, useGetDeviceFarmStatus } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Smartphone, Clock, Activity, Plus, MoreVertical, Loader2,
  Wifi, WifiOff, Power, Search, Filter,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/* ── Your device models ───────────────────────────────── */
const DEVICE_MODELS = [
  "Infinix Smart 8",
  "Samsung A06",
  "Tecno Spark Go",
  "Realme C16",
  "Redmi",
];

/* ── Model colors (consistent per brand) ─────────────── */
const MODEL_COLORS: Record<string, string> = {
  "Infinix Smart 8": "bg-violet-500/15 text-violet-400 border-violet-500/20",
  "Samsung A06":     "bg-blue-500/15 text-blue-400 border-blue-500/20",
  "Tecno Spark Go":  "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  "Realme C16":      "bg-amber-500/15 text-amber-400 border-amber-500/20",
  "Redmi":           "bg-red-500/15 text-red-400 border-red-500/20",
};

const addSchema = z.object({
  deviceIdentifier: z.string().min(2, "Identifier required (e.g. DEV-031)"),
  model:            z.string().min(1, "Select a model"),
  status:           z.enum(["available", "in_use", "offline"]),
});
type AddForm = z.infer<typeof addSchema>;

/* ── Status pill helper ───────────────────────────────── */
function StatusBadge({ status }: { status: string }) {
  const styles =
    status === "available" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
    status === "in_use"    ? "bg-primary/10 text-primary border-primary/20" :
                             "bg-muted/60 text-muted-foreground border-border/40";
  return (
    <Badge variant="outline" className={`text-[10px] font-semibold ${styles}`}>
      {status === "in_use" ? "In Use" : status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  );
}

export default function Devices() {
  const queryClient = useQueryClient();
  const { toast }   = useToast();

  const { data: farmStatus, isLoading: isStatusLoading } = useGetDeviceFarmStatus();
  const { data: devices,    isLoading: isDevicesLoading } = useGetDevices();

  const [addOpen, setAddOpen]         = useState(false);
  const [saving, setSaving]           = useState(false);
  const [search, setSearch]           = useState("");
  const [modelFilter, setModelFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  /* Add device form */
  const form = useForm<AddForm>({
    resolver: zodResolver(addSchema),
    defaultValues: { deviceIdentifier: "", model: "", status: "available" },
  });

  async function onAdd(values: AddForm) {
    setSaving(true);
    try {
      const res = await fetch(`${BASE}/api/devices`, {
        method:      "POST",
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body:        JSON.stringify(values),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      await queryClient.invalidateQueries({ queryKey: ["/api/devices"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/devices/farm-status"] });
      toast({ title: "Device added" });
      form.reset();
      setAddOpen(false);
    } catch (err: unknown) {
      toast({ title: "Failed to add device", description: err instanceof Error ? err.message : "", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(id: number, status: string) {
    try {
      const res = await fetch(`${BASE}/api/devices/${id}`, {
        method:      "PATCH",
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body:        JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error();
      await queryClient.invalidateQueries({ queryKey: ["/api/devices"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/devices/farm-status"] });
      toast({ title: `Device set to ${status.replace("_", " ")}` });
    } catch {
      toast({ title: "Update failed", variant: "destructive" });
    }
  }

  async function toggleRetired(id: number, retiredToday: boolean) {
    try {
      const res = await fetch(`${BASE}/api/devices/${id}`, {
        method:      "PATCH",
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body:        JSON.stringify({ retiredToday: !retiredToday }),
      });
      if (!res.ok) throw new Error();
      await queryClient.invalidateQueries({ queryKey: ["/api/devices"] });
      toast({ title: !retiredToday ? "Marked as retired today" : "Retirement cleared" });
    } catch {
      toast({ title: "Update failed", variant: "destructive" });
    }
  }

  /* Model breakdown counts */
  const modelCounts = DEVICE_MODELS.map((m) => ({
    model: m,
    total:     devices?.filter((d) => d.model === m).length ?? 0,
    available: devices?.filter((d) => d.model === m && d.status === "available").length ?? 0,
    offline:   devices?.filter((d) => d.model === m && d.status === "offline").length ?? 0,
  }));

  /* Filtered device list */
  const filtered = devices?.filter((d) => {
    const matchSearch = (d.deviceIdentifier + d.model).toLowerCase().includes(search.toLowerCase());
    const matchModel  = modelFilter === "all" || d.model === modelFilter;
    const matchStatus = statusFilter === "all" || d.status === statusFilter;
    return matchSearch && matchModel && matchStatus;
  });

  /* Next device identifier suggestion */
  const nextId = devices?.length
    ? `DEV-${String(devices.length + 1).padStart(3, "0")}`
    : "DEV-001";

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Device Farm</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {devices?.length ?? 0} Android devices · 1 search per device per day
          </p>
        </div>
        <Button
          className="gap-2"
          style={{ background: "linear-gradient(135deg,hsl(217,91%,55%),hsl(217,91%,65%))", boxShadow: "0 4px 12px rgba(37,99,235,0.3)" }}
          onClick={() => { form.reset({ deviceIdentifier: nextId, model: "", status: "available" }); setAddOpen(true); }}
        >
          <Plus className="w-4 h-4" /> Add Device
        </Button>
      </div>

      {/* ── Status summary ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {isStatusLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)
        ) : (
          [
            { label: "Total Devices",  value: farmStatus?.total      ?? 0, color: "text-foreground",  icon: Smartphone  },
            { label: "Available",       value: farmStatus?.available  ?? 0, color: "text-emerald-400", icon: Wifi        },
            { label: "In Use",          value: farmStatus?.inUse      ?? 0, color: "text-primary",     icon: Activity    },
            { label: "Offline",         value: farmStatus?.offline    ?? 0, color: "text-muted-foreground", icon: WifiOff },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-border/50 bg-card/60 p-4">
              <div className="flex items-center gap-2 mb-2">
                <s.icon className={`w-4 h-4 ${s.color}`} />
                <span className="text-xs text-muted-foreground">{s.label}</span>
              </div>
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            </div>
          ))
        )}
      </div>

      {/* ── Model breakdown ── */}
      <div className="rounded-xl border border-border/50 bg-card/40 p-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Fleet by Model</p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {modelCounts.map((m) => (
            <button
              key={m.model}
              onClick={() => setModelFilter(modelFilter === m.model ? "all" : m.model)}
              className={`rounded-lg border p-3 text-left transition-all ${
                modelFilter === m.model
                  ? "border-primary/50 bg-primary/10"
                  : "border-border/40 bg-muted/20 hover:border-border/70"
              }`}
            >
              <div className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border mb-2 ${MODEL_COLORS[m.model] ?? "bg-muted/40 text-muted-foreground"}`}>
                <Smartphone className="w-2.5 h-2.5" />
                {m.model}
              </div>
              <p className="text-xl font-bold text-foreground">{m.total}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                <span className="text-emerald-400">{m.available} ok</span>
                {m.offline > 0 && <span className="text-muted-foreground ml-1">{m.offline} offline</span>}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            type="search"
            placeholder="Search devices…"
            className="pl-9 bg-card/60 border-border/50 h-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          {["all", "available", "in_use", "offline"].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                statusFilter === s
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border/50 text-muted-foreground hover:border-border bg-transparent"
              }`}
            >
              {s === "all" ? "All" : s === "in_use" ? "In Use" : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* ── Device grid ── */}
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {isDevicesLoading ? (
          Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)
        ) : filtered?.length === 0 ? (
          <div className="col-span-full py-16 flex flex-col items-center gap-3 text-muted-foreground">
            <Smartphone className="w-10 h-10 opacity-20" />
            <p className="text-sm">No devices found</p>
            <Button size="sm" variant="outline" onClick={() => setAddOpen(true)} className="gap-1.5">
              <Plus className="w-3.5 h-3.5" /> Add your first device
            </Button>
          </div>
        ) : (
          filtered?.map((device) => {
            const modelColor = MODEL_COLORS[device.model] ?? "bg-muted/40 text-muted-foreground border-border/40";
            return (
              <div
                key={device.id}
                className="rounded-xl border border-border/50 bg-card/60 hover:bg-card/80 transition-all p-4 flex flex-col gap-3 group relative"
              >
                {/* Top row: ID + menu */}
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono text-muted-foreground/70">{device.deviceIdentifier}</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity">
                        <MoreVertical className="w-3.5 h-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="text-xs">
                      <DropdownMenuItem onClick={() => updateStatus(device.id, "available")} className="gap-2">
                        <Wifi className="w-3.5 h-3.5 text-emerald-400" /> Set Available
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => updateStatus(device.id, "in_use")} className="gap-2">
                        <Activity className="w-3.5 h-3.5 text-primary" /> Set In Use
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => updateStatus(device.id, "offline")} className="gap-2">
                        <WifiOff className="w-3.5 h-3.5 text-muted-foreground" /> Set Offline
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => toggleRetired(device.id, device.retiredToday)} className="gap-2">
                        <Power className="w-3.5 h-3.5 text-amber-400" />
                        {device.retiredToday ? "Clear Retirement" : "Mark Retired Today"}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {/* Model */}
                <div>
                  <div className={`inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${modelColor}`}>
                    <Smartphone className="w-2.5 h-2.5" />
                    {device.model}
                  </div>
                </div>

                {/* Status */}
                <div className="flex items-center justify-between mt-auto">
                  <StatusBadge status={device.status} />
                  {device.retiredToday && (
                    <Badge variant="outline" className="text-[9px] bg-amber-500/10 text-amber-400 border-amber-500/20">
                      Retired
                    </Badge>
                  )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between text-[10px] text-muted-foreground/60 border-t border-border/30 pt-2">
                  <span className="flex items-center gap-1">
                    <Activity className="w-2.5 h-2.5" />{device.sessionsToday ?? 0} today
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-2.5 h-2.5" />
                    {device.lastUsedAt
                      ? formatDistanceToNow(new Date(device.lastUsedAt), { addSuffix: true })
                      : "Never"}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ════════════════════════════════════════
          Add Device Dialog
      ════════════════════════════════════════ */}
      <Dialog open={addOpen} onOpenChange={(o) => { if (!saving) setAddOpen(o); }}>
        <DialogContent className="sm:max-w-[420px] border-border/60 bg-card">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center">
                <Smartphone className="w-4 h-4 text-primary" />
              </div>
              <DialogTitle>Add Device</DialogTitle>
            </div>
            <DialogDescription>
              Register a new Android device to the farm.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={form.handleSubmit(onAdd)} className="space-y-4 mt-2">
            {/* Device Identifier */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Device ID <span className="text-destructive">*</span>
              </Label>
              <Input
                className="bg-muted/30 border-border/60 h-10 font-mono"
                placeholder="DEV-031"
                {...form.register("deviceIdentifier")}
              />
              <p className="text-[10px] text-muted-foreground">Suggested next: <span className="font-mono text-primary">{nextId}</span></p>
              {form.formState.errors.deviceIdentifier && (
                <p className="text-xs text-destructive">{form.formState.errors.deviceIdentifier.message}</p>
              )}
            </div>

            {/* Model */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Model <span className="text-destructive">*</span>
              </Label>
              <Controller
                name="model"
                control={form.control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="bg-muted/30 border-border/60 h-10">
                      <SelectValue placeholder="Select model…" />
                    </SelectTrigger>
                    <SelectContent>
                      {DEVICE_MODELS.map((m) => (
                        <SelectItem key={m} value={m}>
                          <div className="flex items-center gap-2">
                            <Smartphone className="w-3.5 h-3.5 text-muted-foreground" />
                            {m}
                          </div>
                        </SelectItem>
                      ))}
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
              {form.formState.errors.model && (
                <p className="text-xs text-destructive">{form.formState.errors.model.message}</p>
              )}
            </div>

            {/* Status */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Initial Status</Label>
              <Controller
                name="status"
                control={form.control}
                render={({ field }) => (
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      { value: "available", label: "Available", color: "border-emerald-500/50 bg-emerald-500/10 text-emerald-400" },
                      { value: "in_use",    label: "In Use",    color: "border-primary/50 bg-primary/10 text-primary"             },
                      { value: "offline",   label: "Offline",   color: "border-border/60 bg-muted/20 text-muted-foreground"       },
                    ] as const).map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => field.onChange(opt.value)}
                        className={`px-2 py-2 rounded-lg border text-xs font-medium transition-all ${
                          field.value === opt.value ? opt.color : "border-border/40 text-muted-foreground hover:border-border/70 bg-transparent"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              />
            </div>

            <div className="flex gap-3 pt-2">
              <Button type="button" variant="outline" className="flex-1 border-border/50" onClick={() => setAddOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button
                type="submit"
                className="flex-1 gap-2"
                disabled={saving}
                style={{ background: "linear-gradient(135deg,hsl(217,91%,55%),hsl(217,91%,65%))", boxShadow: "0 4px 12px rgba(37,99,235,0.25)" }}
              >
                {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Adding…</> : <><Plus className="w-4 h-4" /> Add Device</>}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
