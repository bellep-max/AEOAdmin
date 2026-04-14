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

interface CampaignLike {
  id: number;
  name?: string | null;
  planType: string;
  serviceCategory?: string | null;
  targetCityRadius?: string | null;
  schemaImplementor?: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: number;
  businessId: number;
  campaign?: CampaignLike | null;
  onSaved?: () => void;
}

export function CampaignFormDialog({ open, onOpenChange, clientId, businessId, campaign, onSaved }: Props) {
  const { toast } = useToast();
  const allPlanNames = useAllPlanNames();
  const isEdit = !!campaign;

  const [name, setName] = useState("");
  const [planType, setPlanType] = useState("");
  const [serviceCategory, setServiceCategory] = useState("");
  const [targetCityRadius, setTargetCityRadius] = useState("");
  const [schemaImplementor, setSchemaImplementor] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (campaign) {
      setName(campaign.name ?? "");
      setPlanType(campaign.planType ?? "");
      setServiceCategory(campaign.serviceCategory ?? "");
      setTargetCityRadius(campaign.targetCityRadius ?? "");
      setSchemaImplementor(campaign.schemaImplementor ?? "");
    } else {
      setName("");
      setPlanType("");
      setServiceCategory("");
      setTargetCityRadius("");
      setSchemaImplementor("");
    }
  }, [open, campaign]);

  async function handleSave() {
    if (!planType.trim() || !serviceCategory.trim() || !targetCityRadius.trim() || !schemaImplementor.trim()) {
      toast({ title: "Missing required fields", description: "Plan type, service category, target city and schema implementor are required.", variant: "destructive" });
      return;
    }
    setSaving(true);
    const payload = {
      businessId,
      name: name.trim() || null,
      planType,
      serviceCategory,
      targetCityRadius,
      schemaImplementor,
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
            <Input
              className="h-10 bg-muted/30"
              placeholder="e.g. Downtown SF — Summer 2026"
              value={name}
              onChange={(e) => setName(e.target.value)}
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
                Target City / Radius <span className="text-red-500">*</span>
              </Label>
              <Input
                className="h-10 bg-muted/30"
                placeholder="e.g. San Francisco — 30 mi"
                value={targetCityRadius}
                onChange={(e) => setTargetCityRadius(e.target.value)}
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
