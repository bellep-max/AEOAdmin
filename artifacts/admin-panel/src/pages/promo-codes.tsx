import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Tag, Trash2 } from "lucide-react";

const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
function rawFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  if (BASE.includes("ngrok")) headers["ngrok-skip-browser-warning"] = "true";
  return fetch(BASE + path, { credentials: "include", ...init, headers });
}

interface PromoCode {
  id: number;
  code: string;
  discountType: string;
  discountValue: string | number | null;
  startDate: string | null;
  endDate: string | null;
  providedBy: string | null;
  createdAt: string;
  campaignCount: number;
}

interface PromoForm {
  code: string;
  discountType: string;
  discountValue: string;
  startDate: string;
  endDate: string;
  providedBy: string;
}

const EMPTY_FORM: PromoForm = {
  code: "",
  discountType: "percent",
  discountValue: "",
  startDate: "",
  endDate: "",
  providedBy: "",
};

function formatDiscount(p: PromoCode): string {
  if (p.discountValue == null) return "—";
  const n = Number(p.discountValue);
  if (!Number.isFinite(n)) return "—";
  return p.discountType === "amount" ? `$${n.toFixed(2)}` : `${n}%`;
}

export default function PromoCodes() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PromoCode | null>(null);
  const [form, setForm] = useState<PromoForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<PromoCode | null>(null);

  const { data: promos, isLoading } = useQuery<PromoCode[]>({
    queryKey: ["/api/promo-codes"],
    queryFn: async () => {
      const res = await rawFetch("/api/promo-codes");
      if (!res.ok) throw new Error("Failed to load promo codes");
      return res.json();
    },
  });

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(p: PromoCode) {
    setEditing(p);
    setForm({
      code: p.code,
      discountType: p.discountType,
      discountValue: p.discountValue != null ? String(p.discountValue) : "",
      startDate: (p.startDate ?? "").slice(0, 10),
      endDate: (p.endDate ?? "").slice(0, 10),
      providedBy: p.providedBy ?? "",
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.code.trim()) {
      toast({ title: "Code is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const body = {
        code: form.code.trim(),
        discountType: form.discountType,
        discountValue: form.discountValue.trim()
          ? Number(form.discountValue)
          : null,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        providedBy: form.providedBy.trim() || null,
      };
      const res = await rawFetch(
        editing ? `/api/promo-codes/${editing.id}` : "/api/promo-codes",
        {
          method: editing ? "PATCH" : "POST",
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(err.error ?? "Failed to save the promo code");
      }
      queryClient.invalidateQueries({ queryKey: ["/api/promo-codes"] });
      setDialogOpen(false);
      toast({ title: editing ? "Promo code updated" : "Promo code created" });
    } catch (e) {
      toast({
        title: "Error",
        description: e instanceof Error ? e.message : "Failed",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(p: PromoCode) {
    try {
      const res = await rawFetch(`/api/promo-codes/${p.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(err.error ?? "Failed to delete the promo code");
      }
      queryClient.invalidateQueries({ queryKey: ["/api/promo-codes"] });
      toast({ title: `Promo code "${p.code}" deleted` });
    } catch (e) {
      toast({
        title: "Error",
        description: e instanceof Error ? e.message : "Failed",
        variant: "destructive",
      });
    } finally {
      setConfirmDelete(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Tag className="w-6 h-6 text-primary" />
            Promo Codes
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Create promo codes here, then attach one to a campaign from its
            campaign page.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="w-4 h-4 mr-1" />
          New Promo Code
        </Button>
      </div>

      <Card className="border-border/50">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Discount</TableHead>
                <TableHead>Start Date</TableHead>
                <TableHead>End Date</TableHead>
                <TableHead>Provided / Approved By</TableHead>
                <TableHead>Campaigns</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="text-center text-muted-foreground py-8"
                  >
                    Loading…
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && (promos ?? []).length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="text-center text-muted-foreground py-8"
                  >
                    No promo codes yet.
                  </TableCell>
                </TableRow>
              )}
              {(promos ?? []).map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono font-medium">
                    {p.code}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{formatDiscount(p)}</Badge>
                  </TableCell>
                  <TableCell>
                    {(p.startDate ?? "").slice(0, 10) || "—"}
                  </TableCell>
                  <TableCell>{(p.endDate ?? "").slice(0, 10) || "—"}</TableCell>
                  <TableCell>{p.providedBy ?? "—"}</TableCell>
                  <TableCell>{p.campaignCount}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {(p.createdAt ?? "").slice(0, 10)}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 justify-end">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEdit(p)}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setConfirmDelete(p)}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editing ? `Edit ${editing.code}` : "New Promo Code"}
            </DialogTitle>
            <DialogDescription>
              Discount can be a percentage or a flat amount.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="promo-code">Promo Code</Label>
              <Input
                id="promo-code"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="e.g. FOUNDERS50"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Discount Type</Label>
                <Select
                  value={form.discountType}
                  onValueChange={(v) => setForm({ ...form, discountType: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percent">Percent (%)</SelectItem>
                    <SelectItem value="amount">Amount ($)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="promo-value">
                  {form.discountType === "amount"
                    ? "Amount ($)"
                    : "Percent (%)"}
                </Label>
                <Input
                  id="promo-value"
                  type="number"
                  min="0"
                  value={form.discountValue}
                  onChange={(e) =>
                    setForm({ ...form, discountValue: e.target.value })
                  }
                  placeholder={form.discountType === "amount" ? "50.00" : "20"}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="promo-start">Promo Start Date</Label>
                <Input
                  id="promo-start"
                  type="date"
                  value={form.startDate}
                  onChange={(e) =>
                    setForm({ ...form, startDate: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="promo-end">
                  Promo End Date (if applicable)
                </Label>
                <Input
                  id="promo-end"
                  type="date"
                  value={form.endDate}
                  onChange={(e) =>
                    setForm({ ...form, endDate: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="promo-by">Provided / Approved By</Label>
              <Input
                id="promo-by"
                value={form.providedBy}
                onChange={(e) =>
                  setForm({ ...form, providedBy: e.target.value })
                }
                placeholder="Who provided or approved this promo"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : editing ? "Save Changes" : "Create"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={confirmDelete != null}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete promo code {confirmDelete?.code}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete && confirmDelete.campaignCount > 0
                ? `${confirmDelete.campaignCount} campaign${confirmDelete.campaignCount === 1 ? "" : "s"} currently use${confirmDelete.campaignCount === 1 ? "s" : ""} this promo — the promo will be removed from ${confirmDelete.campaignCount === 1 ? "it" : "them"}.`
                : "This promo is not attached to any campaign."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDelete && handleDelete(confirmDelete)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
