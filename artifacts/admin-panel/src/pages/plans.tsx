import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { getPlanMeta } from "@/lib/plan-meta";
import { useAllPlanNames } from "@/hooks/use-all-plan-names";
import {
  ClipboardList, Plus, Pencil, Trash2, Loader2, Search, ExternalLink,
} from "lucide-react";

import { apiFetch, apiJson } from "@/lib/api";

const SCHEMA_IMPLEMENTORS   = ["Us (Signal AEO)", "Client Developer", "Other"];

/* ── Types ─────────────────────────────────────────────────── */
interface AeoPlan {
  id: number;
  clientId: number;
  clientBusinessName: string | null;
  businessName: string | null;
  planType: string;
  serviceCategory: string | null;
  targetCityRadius: string | null;
  sampleQuestion1: string | null;
  sampleQuestion2: string | null;
  sampleQuestion3: string | null;
  sampleQuestion4: string | null;
  sampleQuestion5: string | null;
  sampleQuestion6: string | null;
  sampleQuestion7: string | null;
  sampleQuestion8: string | null;
  sampleQuestion9: string | null;
  sampleQuestion10: string | null;
  currentAnswerPresence: string | null;
  searchBoostTarget: number | null;
  monthlyAeoBudget: number | null;
  schemaImplementor: string | null;
}

interface Client {
  id: number;
  businessName: string | null;
  searchAddress?: string | null;
  publishedAddress?: string | null;
}

type PlanFormData = Omit<AeoPlan, "id" | "clientId" | "clientBusinessName">;

const EMPTY_FORM: PlanFormData = {
  businessName: "",
  planType: "",
  serviceCategory: "",
  targetCityRadius: "",
  sampleQuestion1: "",
  sampleQuestion2: "",
  sampleQuestion3: "",
  sampleQuestion4: "",
  sampleQuestion5: "",
  sampleQuestion6: "",
  sampleQuestion7: "",
  sampleQuestion8: "",
  sampleQuestion9: "",
  sampleQuestion10: "",
  currentAnswerPresence: "",
  searchBoostTarget: null,
  monthlyAeoBudget: null,
  schemaImplementor: "",
};

