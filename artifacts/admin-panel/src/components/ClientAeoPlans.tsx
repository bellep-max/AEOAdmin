import React, { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ClipboardList, Plus, Pencil, Trash2, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { useAllPlanNames } from "@/hooks/use-all-plan-names";

const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
function rawFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string> ?? {}) };
  if (BASE.includes("ngrok")) headers["ngrok-skip-browser-warning"] = "true";
  return fetch(BASE + path, { ...init, headers });
}

const SCHEMA_IMPLEMENTORS = ["Us (Signal AEO)", "Client Developer", "Other"];

interface AeoPlan {
  id: number;
  clientId: number;
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

type PlanFormData = Omit<AeoPlan, "id" | "clientId">;

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

/* ── Plan form used for both Add and Edit ─────────────────── */
function PlanForm({
  values,
  onChange,
  clientBusinessName,
}: {
  values: PlanFormData;
  onChange: (v: PlanFormData) => void;
  clientBusinessName: string;
}) {
  const allPlanNames = useAllPlanNames();
  const [customSchemaImplementor, setCustomSchemaImplementor] = useState(!SCHEMA_IMPLEMENTORS.includes(values.schemaImplementor ?? "") && (values.schemaImplementor ?? "") !== "");

  function set(key: keyof PlanFormData, val: unknown) {
    onChange({ ...values, [key]: val });
  }

  const questions = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

  return (
    <div className="space-y-6">
      {/* Business Name */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div className="space-y-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Business Name</Label>
          <Input
            className="h-10 bg-muted/30 border-border/60"
            placeholder={clientBusinessName || "Business name"}
            value={values.businessName ?? ""}
            onChange={(e) => set("businessName", e.target.value)}
          />
        </div>

        {/* Plan Type */}
        <div className="space-y-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Type of Plan</Label>
          <Select
            value={allPlanNames.includes(values.planType) ? values.planType : ""}
            onValueChange={(v) => set("planType", v)}
          >
            <SelectTrigger className="h-10 bg-muted/30 border-border/60">
              <SelectValue placeholder="Select plan type" />
            </SelectTrigger>
            <SelectContent>
              {allPlanNames.map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
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
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">3-Month Search Boost Target (# of question searches)</Label>
          <Input
            type="number"
            className="h-10 bg-muted/30 border-border/60"
            placeholder="e.g. 450"
            value={values.searchBoostTarget ?? ""}
            onChange={(e) => set("searchBoostTarget", e.target.value !== "" ? Number(e.target.value) : null)}
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Monthly AEO Budget</Label>
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
                if (v === "__custom__") { setCustomSchemaImplementor(true); set("schemaImplementor", ""); }
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
              <Button variant="ghost" size="sm" className="text-xs px-2 text-muted-foreground" onClick={() => { setCustomSchemaImplementor(false); set("schemaImplementor", ""); }}>
                ← Presets
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Plan card (collapsed/expanded view) ──────────────────── */
function PlanCard({
  plan,
  onEdit,
  onDelete,
}: {
  plan: AeoPlan;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const questions = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
  const filledQuestions = questions
    .map((n) => ({ n, q: plan[`sampleQuestion${n}` as keyof AeoPlan] as string | null }))
    .filter((x) => x.q);

  return (
    <div className="rounded-xl border border-border/60 bg-card">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 font-semibold">
            {plan.planType}
          </Badge>
          {plan.serviceCategory && (
            <span className="text-sm text-foreground font-medium">{plan.serviceCategory}</span>
          )}
          {plan.targetCityRadius && (
            <span className="text-xs text-muted-foreground">{plan.targetCityRadius}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground" onClick={onEdit}>
            <Pencil className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-red-500" onClick={onDelete}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground" onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {/* Summary row always visible */}
      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-border/40 border-b border-border/40">
        {[
          { label: "Answer Presence",    value: plan.currentAnswerPresence ?? "—" },
          { label: "3-Month Target",     value: plan.searchBoostTarget != null ? plan.searchBoostTarget.toLocaleString() + " searches" : "—" },
          { label: "Monthly Budget",     value: plan.monthlyAeoBudget != null ? `$${Number(plan.monthlyAeoBudget).toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "—" },
          { label: "Schema Implementor", value: plan.schemaImplementor ?? "—" },
        ].map(({ label, value }) => (
          <div key={label} className="px-4 py-3">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">{label}</p>
            <p className="text-sm font-medium text-foreground">{value}</p>
          </div>
        ))}
      </div>

      {/* Expanded: sample questions */}
      {expanded && (
        <div className="px-4 py-4 space-y-3">
          {filledQuestions.length > 0 ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Sample Questions</p>
              <ol className="space-y-1.5 list-none">
                {filledQuestions.map(({ n, q }) => (
                  <li key={n} className="flex items-start gap-2 text-sm">
                    <span className="text-xs text-muted-foreground mt-0.5 w-5 flex-shrink-0">{n}.</span>
                    <span className="text-foreground">{q}</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">No sample questions added yet.</p>
          )}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Main exported component
══════════════════════════════════════════════════════════ */
export default function ClientAeoPlans({
  clientId,
  clientBusinessName,
}: {
  clientId: number;
  clientBusinessName: string;
}) {
  const { toast } = useToast();
  const [plans, setPlans]     = useState<AeoPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);

  const [addOpen,  setAddOpen]  = useState(false);
  const [editPlan, setEditPlan] = useState<AeoPlan | null>(null);
  const [formData, setFormData] = useState<PlanFormData>({ ...EMPTY_FORM, businessName: clientBusinessName });

  const fetchPlans = useCallback(async () => {
    setLoading(true);
    try {
      const r = await rawFetch(`/api/clients/${clientId}/aeo-plans`, { credentials: "include" });
      setPlans(await r.json());
    } catch { setPlans([]); }
    finally { setLoading(false); }
  }, [clientId]);

  useEffect(() => { fetchPlans(); }, [fetchPlans]);

  function openAdd() {
    setFormData({ ...EMPTY_FORM, businessName: clientBusinessName });
    setAddOpen(true);
  }

  function openEdit(plan: AeoPlan) {
    setFormData({
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
    setEditPlan(plan);
  }

  async function handleSave() {
    if (!formData.planType.trim()) {
      toast({ title: "Plan type is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      if (editPlan) {
        await rawFetch(`/api/clients/${clientId}/aeo-plans/${editPlan.id}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formData),
        });
        toast({ title: "Plan updated" });
        setEditPlan(null);
      } else {
        await rawFetch(`/api/clients/${clientId}/aeo-plans`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formData),
        });
        toast({ title: "Plan added" });
        setAddOpen(false);
      }
      fetchPlans();
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    } finally { setSaving(false); }
  }

  async function handleDelete(id: number) {
    try {
      await rawFetch(`/api/clients/${clientId}/aeo-plans/${id}`, { method: "DELETE", credentials: "include" });
      toast({ title: "Plan deleted" });
      fetchPlans();
    } catch {
      toast({ title: "Delete failed", variant: "destructive" });
    }
  }

  const isDialogOpen = addOpen || editPlan !== null;

  return (
    <>
      <Card className="border-border/50">
        <CardHeader className="pb-4 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-primary" />
            AEO Plans
            {plans.length > 0 && (
              <Badge variant="outline" className="text-xs border-primary/20 text-primary bg-primary/5">{plans.length}</Badge>
            )}
          </CardTitle>
          <Button
            variant="outline" size="sm"
            className="h-7 px-2 gap-1 text-xs border-primary/30 text-primary hover:bg-primary/10"
            onClick={openAdd}
          >
            <Plus className="w-3 h-3" /> Add Plan
          </Button>
        </CardHeader>

        <CardContent>
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-16 w-full rounded-xl" />
              <Skeleton className="h-16 w-full rounded-xl" />
            </div>
          ) : plans.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2 border border-dashed border-border/50 rounded-xl">
              <ClipboardList className="w-8 h-8 opacity-30" />
              <p className="text-sm">No AEO plans yet — click <strong>Add Plan</strong></p>
            </div>
          ) : (
            <div className="space-y-3">
              {plans.map((plan) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  onEdit={() => openEdit(plan)}
                  onDelete={() => handleDelete(plan.id)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add / Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={(o) => { if (!o) { setAddOpen(false); setEditPlan(null); } }}>
        <DialogContent className="w-screen h-screen max-w-none max-h-none rounded-none border-0 bg-card overflow-y-auto flex flex-col">
          <DialogHeader className="px-8 pt-8 pb-0">
            <div className="flex items-center gap-3 mb-1">
              <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center">
                <ClipboardList className="w-4 h-4 text-primary" />
              </div>
              <DialogTitle className="text-xl">{editPlan ? "Edit AEO Plan" : "Add AEO Plan"}</DialogTitle>
            </div>
            <DialogDescription className="sr-only">{editPlan ? "Edit AEO Plan" : "Add AEO Plan"}</DialogDescription>
          </DialogHeader>

          <div className="flex-1 flex flex-col items-center justify-start px-8 py-6">
            <div className="w-full max-w-3xl space-y-6">
              <PlanForm values={formData} onChange={setFormData} clientBusinessName={clientBusinessName} />

              <div className="flex gap-4 pt-6">
                <Button
                  variant="outline" size="lg" className="flex-1 border-border/50 h-12"
                  onClick={() => { setAddOpen(false); setEditPlan(null); }}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button
                  size="lg" className="flex-1 gap-2 h-12"
                  disabled={saving}
                  onClick={handleSave}
                  style={{
                    background: "linear-gradient(135deg,hsl(217,91%,55%),hsl(217,91%,65%))",
                    boxShadow:  "0 4px 12px rgba(37,99,235,0.25)",
                  }}
                >
                  {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : "Save Plan"}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
