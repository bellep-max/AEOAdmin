import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAllPlanNames } from "@/hooks/use-all-plan-names";
import { CreatedByField } from "./CreatedByField";

const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

interface CampaignLike {
  id: number;
  name?: string | null;
  planType: string;
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
  const [searchAddress, setSearchAddress] = useState("");
  const [createdBy, setCreatedBy] = useState("");
  const [createdByError, setCreatedByError] = useState<string | null>(null);
  const [subscriptionId, setSubscriptionId] = useState("");
  const [subscriptionStartDate, setSubscriptionStartDate] = useState("");
  const [nextBillingDate, setNextBillingDate] = useState("");
  const [cardLast4, setCardLast4] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCreatedByError(null);
    if (campaign) {
      setPlanType(campaign.planType ?? "");
      setSearchAddress(campaign.searchAddress ?? "");
      setCreatedBy(campaign.createdBy ?? "");
      setSubscriptionId(campaign.subscriptionId ?? "");
      setSubscriptionStartDate(campaign.subscriptionStartDate ?? "");
      setNextBillingDate(campaign.nextBillingDate ?? "");
      setCardLast4(campaign.cardLast4 ?? "");
    } else {
      setPlanType("");
      setSearchAddress("");
      setCreatedBy("");
      setSubscriptionId("");
      setSubscriptionStartDate("");
      setNextBillingDate("");
      setCardLast4("");
    }
  }, [open, campaign]);

  async function handleSave() {
    const trimmedCreatedBy = createdBy.trim();
    setCreatedByError(null);
    if (!trimmedCreatedBy) {
      setCreatedByError("Created By is required");
      toast({ title: "Created By is required", description: "Pick a role or enter a name before saving.", variant: "destructive" });
      return;
    }
    if (!planType.trim()) {
      toast({ title: "Plan type is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    const autoName = [businessName, searchAddress.trim()].filter(Boolean).join(" — ");
    const payload = {
      businessId,
      businessName: businessName ?? null,
      name: autoName || null,
      planType,
      searchAddress: searchAddress.trim() || null,
      createdBy: trimmedCreatedBy,
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

            <CreatedByField
              value={createdBy}
              onChange={(v) => { setCreatedBy(v); if (createdByError) setCreatedByError(null); }}
              required
              error={createdByError}
            />
          </div>

          <div className="border-t border-border/40 pt-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Subscription</p>
            <p className="text-[11px] text-muted-foreground -mt-1">Manual entry — fill in if you have it.</p>
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
