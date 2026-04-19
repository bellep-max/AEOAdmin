import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAllPlanNames } from "@/hooks/use-all-plan-names";

const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

const SCHEMA_IMPLEMENTORS = ["Us (Signal AEO)", "Client Developer", "Other"];
const CREATED_BY_OPTIONS = ["Admin", "Sales Representative", "Developer", "Other"];

interface CampaignLike {
  id: number;
  name?: string | null;
  planType: string;
  serviceCategory?: string | null;
  schemaImplementor?: string | null;
  createdBy?: string | null;
  searchAddress?: string | null;
  subscriptionId?: string | null;
  subscriptionStartDate?: string | null;
  nextBillingDate?: string | null;
  cardLast4?: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: number;
  businessId: number;
  businessName?: string;
  campaign?: CampaignLike | null;
  onSaved?: () => void;
}

export function CampaignFormDialog({ open, onOpenChange, clientId, businessId, businessName, campaign, onSaved }: Props) {
  const { toast } = useToast();
  const allPlanNames = useAllPlanNames();
  const isEdit = !!campaign;

  const [planType, setPlanType] = useState("");
  const [serviceCategory, setServiceCategory] = useState("");
  const [searchAddress, setSearchAddress] = useState("");
  const [schemaImplementor, setSchemaImplementor] = useState("");
  const [createdBy, setCreatedBy] = useState("");
  const [createdByOther, setCreatedByOther] = useState("");
  const [isCreatedByOther, setIsCreatedByOther] = useState(false);
  const [subscriptionId, setSubscriptionId] = useState("");
  const [subscriptionStartDate, setSubscriptionStartDate] = useState("");
  const [nextBillingDate, setNextBillingDate] = useState("");
  const [cardLast4, setCardLast4] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (campaign) {
      setPlanType(campaign.planType ?? "");
      setServiceCategory(campaign.serviceCategory ?? "");
      setSearchAddress(campaign.searchAddress ?? "");
      setSchemaImplementor(campaign.schemaImplementor ?? "");
      const cbVal = campaign.createdBy ?? "";
      const isOther = cbVal !== "" && !CREATED_BY_OPTIONS.slice(0, -1).includes(cbVal);
      setIsCreatedByOther(isOther);
      setCreatedBy(isOther ? "Other" : cbVal);
      setCreatedByOther(isOther ? cbVal : "");
      setSubscriptionId(campaign.subscriptionId ?? "");
      setSubscriptionStartDate(campaign.subscriptionStartDate ?? "");
      setNextBillingDate(campaign.nextBillingDate ?? "");
      setCardLast4(campaign.cardLast4 ?? "");
    } else {
      setPlanType("");
      setServiceCategory("");
      setSearchAddress("");
      setSchemaImplementor("");
      setCreatedBy("");
      setCreatedByOther("");
      setIsCreatedByOther(false);
      setSubscriptionId("");
      setSubscriptionStartDate("");
      setNextBillingDate("");
      setCardLast4("");
    }
  }, [open, campaign]);

  async function handleSave() {
    if (!planType.trim() || !serviceCategory.trim() || !schemaImplementor.trim()) {
      toast({ title: "Missing required fields", description: "Plan type, service category and schema implementor are required.", variant: "destructive" });
      return;
    }
    setSaving(true);
    const autoName = [businessName, searchAddress.trim()].filter(Boolean).join(" — ");
    const payload = {
      businessId,
      businessName: businessName ?? null,
      name: autoName || null,
      planType,
      serviceCategory,
      searchAddress: searchAddress.trim() || null,
      schemaImplementor,
      createdBy: isCreatedByOther ? createdByOther.trim() || null : createdBy || null,
      subscriptionId: subscriptionId.trim() || null,
      subscriptionStartDate: subscriptionStartDate || null,
      nextBillingDate: nextBillingDate || null,
      cardLast4: cardLast4.trim() || null,
    };
    try {
      const url = isEdit
        ? `${BASE}/api/clients/${clientId}/aeo-plans/${campaign!.id}`
        : `${BASE}/api/clients/${clientId}/aeo-plans`;
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error();
      toast({ title: isEdit ? "Campaign updated" : "Campaign created" });
      onSaved?.();
      onOpenChange(false);
    } catch {
      toast({ title: isEdit ? "Failed to update campaign" : "Failed to create campaign", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px] bg-white">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-black">
            {isEdit ? "Edit Campaign" : "Add Campaign"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Campaign Name</Label>
            <div className="h-10 px-3 flex items-center text-sm rounded-md bg-muted/20 border border-dashed border-border/60 text-muted-foreground">
              {[businessName, searchAddress].filter(Boolean).join(" — ") || "Auto-generated from Business + Search Address"}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Search Address
            </Label>
            <Input
              className="h-10 bg-muted/30"
              placeholder="123 Main St, Austin, TX"
              value={searchAddress}
              onChange={(e) => setSearchAddress(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Plan Type <span className="text-red-500">*</span>
              </Label>
              <Select value={planType} onValueChange={setPlanType}>
                <SelectTrigger className="h-10 bg-muted/30">
                  <SelectValue placeholder="Select plan type" />
                </SelectTrigger>
                <SelectContent>
                  {allPlanNames.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Service Category <span className="text-red-500">*</span>
              </Label>
              <Input
                className="h-10 bg-muted/30"
                placeholder="e.g. Childcare"
                value={serviceCategory}
                onChange={(e) => setServiceCategory(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Schema By <span className="text-red-500">*</span>
              </Label>
              <Select value={schemaImplementor} onValueChange={setSchemaImplementor}>
                <SelectTrigger className="h-10 bg-muted/30">
                  <SelectValue placeholder="Select implementor" />
                </SelectTrigger>
                <SelectContent>
                  {SCHEMA_IMPLEMENTORS.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Created By
              </Label>
              {!isCreatedByOther ? (
                <Select
                  value={createdBy}
                  onValueChange={(v) => {
                    if (v === "Other") {
                      setIsCreatedByOther(true);
                      setCreatedBy("Other");
                    } else {
                      setCreatedBy(v);
                    }
                  }}
                >
                  <SelectTrigger className="h-10 bg-muted/30">
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    {CREATED_BY_OPTIONS.map((o) => (
                      <SelectItem key={o} value={o}>{o}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="flex gap-2">
                  <Input
                    className="h-10 bg-muted/30"
                    placeholder="Enter name"
                    value={createdByOther}
                    onChange={(e) => setCreatedByOther(e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-xs px-2 text-muted-foreground"
                    onClick={() => { setIsCreatedByOther(false); setCreatedBy(""); setCreatedByOther(""); }}
                  >
                    ← Back
                  </Button>
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-border/40 pt-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Subscription</p>
            <p className="text-[11px] text-muted-foreground -mt-1">Manual entry for now — will later auto-sync with Recurly.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Subscription ID</Label>
                <Input
                  className="h-10 bg-muted/30"
                  placeholder="sub_xxxxxxxxxxxx"
                  value={subscriptionId}
                  onChange={(e) => setSubscriptionId(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Card (last 4)</Label>
                <Input
                  className="h-10 bg-muted/30"
                  placeholder="4242"
                  inputMode="numeric"
                  maxLength={4}
                  value={cardLast4}
                  onChange={(e) => setCardLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Start Date</Label>
                <Input
                  type="date"
                  className="h-10 bg-muted/30"
                  value={subscriptionStartDate}
                  onChange={(e) => setSubscriptionStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Next Billing Date</Label>
                <Input
                  type="date"
                  className="h-10 bg-muted/30"
                  value={nextBillingDate}
                  onChange={(e) => setNextBillingDate(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="pt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving} className="h-10 font-bold">
              {saving ? "Saving…" : isEdit ? "Save Changes" : "Create Campaign"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
