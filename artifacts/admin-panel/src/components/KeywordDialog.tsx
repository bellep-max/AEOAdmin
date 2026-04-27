import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Key, Link2, Loader2 } from "lucide-react";

export type KwRecord = Record<string, unknown>;

export interface KeywordDialogClient {
  id: number;
  businessName: string;
}
export interface KeywordDialogBusiness {
  id: number;
  clientId: number;
  name: string;
  publishedAddress?: string | null;
}
export interface KeywordDialogPlan {
  id: number;
  clientId: number;
  businessId: number | null;
  name: string | null;
  planType: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  saving: boolean;
  initial?: KwRecord;
  defaultClientId?: number;
  defaultBusinessId?: number;
  defaultCampaignId?: number;
  /** When true, Client/Business/Campaign selects are hidden and the defaults are locked. */
  lockContext?: boolean;
  clients?: KeywordDialogClient[];
  businesses?: KeywordDialogBusiness[];
  plans?: KeywordDialogPlan[];
  onSave: (data: KwRecord) => void;
}

export function KeywordDialog({
  open, onOpenChange, title, saving, initial, clients, businesses, plans, onSave,
  defaultClientId, defaultBusinessId, defaultCampaignId, lockContext,
}: Props) {
  const blank: KwRecord = {
    clientId: "", businessId: "", keywordText: "", keywordType: "3", isPrimary: "0", isActive: true,
    aeoPlanId: "",
    linkUrl: "", linkTypeLabel: "", embeddedUrl: "", linkActive: true,
    initialRankReportLink: "", currentRankReportLink: "",
  };
  const [vals, setVals] = useState<KwRecord>(blank);
  function set(k: string, v: unknown) { setVals((p) => ({ ...p, [k]: v })); }
  const isEdit = !!initial;

  useEffect(() => {
    if (!open) return;
    if (initial) {
      const firstLink = Array.isArray(initial.links) && initial.links.length > 0 ? initial.links[0] as Record<string, unknown> : null;
      setVals({
        ...initial,
        clientId:   initial.clientId != null ? String(initial.clientId) : "",
        businessId: initial.businessId != null ? String(initial.businessId) : "",
        aeoPlanId:  initial.aeoPlanId != null ? String(initial.aeoPlanId) : "",
        linkUrl:               firstLink?.linkUrl               ?? initial.linkUrl ?? "",
        linkTypeLabel:         firstLink?.linkTypeLabel         ?? initial.linkTypeLabel ?? "",
        embeddedUrl:            firstLink?.embeddedUrl            ?? initial.embeddedUrl ?? "",
        linkActive:            firstLink?.linkActive            ?? initial.linkActive ?? true,
        initialRankReportLink: firstLink?.initialRankReportLink ?? initial.initialRankReportLink ?? "",
        currentRankReportLink: firstLink?.currentRankReportLink ?? initial.currentRankReportLink ?? "",
      });
    } else {
      setVals({
        ...blank,
        clientId:   defaultClientId   ? String(defaultClientId)   : "",
        businessId: defaultBusinessId ? String(defaultBusinessId) : "",
        aeoPlanId:  defaultCampaignId ? String(defaultCampaignId) : "",
      });
    }
  }, [open]);

  const selectedClientId   = vals.clientId   as string;
  const selectedBusinessId = vals.businessId as string;
  const businessOptions = (businesses ?? []).filter((b) => !selectedClientId || String(b.clientId) === selectedClientId);
  const campaigns       = (plans ?? []).filter((p) =>
    (!selectedClientId   || String(p.clientId)   === selectedClientId) &&
    (!selectedBusinessId || String(p.businessId) === selectedBusinessId),
  );
  const selectedBusiness = businessOptions.find((b) => String(b.id) === selectedBusinessId);
  const selectedClient   = (clients ?? []).find((c) => String(c.id) === selectedClientId);
  const selectedCampaign = campaigns.find((c) => String(c.id) === (vals.aeoPlanId as string));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-screen h-screen max-w-full max-h-screen rounded-none border-0 bg-white dark:bg-slate-900 flex flex-col p-0 gap-0">
        <DialogHeader className="shrink-0 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 border border-blue-200 flex items-center justify-center shrink-0">
              <Key className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold text-black dark:text-white">{title}</DialogTitle>
              <p className="text-base text-slate-600 dark:text-slate-400 mt-0.5">Fill in all fields, then save</p>
            </div>
          </div>
          <DialogDescription className="sr-only">{title}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-6 max-w-3xl w-full mx-auto space-y-5">
          {lockContext ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 dark:bg-slate-800/60 dark:border-slate-700 px-4 py-3 flex flex-wrap gap-x-8 gap-y-2 text-sm">
              <div>
                <span className="block text-xs font-bold uppercase tracking-widest text-slate-500">Client</span>
                <span className="text-black dark:text-white font-semibold">{selectedClient?.businessName ?? "—"}</span>
              </div>
              <div>
                <span className="block text-xs font-bold uppercase tracking-widest text-slate-500">Business</span>
                <span className="text-black dark:text-white font-semibold">{selectedBusiness?.name ?? "—"}</span>
              </div>
              <div>
                <span className="block text-xs font-bold uppercase tracking-widest text-slate-500">Campaign</span>
                <span className="text-black dark:text-white font-semibold">{selectedCampaign?.name ?? selectedCampaign?.planType ?? "—"}</span>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-sm uppercase tracking-widest text-black font-bold">Client <span className="text-red-600">*</span></Label>
                  <Select value={selectedClientId} onValueChange={(v) => { set("clientId", v); set("businessId", ""); set("aeoPlanId", ""); }}>
                    <SelectTrigger className="bg-slate-50 dark:bg-slate-900 border-slate-300 dark:border-slate-700 h-11 text-base text-black dark:text-white"><SelectValue placeholder="Select client…" /></SelectTrigger>
                    <SelectContent>
                      {clients?.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          <span className="font-bold text-base">{c.businessName}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm uppercase tracking-widest text-black font-bold">Business <span className="text-red-600">*</span></Label>
                  <Select value={selectedBusinessId} onValueChange={(v) => { set("businessId", v); set("aeoPlanId", ""); }} disabled={!selectedClientId}>
                    <SelectTrigger className="bg-slate-50 dark:bg-slate-900 border-slate-300 dark:border-slate-700 h-11 text-base text-black dark:text-white">
                      <SelectValue placeholder={selectedClientId ? "Select business…" : "Select client first"} />
                    </SelectTrigger>
                    <SelectContent>
                      {businessOptions.length === 0 && (
                        <div className="px-3 py-2 text-sm text-slate-500 italic">No businesses for this client</div>
                      )}
                      {businessOptions.map((b) => (
                        <SelectItem key={b.id} value={String(b.id)}>
                          <span className="font-bold text-base">{b.name}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm uppercase tracking-widest text-black font-bold">Campaign <span className="text-red-600">*</span></Label>
                  <Select value={(vals.aeoPlanId as string) || ""} onValueChange={(v) => set("aeoPlanId", v)} disabled={!selectedBusinessId}>
                    <SelectTrigger className="bg-slate-50 dark:bg-slate-900 border-slate-300 dark:border-slate-700 h-11 text-base text-black dark:text-white">
                      <SelectValue placeholder={selectedBusinessId ? "Select campaign…" : "Select business first"} />
                    </SelectTrigger>
                    <SelectContent>
                      {campaigns.length === 0 && (
                        <div className="px-3 py-2 text-sm text-slate-500 italic">No campaigns for this business</div>
                      )}
                      {campaigns.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          <span className="font-semibold">{c.name ?? c.planType}</span>
                          <span className="text-slate-500 ml-1">· {c.planType}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {selectedBusiness && selectedBusiness.publishedAddress && (
                <div className="flex flex-wrap gap-x-6 gap-y-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-600">
                  <span><span className="font-semibold uppercase tracking-wide text-xs text-slate-400">GMB:</span> {selectedBusiness.publishedAddress}</span>
                </div>
              )}
            </>
          )}

          <div className="space-y-1.5">
            <Label className="text-sm uppercase tracking-widest text-black dark:text-white font-bold">Keyword <span className="text-red-600">*</span></Label>
            <Input className="bg-slate-50 dark:bg-slate-900 border-slate-300 dark:border-slate-700 h-11 text-base text-black dark:text-white"
              placeholder="e.g. best plumber in Manchester"
              value={vals.keywordText as string}
              onChange={(e) => set("keywordText", e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm uppercase tracking-widest text-black dark:text-white font-bold">Keyword Types <span className="text-red-600">*</span></Label>
            <Select value={String(vals.keywordType)} onValueChange={(v) => set("keywordType", v)}>
              <SelectTrigger className="bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-600 h-11 text-base text-black dark:text-white">
                <SelectValue placeholder="Select keyword type…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="3">Keywords</SelectItem>
                <SelectItem value="4">Keywords with Backlinks</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {String(vals.keywordType) === "4" && (
            <div className="space-y-3 pt-3 pb-4 px-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl border border-emerald-200 dark:border-emerald-800/50">
              <div className="flex items-center gap-2 mb-1">
                <Link2 className="w-4 h-4 text-emerald-600" />
                <p className="text-sm font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-400">Backlink Details</p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm uppercase tracking-widest text-black dark:text-white font-bold">Link URL</Label>
                <Input
                  className="bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 h-11 text-base text-black dark:text-white font-mono"
                  placeholder="https://…"
                  value={(vals.linkUrl as string) || ""}
                  onChange={(e) => set("linkUrl", e.target.value)}
                />
              </div>

              {(vals.linkTypeLabel as string) === "GBP snippet" && (
                <div className="space-y-1.5">
                  <Label className="text-sm uppercase tracking-widest text-black dark:text-white font-bold">Real Link (inside GBP)</Label>
                  <Input
                    className="bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 h-11 text-base text-black dark:text-white font-mono"
                    placeholder="https://… — the actual URL the GBP points to"
                    value={(vals.embeddedUrl as string) || ""}
                    onChange={(e) => set("embeddedUrl", e.target.value)}
                  />
                </div>
              )}

              <div className="grid grid-cols-3 gap-3 items-end">
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-sm uppercase tracking-widest text-black dark:text-white font-bold">Link Type Label</Label>
                  <Select value={(vals.linkTypeLabel as string) || ""} onValueChange={(v) => set("linkTypeLabel", v)}>
                    <SelectTrigger className="bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 h-11 text-base text-black dark:text-white">
                      <SelectValue placeholder="Select link type…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="GBP snippet">GBP snippet</SelectItem>
                      <SelectItem value="Client website blog post">Client website blog post</SelectItem>
                      <SelectItem value="External article">External article</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg px-4 h-11">
                  <p className="text-base flex-1 text-black dark:text-white font-bold">Active</p>
                  <Switch
                    checked={vals.linkActive !== false}
                    onCheckedChange={(v) => set("linkActive", v)}
                    className="data-[state=checked]:bg-emerald-500 scale-75"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            {[
              { k: "isPrimary", label: "Primary (1st)", sub: "Mark as primary keyword",
                checked: vals.isPrimary === "1" || vals.isPrimary === 1 || vals.isPrimary === true,
                onChange: (v: boolean) => set("isPrimary", v ? "1" : "0"), cls: "data-[state=checked]:bg-amber-500" },
              { k: "isActive", label: "Active", sub: "Include in campaigns",
                checked: vals.isActive !== false,
                onChange: (v: boolean) => set("isActive", v), cls: "data-[state=checked]:bg-emerald-500" },
            ].map((row) => (
              <div key={row.k} className="flex items-center gap-3 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg p-4">
                <div className="flex-1"><p className="text-base font-bold text-black dark:text-white">{row.label}</p><p className="text-sm text-slate-600 dark:text-slate-400">{row.sub}</p></div>
                <Switch checked={row.checked} onCheckedChange={row.onChange} className={row.cls} />
              </div>
            ))}
          </div>
        </div>

        <div className="shrink-0 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-6 py-5">
          <div className="flex gap-3 max-w-3xl mx-auto">
            <Button variant="outline" className="flex-1 border-slate-300 dark:border-slate-600 text-black dark:text-white hover:bg-slate-100 dark:hover:bg-slate-800 text-base font-bold h-12" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <Button className="flex-1 gap-2 text-base font-bold h-12"
              disabled={saving || !(vals.keywordText as string)?.trim() || !vals.clientId || !vals.businessId || !vals.aeoPlanId}
              onClick={() => onSave({
                ...vals,
                clientId:   Number(vals.clientId),
                businessId: Number(vals.businessId),
                aeoPlanId:  Number(vals.aeoPlanId),
                keywordType: Number(vals.keywordType),
                isPrimary:   (vals.isPrimary === "1" || vals.isPrimary === 1 || vals.isPrimary === true) ? 1 : 0,
              })}
              style={{ background: "linear-gradient(135deg,hsl(217,91%,55%),hsl(217,91%,65%))", boxShadow: "0 4px 12px rgba(37,99,235,0.25)" }}>
              {saving ? <><Loader2 className="w-5 h-5 animate-spin" /> Saving…</> : isEdit ? "Save Changes" : "Add Keyword"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