/* ── Plan form component ────────────────────────────────────── */
function PlanForm({
  values,
  onChange,
  clients,
  selectedClientId,
  onClientChange,
  hideClientSelector,
}: {
  values: PlanFormData;
  onChange: (v: PlanFormData) => void;
  clients: Client[];
  selectedClientId: number | null;
  onClientChange: (id: number) => void;
  hideClientSelector?: boolean;
}) {
  const allPlanNames = useAllPlanNames();
  const [customPlanType, setCustomPlanType]               = useState(!allPlanNames.includes(values.planType) && values.planType !== "");
  const [customSchemaImplementor, setCustomSchemaImpl]    = useState(!SCHEMA_IMPLEMENTORS.includes(values.schemaImplementor ?? "") && (values.schemaImplementor ?? "") !== "");

  function set(key: keyof PlanFormData, val: unknown) {
    onChange({ ...values, [key]: val });
  }

  const questions = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {/* Client selector */}
        {!hideClientSelector && (
          <div className="space-y-2 sm:col-span-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Client *</Label>
            <Select
              value={selectedClientId != null ? String(selectedClientId) : ""}
              onValueChange={(v) => onClientChange(Number(v))}
            >
              <SelectTrigger className="h-10 bg-muted/30 border-border/60">
                <SelectValue placeholder="Select a client" />
              </SelectTrigger>
              <SelectContent>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    <div className="flex flex-col gap-0">
                      <span className="font-bold">{c.businessName ?? `Client #${c.id}`}</span>
                      {c.searchAddress && <span className="text-xs text-muted-foreground">Search: {c.searchAddress}</span>}
                      {c.publishedAddress && <span className="text-xs text-muted-foreground">GMB: {c.publishedAddress}</span>}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Business Name */}
        <div className="space-y-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Business Name</Label>
          <Input
            className="h-10 bg-muted/30 border-border/60"
            placeholder="Override or leave blank to use client name"
            value={values.businessName ?? ""}
            onChange={(e) => set("businessName", e.target.value)}
          />
        </div>

        {/* Plan Type */}
        <div className="space-y-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Type of Plan *</Label>
          {!customPlanType ? (
            <div className="flex gap-2">
              <Select
                value={allPlanNames.includes(values.planType) ? values.planType : ""}
                onValueChange={(v) => {
                  if (v === "__custom__") { setCustomPlanType(true); set("planType", ""); }
                  else set("planType", v);
                }}
              >
                <SelectTrigger className="h-10 bg-muted/30 border-border/60">
                  <SelectValue placeholder="Select plan type" />
                </SelectTrigger>
                <SelectContent>
                  {allPlanNames.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                  <SelectItem value="__custom__">Custom...</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input
                className="h-10 bg-muted/30 border-border/60"
                placeholder="Enter custom plan type"
                value={values.planType}
                onChange={(e) => set("planType", e.target.value)}
              />
              <Button variant="ghost" size="sm" className="text-xs px-2 text-muted-foreground" onClick={() => { setCustomPlanType(false); set("planType", ""); }}>
                ← Presets
              </Button>
            </div>
          )}
        </div>

        {/* Service Category */}
        <div className="space-y-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Service Category</Label>
          <Input
            className="h-10 bg-muted/30 border-border/60"
            placeholder="e.g. Airport Black Car Service"
            value={values.serviceCategory ?? ""}
            onChange={(e) => set("serviceCategory", e.target.value)}
          />
        </div>

        {/* Target City/Radius */}
        <div className="space-y-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Target City / Radius</Label>
          <Input
            className="h-10 bg-muted/30 border-border/60"
            placeholder="e.g. Provo, UT — 30 mi radius"
            value={values.targetCityRadius ?? ""}
            onChange={(e) => set("targetCityRadius", e.target.value)}
          />
        </div>
      </div>

      {/* 10 Sample Questions */}
      <div className="space-y-2">
        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">10 Sample Questions</Label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {questions.map((n) => {
            const key = `sampleQuestion${n}` as keyof PlanFormData;
            return (
              <div key={n} className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-5 text-right flex-shrink-0">{n}.</span>
                <Input
                  className="h-9 bg-muted/30 border-border/60 text-sm"
                  placeholder={`Question ${n}`}
                  value={(values[key] as string) ?? ""}
                  onChange={(e) => set(key, e.target.value)}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom fields */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div className="space-y-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Current Answer Presence</Label>
          <Input
            className="h-10 bg-muted/30 border-border/60"
            placeholder="e.g. 0% (typical)"
            value={values.currentAnswerPresence ?? ""}
            onChange={(e) => set("currentAnswerPresence", e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">3-Month Search Boost Target</Label>
          <Input
            type="number"
            className="h-10 bg-muted/30 border-border/60"
            placeholder="e.g. 450"
            value={values.searchBoostTarget ?? ""}
            onChange={(e) => set("searchBoostTarget", e.target.value !== "" ? Number(e.target.value) : null)}
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Monthly AEO Budget ($)</Label>
          <Input
            type="number"
            className="h-10 bg-muted/30 border-border/60"
            placeholder="e.g. 500.00"
            value={values.monthlyAeoBudget ?? ""}
            onChange={(e) => set("monthlyAeoBudget", e.target.value !== "" ? Number(e.target.value) : null)}
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Who Implements Schema</Label>
          {!customSchemaImplementor ? (
            <Select
              value={SCHEMA_IMPLEMENTORS.includes(values.schemaImplementor ?? "") ? (values.schemaImplementor ?? "") : ""}
              onValueChange={(v) => {
                if (v === "__custom__") { setCustomSchemaImpl(true); set("schemaImplementor", ""); }
                else set("schemaImplementor", v);
              }}
            >
              <SelectTrigger className="h-10 bg-muted/30 border-border/60">
                <SelectValue placeholder="Select implementor" />
              </SelectTrigger>
              <SelectContent>
                {SCHEMA_IMPLEMENTORS.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
                <SelectItem value="__custom__">Other (custom)…</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <div className="flex gap-2">
              <Input
                className="h-10 bg-muted/30 border-border/60"
                placeholder="Describe who implements"
                value={values.schemaImplementor ?? ""}
                onChange={(e) => set("schemaImplementor", e.target.value)}
              />
              <Button variant="ghost" size="sm" className="text-xs px-2 text-muted-foreground" onClick={() => { setCustomSchemaImpl(false); set("schemaImplementor", ""); }}>
                ← Presets
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Plans Page
══════════════════════════════════════════════════════════ */
export default function Plans() {
  const { toast } = useToast();

  const [plans, setPlans]           = useState<AeoPlan[]>([]);
  const [clients, setClients]       = useState<Client[]>([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState("");

  /* dialog state */
  const [dialogOpen, setDialogOpen]           = useState(false);
  const [editingPlan, setEditingPlan]         = useState<AeoPlan | null>(null);
  const [formValues, setFormValues]           = useState<PlanFormData>(EMPTY_FORM);
  const [selectedClientId, setClientId]       = useState<number | null>(null);
  const [saving, setSaving]                   = useState(false);
  const [deleteConfirm, setDeleteConfirm]     = useState<AeoPlan | null>(null);
  const [deleting, setDeleting]               = useState(false);

  /* ── Fetch all plans ── */
  const fetchPlans = useCallback(async () => {
    try {
      const data = await apiJson<AeoPlan[]>("/api/aeo-plans");
      setPlans(data);
    } catch {
      toast({ title: "Failed to load plans", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  /* ── Fetch clients for dropdown ── */
  const fetchClients = useCallback(async () => {
    try {
      const data = await apiJson<Client[] | { clients: Client[] }>("/api/clients");
      setClients(Array.isArray(data) ? data : ((data as { clients: Client[] }).clients ?? []));
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchPlans();
    fetchClients();
  }, [fetchPlans, fetchClients]);

  /* ── Open Add dialog ── */
  function openAdd() {
    setEditingPlan(null);
    setFormValues(EMPTY_FORM);
    setClientId(null);
    setDialogOpen(true);
  }

  /* ── Open Edit dialog ── */
  function openEdit(plan: AeoPlan) {
    setEditingPlan(plan);
    setClientId(plan.clientId);
    setFormValues({
      businessName:          plan.businessName,
      planType:              plan.planType,
      serviceCategory:       plan.serviceCategory,
      targetCityRadius:      plan.targetCityRadius,
      sampleQuestion1:       plan.sampleQuestion1,
      sampleQuestion2:       plan.sampleQuestion2,
      sampleQuestion3:       plan.sampleQuestion3,
      sampleQuestion4:       plan.sampleQuestion4,
      sampleQuestion5:       plan.sampleQuestion5,
      sampleQuestion6:       plan.sampleQuestion6,
      sampleQuestion7:       plan.sampleQuestion7,
      sampleQuestion8:       plan.sampleQuestion8,
      sampleQuestion9:       plan.sampleQuestion9,
      sampleQuestion10:      plan.sampleQuestion10,
      currentAnswerPresence: plan.currentAnswerPresence,
      searchBoostTarget:     plan.searchBoostTarget,
      monthlyAeoBudget:      plan.monthlyAeoBudget,
      schemaImplementor:     plan.schemaImplementor,
    });
    setDialogOpen(true);
  }

  /* ── Save (create or update) ── */
  async function handleSave() {
    if (!selectedClientId) {
      toast({ title: "Please select a client", variant: "destructive" }); return;
    }
    if (!formValues.planType.trim()) {
      toast({ title: "Plan type is required", variant: "destructive" }); return;
    }

    setSaving(true);
    try {
      if (editingPlan) {
        await apiJson(`/api/clients/${selectedClientId}/aeo-plans/${editingPlan.id}`, {
          method: "PATCH",
          body: JSON.stringify(formValues),
        });
      } else {
        await apiJson(`/api/clients/${selectedClientId}/aeo-plans`, {
          method: "POST",
          body: JSON.stringify(formValues),
        });
      }

      toast({ title: editingPlan ? "Plan updated" : "Plan created" });
      setDialogOpen(false);
      await fetchPlans();
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

  /* ── Delete ── */
  async function handleDelete(plan: AeoPlan) {
    setDeleting(true);
    try {
      const res = await apiFetch(`/api/clients/${plan.clientId}/aeo-plans/${plan.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
      toast({ title: "Plan deleted" });
      setDeleteConfirm(null);
      await fetchPlans();
    } catch {
      toast({ title: "Delete failed", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  }

  /* ── Filtering ── */
  const filtered = plans.filter((p) => {
    const q = search.toLowerCase();
    return !q
      || (p.clientBusinessName ?? "").toLowerCase().includes(q)
      || (p.businessName ?? "").toLowerCase().includes(q)
      || p.planType.toLowerCase().includes(q)
      || (p.serviceCategory ?? "").toLowerCase().includes(q)
      || (p.targetCityRadius ?? "").toLowerCase().includes(q);
  });

  /* ── Render ─────────────────────────────────────────────── */
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <ClipboardList className="w-6 h-6 text-primary" />
            Campaigns
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">All client AEO campaigns across clients</p>
        </div>
        <Button onClick={openAdd} className="gap-1.5">
          <Plus className="w-4 h-4" /> Add Plan
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <Input
          className="pl-9 h-9"
          placeholder="Search plans…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border/50 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead>Client</TableHead>
              <TableHead>Plan Type</TableHead>
              <TableHead>Tier</TableHead>
              <TableHead>Service Category</TableHead>
              <TableHead>Target City / Radius</TableHead>
              <TableHead>Answer Presence</TableHead>
              <TableHead>3-Mo Target</TableHead>
              <TableHead>Monthly Budget</TableHead>
              <TableHead>Schema By</TableHead>
              <TableHead className="w-20 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 10 }).map((__, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="h-32 text-center text-muted-foreground">
                  {plans.length === 0 ? "No AEO plans yet. Click Add Plan to create one." : "No plans match your search."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((plan) => {
                return (
                  <TableRow key={plan.id} className="group hover:bg-muted/30">
                    {/* Client name → link to client detail */}
                    <TableCell className="font-medium">
                        {(() => {
                          const c = clients.find((x) => x.id === plan.clientId);
                          return (
                            <div className="flex flex-col gap-0.5">
                              <Link
                                href={`/clients/${plan.clientId}`}
                                className="text-primary hover:underline flex items-center gap-1"
                              >
                                {plan.clientBusinessName ?? `Client #${plan.clientId}`}
                                <ExternalLink className="w-3 h-3 opacity-50" />
                              </Link>
                              {c?.searchAddress && <span className="text-xs text-muted-foreground">{c.searchAddress}</span>}
                              {c?.publishedAddress && <span className="text-xs text-muted-foreground">{c.publishedAddress}</span>}
                            </div>
                          );
                        })()}
                      </TableCell>

                      <TableCell>
                        {(() => {
                          const meta = getPlanMeta(plan.planType);
                          return (
                            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${meta.badgeClass} whitespace-nowrap`}>
                              {plan.planType}
                            </span>
                          );
                        })()}
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const meta = getPlanMeta(plan.planType);
                          return (
                            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${meta.tierClass} whitespace-nowrap`}>
                              {meta.tier}
                            </span>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="text-sm">{plan.serviceCategory ?? <span className="text-muted-foreground/40">—</span>}</TableCell>
                      <TableCell className="text-sm">{plan.targetCityRadius ?? <span className="text-muted-foreground/40">—</span>}</TableCell>
                      <TableCell className="text-sm">{plan.currentAnswerPresence ?? <span className="text-muted-foreground/40">—</span>}</TableCell>
                      <TableCell className="text-sm">
                        {plan.searchBoostTarget != null
                          ? plan.searchBoostTarget.toLocaleString()
                          : <span className="text-muted-foreground/40">—</span>}
                      </TableCell>
                      <TableCell className="text-sm">
                        {plan.monthlyAeoBudget != null
                          ? `$${Number(plan.monthlyAeoBudget).toLocaleString("en-US", { minimumFractionDigits: 2 })}`
                          : <span className="text-muted-foreground/40">—</span>}
                      </TableCell>
                      <TableCell className="text-sm">{plan.schemaImplementor ?? <span className="text-muted-foreground/40">—</span>}</TableCell>

                      {/* Actions */}
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost" size="sm"
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                            onClick={() => openEdit(plan)}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost" size="sm"
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-red-500"
                            onClick={() => setDeleteConfirm(plan)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Plan count */}
      {!loading && (
        <p className="text-xs text-muted-foreground">
          {filtered.length} {filtered.length === 1 ? "plan" : "plans"}
          {search && ` matching "${search}"`}
        </p>
      )}

      {/* ════ ADD / EDIT DIALOG ════ */}
      <Dialog open={dialogOpen} onOpenChange={(v) => { if (!saving) setDialogOpen(v); }}>
        <DialogContent className="w-screen h-screen max-w-none max-h-none rounded-none border-0 bg-card overflow-y-auto flex flex-col">
          <DialogHeader className="px-8 pt-8 pb-0">
            <div className="flex items-center gap-3 mb-1">
              <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center">
                <ClipboardList className="w-4 h-4 text-primary" />
              </div>
              <DialogTitle className="text-xl">
                {editingPlan ? "Edit Campaign" : "Add Campaign"}
              </DialogTitle>
            </div>
            <DialogDescription className="text-sm text-muted-foreground">
              {editingPlan
                ? `Editing campaign for ${editingPlan.clientBusinessName ?? `Client #${editingPlan.clientId}`}`
                : "Create a new AEO campaign for a client."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 px-8 py-6 overflow-y-auto">
            <PlanForm
              values={formValues}
              onChange={setFormValues}
              clients={clients}
              selectedClientId={selectedClientId}
              onClientChange={setClientId}
              hideClientSelector={!!editingPlan}
            />
          </div>

          <div className="px-8 py-5 border-t border-border/50 flex justify-end gap-3">
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving} className="gap-1.5 min-w-[110px]">
              {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : editingPlan ? "Save Changes" : "Create Plan"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ════ DELETE CONFIRM DIALOG ════ */}
      <Dialog open={!!deleteConfirm} onOpenChange={(v) => { if (!deleting && !v) setDeleteConfirm(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Plan?</DialogTitle>
            <DialogDescription>
              This will permanently delete the <strong>{deleteConfirm?.planType}</strong> plan
              {deleteConfirm?.serviceCategory ? ` (${deleteConfirm.serviceCategory})` : ""} for{" "}
              <strong>{deleteConfirm?.clientBusinessName ?? `Client #${deleteConfirm?.clientId}`}</strong>.
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setDeleteConfirm(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleting}
              onClick={() => deleteConfirm && handleDelete(deleteConfirm)}
              className="gap-1.5"
            >
              {deleting ? <><Loader2 className="w-4 h-4 animate-spin" /> Deleting…</> : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
