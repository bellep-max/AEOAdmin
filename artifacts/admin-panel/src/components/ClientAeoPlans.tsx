import React, { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { ClipboardList, Plus, Pencil, Trash2, Loader2, Key, ChevronDown, ChevronRight, Building2, Mail, CreditCard } from "lucide-react";
import { useLocation } from "wouter";
import { useAllPlanNames } from "@/hooks/use-all-plan-names";
import { getPlanMeta } from "@/lib/plan-meta";

const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
function rawFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string> ?? {}) };
  if (BASE.includes("ngrok")) headers["ngrok-skip-browser-warning"] = "true";
  return fetch(BASE + path, { ...init, headers });
}

const SCHEMA_IMPLEMENTORS = ["Us (Signal AEO)", "Client Developer", "Other"];

interface BusinessOption {
  id: number;
  name: string;
}

interface AeoPlan {
  id: number;
  clientId: number;
  businessId: number | null;
  name: string | null;
  businessName: string | null;
  planType: string;
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
  searchAddress: string | null;
  subscriptionId: string | null;
  subscriptionStartDate: string | null;
  nextBillingDate: string | null;
  cardLast4: string | null;
  createdBy: string | null;
}

interface ClientInfo {
  id: number;
  businessName: string;
  status?: string | null;
  planName?: string | null;
  contactEmail?: string | null;
  accountEmail?: string | null;
  accountType?: string | null;
  city?: string | null;
  state?: string | null;
  searchAddress?: string | null;
  publishedAddress?: string | null;
  gmbUrl?: string | null;
  websitePublishedOnGmb?: string | null;
  websiteLinkedOnGmb?: string | null;
}

interface KeywordRow {
  id: number;
  keywordText: string;
  keywordType?: number | null;
  isActive?: boolean | null;
  isPrimary?: number | null;
}

type PlanFormData = Omit<AeoPlan, "id" | "clientId">;

type ClientLocData = {
  publishedAddress: string;
  gmbUrl: string;
  websitePublishedOnGmb: string;
  websiteLinkedOnGmb: string;
};
const EMPTY_LOC: ClientLocData = { publishedAddress: "", gmbUrl: "", websitePublishedOnGmb: "", websiteLinkedOnGmb: "" };

const EMPTY_FORM: PlanFormData = {
  businessId: null,
  name: "",
  businessName: "",
  planType: "",
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
  searchAddress: "",
  subscriptionId: "",
  subscriptionStartDate: "",
  nextBillingDate: "",
  cardLast4: "",
};

/* ── Plan form used for both Add and Edit ─────────────────── */
function PlanForm({
  values,
  onChange,
  clientBusinessName,
  businesses,
  errors = {},
  locData,
  onLocChange,
}: {
  values: PlanFormData;
  onChange: (v: PlanFormData) => void;
  clientBusinessName: string;
  businesses: BusinessOption[];
  errors?: Record<string, string>;
  locData: ClientLocData;
  onLocChange: (v: ClientLocData) => void;
}) {
  const allPlanNames = useAllPlanNames();
  const [customSchemaImplementor, setCustomSchemaImplementor] = useState(!SCHEMA_IMPLEMENTORS.includes(values.schemaImplementor ?? "") && (values.schemaImplementor ?? "") !== "");

  function set(key: keyof PlanFormData, val: unknown) {
    onChange({ ...values, [key]: val });
  }

  const questions = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

  return (
    <div className="space-y-6">
      {/* Campaign Name preview (auto-generated from Business + Search Address) */}
      {(() => {
        const resolvedBizName = businesses.find((b) => b.id === values.businessId)?.name ?? values.businessName ?? "";
        const preview = [resolvedBizName, values.searchAddress].filter((v) => v && String(v).trim()).join(" — ");
        return (
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Campaign Name
            </Label>
            <div className="h-10 px-3 flex items-center text-sm rounded-md bg-muted/20 border border-dashed border-border/60 text-muted-foreground">
              {preview || "Auto-generated from Business + Search Address"}
            </div>
          </div>
        );
      })()}

      {/* Business */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div className="space-y-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Business <span className="text-red-500">*</span>
          </Label>
          {businesses.length === 0 ? (
            <div className="h-10 px-3 flex items-center text-xs text-muted-foreground bg-muted/30 border border-border/60 rounded-md">
              No businesses for this client. Add one first.
            </div>
          ) : (
            <Select
              value={values.businessId != null ? String(values.businessId) : ""}
              onValueChange={(v) => {
                const id = Number(v);
                const biz = businesses.find((b) => b.id === id);
                onChange({ ...values, businessId: id, businessName: biz?.name ?? "" });
              }}
            >
              <SelectTrigger className={`h-10 bg-muted/30 border-border/60 ${errors.businessId ? "border-red-500" : ""}`}>
                <SelectValue placeholder="Select a business" />
              </SelectTrigger>
              <SelectContent>
                {businesses.map((b) => (
                  <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {errors.businessId && <p className="text-xs text-red-500 mt-1">{errors.businessId}</p>}
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

      </div>

      {/* 10 Sample Questions */}
      {/* COMMENTED OUT - temporarily disabled
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
      */}

      {/* Bottom fields */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {/* COMMENTED OUT - temporarily disabled
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
        */}

        <div className="space-y-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Who Implements Schema <span className="text-red-500">*</span>
          </Label>
          {!customSchemaImplementor ? (
            <Select
              value={SCHEMA_IMPLEMENTORS.includes(values.schemaImplementor ?? "") ? (values.schemaImplementor ?? "") : ""}
              onValueChange={(v) => {
                if (v === "__custom__") { setCustomSchemaImplementor(true); set("schemaImplementor", ""); }
                else set("schemaImplementor", v);
              }}
            >
              <SelectTrigger className={`h-10 bg-muted/30 border-border/60 ${errors.schemaImplementor ? "border-red-500" : ""}`}>
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
                className={`h-10 bg-muted/30 border-border/60 ${errors.schemaImplementor ? "border-red-500" : ""}`}
                placeholder="Describe who implements"
                value={values.schemaImplementor ?? ""}
                onChange={(e) => set("schemaImplementor", e.target.value)}
              />
              <Button variant="ghost" size="sm" className="text-xs px-2 text-muted-foreground" onClick={() => { setCustomSchemaImplementor(false); set("schemaImplementor", ""); }}>
                ← Presets
              </Button>
            </div>
          )}
          {errors.schemaImplementor && (
            <p className="text-xs text-red-500 mt-1">{errors.schemaImplementor}</p>
          )}
        </div>
      </div>

      {/* Campaign Search Address */}
      <div className="border-t border-border/40 pt-5 space-y-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Campaign Search Address</p>
        <div className="space-y-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Search Address</Label>
          <Input
            className="h-10 bg-muted/30 border-border/60"
            placeholder="123 Main St, Austin, TX"
            value={values.searchAddress ?? ""}
            onChange={(e) => set("searchAddress", e.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">Where ranking checks will run from for this campaign.</p>
        </div>
      </div>

      {/* Subscription */}
      <div className="border-t border-border/40 pt-5 space-y-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Subscription</p>
        <p className="text-[11px] text-muted-foreground -mt-2">Manual entry for now — will later auto-sync with Recurly.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Subscription ID</Label>
            <Input
              className="h-10 bg-muted/30 border-border/60"
              placeholder="sub_xxxxxxxxxxxx"
              value={values.subscriptionId ?? ""}
              onChange={(e) => set("subscriptionId", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Card (last 4)</Label>
            <Input
              className="h-10 bg-muted/30 border-border/60"
              placeholder="4242"
              inputMode="numeric"
              maxLength={4}
              value={values.cardLast4 ?? ""}
              onChange={(e) => set("cardLast4", e.target.value.replace(/\D/g, "").slice(0, 4))}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Start Date</Label>
            <Input
              type="date"
              className="h-10 bg-muted/30 border-border/60"
              value={values.subscriptionStartDate ?? ""}
              onChange={(e) => set("subscriptionStartDate", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Next Billing Date</Label>
            <Input
              type="date"
              className="h-10 bg-muted/30 border-border/60"
              value={values.nextBillingDate ?? ""}
              onChange={(e) => set("nextBillingDate", e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Client Location & GMB */}
      <div className="border-t border-border/40 pt-5 space-y-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Client Location &amp; GMB</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">GMB Address</Label>
            <Input
              className="h-10 bg-muted/30 border-border/60"
              placeholder="123 Main St, Austin, TX"
              value={locData.publishedAddress}
              onChange={(e) => onLocChange({ ...locData, publishedAddress: e.target.value })}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">GMB Link</Label>
            <Input
              className="h-10 bg-muted/30 border-border/60"
              placeholder="https://maps.google.com/..."
              value={locData.gmbUrl}
              onChange={(e) => onLocChange({ ...locData, gmbUrl: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Website Published on GMB</Label>
            <Input
              className="h-10 bg-muted/30 border-border/60"
              placeholder="https://example.com"
              value={locData.websitePublishedOnGmb}
              onChange={(e) => onLocChange({ ...locData, websitePublishedOnGmb: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Website Linked on GMB <span className="font-normal normal-case text-muted-foreground/60">(if different)</span></Label>
            <Input
              className="h-10 bg-muted/30 border-border/60"
              placeholder="https://example.com"
              value={locData.websiteLinkedOnGmb}
              onChange={(e) => onLocChange({ ...locData, websiteLinkedOnGmb: e.target.value })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Main exported component
══════════════════════════════════════════════════════════ */
export default function ClientAeoPlans({
  clientId,
  client,
}: {
  clientId: number;
  client: ClientInfo;
}) {
  const clientBusinessName = client.businessName ?? "";
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [businesses, setBusinesses] = useState<BusinessOption[]>([]);
  const [plans, setPlans]     = useState<AeoPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);

  const [addOpen,  setAddOpen]  = useState(false);
  const [editPlan, setEditPlan] = useState<AeoPlan | null>(null);
  const [formData, setFormData] = useState<PlanFormData>({ ...EMPTY_FORM, businessName: clientBusinessName });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [confirmSave, setConfirmSave] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<AeoPlan | null>(null);
  const [clientLocData, setClientLocData] = useState<ClientLocData>({ ...EMPTY_LOC });

  /* keywords per plan: planId → rows */
  const [planKeywords, setPlanKeywords] = useState<Map<number, KeywordRow[]>>(new Map());
  const [kwLoading,    setKwLoading]    = useState<Set<number>>(new Set());
  const [expanded,     setExpanded]     = useState<Set<number>>(new Set());
  const [addingKwFor,  setAddingKwFor]  = useState<number | null>(null);
  const [newKwText,    setNewKwText]    = useState("");
  const [savingKw,     setSavingKw]     = useState(false);

  const fetchPlans = useCallback(async () => {
    setLoading(true);
    try {
      const r = await rawFetch(`/api/clients/${clientId}/aeo-plans`, { credentials: "include" });
      setPlans(await r.json());
    } catch { setPlans([]); }
    finally { setLoading(false); }
  }, [clientId]);

  const fetchBusinesses = useCallback(async () => {
    try {
      const r = await rawFetch(`/api/businesses?clientId=${clientId}`, { credentials: "include" });
      if (!r.ok) throw new Error();
      const rows: Array<{ id: number; name: string }> = await r.json();
      setBusinesses(rows.map((b) => ({ id: b.id, name: b.name })));
    } catch { setBusinesses([]); }
  }, [clientId]);

  useEffect(() => { fetchPlans(); fetchBusinesses(); }, [fetchPlans, fetchBusinesses]);

  async function handleAddKeyword(plan: AeoPlan) {
    const text = newKwText.trim();
    if (!text) return;
    setSavingKw(true);
    try {
      const res = await rawFetch(`/api/keywords`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          businessId: plan.businessId,
          aeoPlanId: plan.id,
          keywordText: text,
          isActive: true,
        }),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Keyword added", description: `"${text}" was linked to this campaign.` });
      setNewKwText("");
      setAddingKwFor(null);
      fetchPlanKeywords(plan.id);
    } catch {
      toast({ title: "Failed to add keyword", variant: "destructive" });
    } finally {
      setSavingKw(false);
    }
  }

  async function fetchPlanKeywords(planId: number) {
    setKwLoading((s) => new Set(s).add(planId));
    try {
      const r = await rawFetch(`/api/keywords?aeoPlanId=${planId}`, { credentials: "include" });
      const rows: KeywordRow[] = await r.json();
      setPlanKeywords((m) => new Map(m).set(planId, rows));
    } catch {
      setPlanKeywords((m) => new Map(m).set(planId, []));
    } finally {
      setKwLoading((s) => { const n = new Set(s); n.delete(planId); return n; });
    }
  }

  function toggleExpand(planId: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(planId)) {
        next.delete(planId);
      } else {
        next.add(planId);
        if (!planKeywords.has(planId)) fetchPlanKeywords(planId);
      }
      return next;
    });
  }

  function openAdd() {
    setFormData({ ...EMPTY_FORM, businessName: clientBusinessName });
    setFormErrors({});
    setClientLocData({ ...EMPTY_LOC });
    setAddOpen(true);
  }

  function openEdit(plan: AeoPlan) {
    setFormData({
      businessId:            plan.businessId,
      name:                  plan.name,
      businessName:          plan.businessName,
      planType:              plan.planType,
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
      searchAddress:         plan.searchAddress ?? "",
      subscriptionId:        plan.subscriptionId ?? "",
      subscriptionStartDate: plan.subscriptionStartDate ?? "",
      nextBillingDate:       plan.nextBillingDate ?? "",
      cardLast4:             plan.cardLast4 ?? "",
    });
    setClientLocData({
      publishedAddress:      client?.publishedAddress      ?? "",
      gmbUrl:                client?.gmbUrl                ?? "",
      websitePublishedOnGmb: client?.websitePublishedOnGmb ?? "",
      websiteLinkedOnGmb:    client?.websiteLinkedOnGmb    ?? "",
    });
    setEditPlan(plan);
  }

  function validateForm(): boolean {
    const errors: Record<string, string> = {};

    if (formData.businessId == null) {
      errors.businessId = "Please select a business";
    }
    if (!formData.planType?.trim()) {
      errors.planType = "Plan type is required";
    }
    if (!formData.schemaImplementor?.trim()) {
      errors.schemaImplementor = "Please select who implements the schema";
    }

    setFormErrors(errors);

    if (Object.keys(errors).length > 0) {
      const errorCount = Object.keys(errors).length;
      toast({
        title: "❌ Required Fields Missing",
        description: `Please fill in ${errorCount} required ${errorCount === 1 ? 'field' : 'fields'} highlighted in red.`,
        variant: "destructive",
      });
      return false;
    }
    return true;
  }

  function handleSaveClick() {
    if (validateForm()) {
      setConfirmSave(true);
    }
  }

  async function handleSave() {
    setConfirmSave(false);
    setSaving(true);
    try {
      // Also save location & GMB fields back to the client record
      await rawFetch(`/api/clients/${clientId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(clientLocData),
      });

      const resolvedBiz = businesses.find((b) => b.id === formData.businessId);
      const bizName = resolvedBiz?.name || formData.businessName || clientBusinessName;
      const addr = formData.searchAddress?.trim();
      const autoName = [bizName, addr].filter(Boolean).join(" — ");

      if (editPlan) {
        await rawFetch(`/api/clients/${clientId}/aeo-plans/${editPlan.id}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...formData, name: autoName }),
        });
        toast({ title: "✅ Campaign updated!", description: `The campaign for ${bizName} has been updated successfully.` });
        setEditPlan(null);
      } else {
        await rawFetch(`/api/clients/${clientId}/aeo-plans`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...formData, businessName: bizName, name: autoName }),
        });
        toast({ title: "✅ Campaign added!", description: `New campaign for ${formData.businessName || clientBusinessName} has been created successfully.` });
        setAddOpen(false);
      }
      fetchPlans();
    } catch {
      toast({ title: "❌ Save failed", description: "Something went wrong. Please try again.", variant: "destructive" });
    } finally { setSaving(false); }
  }

  function handleCancelClick() {
    const hasData =
      (formData.searchAddress?.trim()) ||
      (formData.schemaImplementor?.trim()) ||
      (formData.planType?.trim());
    if (hasData) {
      setConfirmCancel(true);
    } else {
      setAddOpen(false);
      setEditPlan(null);
      setFormErrors({});
    }
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    const planName = confirmDelete.planType;
    const id = confirmDelete.id;
    setConfirmDelete(null);
    try {
      await rawFetch(`/api/clients/${clientId}/aeo-plans/${id}`, { method: "DELETE", credentials: "include" });
      toast({ title: "🗑️ Campaign deleted", description: `"${planName}" has been removed successfully.` });
      fetchPlans();
    } catch {
      toast({ title: "❌ Delete failed", description: "Something went wrong. Please try again.", variant: "destructive" });
    }
  }

  const isDialogOpen = addOpen || editPlan !== null;

  return (
    <>
      <Card className="border-border/50">
        <CardHeader className="pb-4 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-primary" />
            Campaigns
            {plans.length > 0 && (
              <Badge variant="outline" className="text-xs border-primary/20 text-primary bg-primary/5">{plans.length}</Badge>
            )}
          </CardTitle>
          <Button
            variant="outline" size="sm"
            className="h-7 px-2 gap-1 text-xs border-primary/30 text-primary hover:bg-primary/10"
            onClick={openAdd}
          >
            <Plus className="w-3 h-3" /> Add Campaign
          </Button>
        </CardHeader>

        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded" />
              ))}
            </div>
          ) : plans.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2 border-t border-border/30">
              <ClipboardList className="w-8 h-8 opacity-30" />
              <p className="text-sm">No campaigns yet — click <strong>Add Campaign</strong></p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead className="w-6" />
                    <TableHead>Business</TableHead>
                    <TableHead>Plan Type</TableHead>
                    <TableHead>Tier</TableHead>
                    <TableHead>Answer Presence</TableHead>
                    <TableHead>Created By</TableHead>
                    <TableHead className="w-20 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plans.map((plan) => {
                    const meta    = getPlanMeta(plan.planType);
                    const isOpen  = expanded.has(plan.id);
                    const kws     = planKeywords.get(plan.id) ?? [];
                    const isKwLoading = kwLoading.has(plan.id);
                    return (
                      <React.Fragment key={plan.id}>
                        <TableRow
                          className="hover:bg-muted/30 cursor-pointer"
                          onClick={() => {
                            if (plan.businessId) {
                              navigate(`/clients/${clientId}/businesses/${plan.businessId}/campaigns/${plan.id}`);
                            } else {
                              toggleExpand(plan.id);
                            }
                          }}
                        >
                          {/* Expand toggle */}
                          <TableCell className="pr-0" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => toggleExpand(plan.id)}
                              className="w-6 h-6 flex items-center justify-center rounded hover:bg-muted/60 text-muted-foreground"
                              title={isOpen ? "Hide keywords" : "Show keywords"}
                            >
                              {isOpen
                                ? <ChevronDown className="w-3.5 h-3.5" />
                                : <ChevronRight className="w-3.5 h-3.5" />}
                            </button>
                          </TableCell>
                          <TableCell className="text-sm font-semibold text-foreground">
                            {plan.name ?? <span className="text-muted-foreground/40 font-normal">—</span>}
                          </TableCell>
                          <TableCell className="text-sm font-medium">
                            {(() => {
                              const biz = businesses.find((b) => b.id === plan.businessId);
                              if (biz) return biz.name;
                              if (plan.businessName) return <span className="text-muted-foreground italic">{plan.businessName}</span>;
                              return <span className="text-muted-foreground/40">—</span>;
                            })()}
                          </TableCell>
                          <TableCell>
                            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${meta.badgeClass} whitespace-nowrap`}>
                              {plan.planType}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${meta.tierClass} whitespace-nowrap`}>
                              {meta.tier}
                            </span>
                          </TableCell>
                          <TableCell className="text-sm">{plan.currentAnswerPresence ?? <span className="text-muted-foreground/40">—</span>}</TableCell>
                          <TableCell className="text-sm">{plan.createdBy ?? <span className="text-muted-foreground/40">—</span>}</TableCell>
                          <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
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
                                onClick={() => setConfirmDelete(plan)}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>

                        {/* ── Inline keywords for this campaign ── */}
                        {isOpen && (
                          <TableRow className="bg-muted/10 hover:bg-muted/10">
                            <TableCell colSpan={9} className="py-3 px-6" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                  <Key className="w-3.5 h-3.5 text-primary" />
                                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Keywords linked to this campaign</span>
                                </div>
                                {addingKwFor !== plan.id && (
                                  <Button
                                    variant="outline" size="sm"
                                    className="h-7 px-2 gap-1 text-xs border-primary/30 text-primary hover:bg-primary/10"
                                    onClick={() => { setAddingKwFor(plan.id); setNewKwText(""); }}
                                  >
                                    <Plus className="w-3 h-3" /> Add Keyword
                                  </Button>
                                )}
                              </div>

                              {addingKwFor === plan.id && (
                                <div className="flex gap-2 mb-3">
                                  <Input
                                    autoFocus
                                    className="h-9 bg-background"
                                    placeholder="Enter keyword text"
                                    value={newKwText}
                                    onChange={(e) => setNewKwText(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") handleAddKeyword(plan);
                                      if (e.key === "Escape") { setAddingKwFor(null); setNewKwText(""); }
                                    }}
                                  />
                                  <Button
                                    size="sm"
                                    disabled={savingKw || !newKwText.trim()}
                                    onClick={() => handleAddKeyword(plan)}
                                  >
                                    {savingKw ? "Saving…" : "Save"}
                                  </Button>
                                  <Button
                                    variant="ghost" size="sm"
                                    onClick={() => { setAddingKwFor(null); setNewKwText(""); }}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              )}

                              {isKwLoading ? (
                                <div className="flex gap-2">
                                  {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-6 w-28 rounded-full" />)}
                                </div>
                              ) : kws.length === 0 ? (
                                <p className="text-xs text-muted-foreground/60 italic">No keywords assigned to this campaign yet.</p>
                              ) : (
                                <div className="flex flex-wrap gap-1.5">
                                  {kws.map((kw) => (
                                    <span
                                      key={kw.id}
                                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border ${
                                        kw.isActive === false
                                          ? "bg-muted/40 text-muted-foreground border-border/30"
                                          : Number(kw.keywordType) === 4
                                            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
                                            : "bg-primary/10 text-primary border-primary/20"
                                      }`}
                                    >
                                      {kw.keywordText}
                                      {kw.isActive === false && <span className="opacity-50">(inactive)</span>}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={confirmDelete !== null} onOpenChange={(o) => { if (!o) setConfirmDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the campaign{" "}
              <strong>&ldquo;{confirmDelete?.planType}&rdquo;</strong>? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmDelete(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
            >
              Yes, Delete Campaign
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Save Confirmation Dialog */}
      <AlertDialog open={confirmSave} onOpenChange={setConfirmSave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save Campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you ready to save this campaign for <strong>{formData.businessName || clientBusinessName}</strong>? This will {editPlan ? "update the existing" : "create a new"} campaign.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmSave(false)}>Go Back</AlertDialogCancel>
            <AlertDialogAction
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Saving…" : `Yes, ${editPlan ? "Update" : "Save"} Campaign`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel Confirmation Dialog */}
      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard Campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to cancel? All the information you've entered will be lost and cannot be recovered.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmCancel(false)}>Continue Editing</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { setConfirmCancel(false); setAddOpen(false); setEditPlan(null); setFormErrors({}); }}
            >
              Yes, Discard Changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Add / Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={(o) => { if (!o) { handleCancelClick(); } }}>
        <DialogContent className="w-screen h-screen max-w-none max-h-none rounded-none border-0 bg-card overflow-y-auto flex flex-col">
          <DialogHeader className="px-8 pt-8 pb-0">
            <div className="flex items-center gap-3 mb-1">
              <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center">
                <ClipboardList className="w-4 h-4 text-primary" />
              </div>
              <DialogTitle className="text-xl">{editPlan ? "Edit Campaign" : "Add Campaign"}</DialogTitle>
            </div>
            <DialogDescription className="sr-only">{editPlan ? "Edit Campaign" : "Add Campaign"}</DialogDescription>
          </DialogHeader>

          <div className="flex-1 flex flex-col items-center justify-start px-8 py-6">
            <div className="w-full max-w-3xl space-y-6">

              {/* ── Client info summary (read-only) ── */}
              <div className="rounded-xl border border-border/50 bg-muted/20 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Client Information</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="flex items-start gap-2">
                    <Building2 className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">Business</p>
                      <p className="text-sm font-semibold text-foreground">{clientBusinessName}</p>
                    </div>
                  </div>
                  {(client.planName) && (
                    <div className="flex items-start gap-2">
                      <ClipboardList className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs text-muted-foreground">Subscription Plan</p>
                        <p className="text-sm font-semibold text-foreground">{client.planName}</p>
                      </div>
                    </div>
                  )}
                  {(client.contactEmail || client.accountEmail) && (
                    <div className="flex items-start gap-2">
                      <Mail className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs text-muted-foreground">Contact Email</p>
                        <p className="text-sm font-semibold text-foreground break-all">{client.contactEmail ?? client.accountEmail}</p>
                      </div>
                    </div>
                  )}
                  {(client.accountType) && (
                    <div className="flex items-start gap-2">
                      <CreditCard className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs text-muted-foreground">Account Type</p>
                        <p className="text-sm font-semibold text-foreground">{client.accountType}</p>
                      </div>
                    </div>
                  )}
                  {(client.city || client.state) && (
                    <div className="flex items-start gap-2">
                      <Building2 className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs text-muted-foreground">Location</p>
                        <p className="text-sm font-semibold text-foreground">{[client.city, client.state].filter(Boolean).join(", ")}</p>
                      </div>
                    </div>
                  )}
                  <div className="flex items-start gap-2">
                    <div className={`w-4 h-4 mt-0.5 rounded-full shrink-0 ${client.status === "active" ? "bg-emerald-400" : "bg-slate-400"}`} />
                    <div>
                      <p className="text-xs text-muted-foreground">Status</p>
                      <p className={`text-sm font-semibold capitalize ${client.status === "active" ? "text-emerald-500" : "text-muted-foreground"}`}>{client.status ?? "—"}</p>
                    </div>
                  </div>
                </div>
              </div>

              <PlanForm
                values={formData}
                onChange={(v) => { setFormData(v); setFormErrors({}); }}
                clientBusinessName={clientBusinessName}
                businesses={businesses}
                errors={formErrors}
                locData={clientLocData}
                onLocChange={setClientLocData}
              />

              <div className="flex gap-4 pt-6">
                <Button
                  variant="outline" size="lg" className="flex-1 border-border/50 h-12"
                  onClick={handleCancelClick}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button
                  size="lg" className="flex-1 gap-2 h-12"
                  disabled={saving}
                  onClick={handleSaveClick}
                  style={{
                    background: "linear-gradient(135deg,hsl(217,91%,55%),hsl(217,91%,65%))",
                    boxShadow:  "0 4px 12px rgba(37,99,235,0.25)",
                  }}
                >
                  {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : "Save Campaign"}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
