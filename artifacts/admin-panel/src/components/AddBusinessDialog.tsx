import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { CreatedByField } from "./CreatedByField";

const schema = z.object({
  name: z.string().min(2, "Business name is required").max(150),
  category: z.string().max(100).optional().or(z.literal("")),
  gmbUrl: z.string().url("Must be a valid URL").max(500).optional().or(z.literal("")),
  websiteUrl: z.string().url("Must be a valid URL").max(500).optional().or(z.literal("")),
  publishedAddress: z.string().max(200).optional().or(z.literal("")),
  zipCode: z.string().max(20).optional().or(z.literal("")),
  createdBy: z.string().min(1, "Created By is required").max(50),
});

type FormValues = z.infer<typeof schema>;

interface BusinessLike {
  id: number;
  name: string;
  category?: string | null;
  gmbUrl?: string | null;
  websiteUrl?: string | null;
  publishedAddress?: string | null;
  zipCode?: string | null;
  createdBy?: string | null;
}

interface AddBusinessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: number;
  clientName?: string;
  business?: BusinessLike | null;
  onCreated?: (business: { id: number; name: string }) => void;
  onUpdated?: (business: { id: number; name: string }) => void;
}

export function AddBusinessDialog({ open, onOpenChange, clientId, clientName, business, onCreated, onUpdated }: AddBusinessDialogProps) {
  const isEdit = !!business;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      category: "",
      gmbUrl: "",
      websiteUrl: "",
      publishedAddress: "",
      zipCode: "",
      createdBy: "",
    },
  });

  useEffect(() => {
    if (!open) {
      form.reset();
      return;
    }
    if (business) {
      form.reset({
        name: business.name ?? "",
        category: business.category ?? "",
        gmbUrl: business.gmbUrl ?? "",
        websiteUrl: business.websiteUrl ?? "",
        publishedAddress: business.publishedAddress ?? "",
        zipCode: business.zipCode ?? "",
        createdBy: business.createdBy ?? "",
      });
    }
  }, [open, business, form]);

  const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);
    const payload = {
      clientId,
      name: values.name,
      category: values.category || null,
      gmbUrl: values.gmbUrl || null,
      websiteUrl: values.websiteUrl || null,
      publishedAddress: values.publishedAddress || null,
      zipCode: values.zipCode || null,
      createdBy: values.createdBy || null,
    };
    try {
      const url = isEdit ? `${BASE}/api/businesses/${business!.id}` : `${BASE}/api/businesses`;
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed");
      const saved = await res.json();
      toast({ title: isEdit ? "Business updated" : "Business added", description: `${saved.name} saved.` });
      await queryClient.invalidateQueries({ queryKey: ["/api/businesses"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      if (isEdit) onUpdated?.(saved);
      else onCreated?.(saved);
      onOpenChange(false);
    } catch (err) {
      toast({ title: isEdit ? "Failed to update business" : "Failed to create business", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[720px] bg-white max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-black">
            {isEdit ? "Edit Business" : `Add Business${clientName ? ` to ${clientName}` : ""}`}
          </DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mt-4 max-h-[70vh] overflow-y-auto pr-2">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm uppercase tracking-widest text-black font-bold">Business Name *</FormLabel>
                  <FormControl>
                    <Input placeholder="Acme Dental - Downtown" className="h-11 text-base text-black bg-slate-50" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm uppercase tracking-widest text-black font-bold">Category</FormLabel>
                  <FormControl>
                    <Input placeholder="Dentist, Plumber, etc." className="h-11 text-base text-black bg-slate-50" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="gmbUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm uppercase tracking-widest text-black font-bold">GMB URL</FormLabel>
                  <FormControl>
                    <Input placeholder="https://maps.google.com/..." className="h-11 text-base text-black bg-slate-50" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="websiteUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm uppercase tracking-widest text-black font-bold">Website</FormLabel>
                  <FormControl>
                    <Input placeholder="https://example.com" className="h-11 text-base text-black bg-slate-50" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="publishedAddress"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm uppercase tracking-widest text-black font-bold">Published (GMB) Address</FormLabel>
                  <FormControl>
                    <Input placeholder="123 Main St, Austin, TX" className="h-11 text-base text-black bg-slate-50" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="zipCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm uppercase tracking-widest text-black font-bold">Zip Code</FormLabel>
                  <FormControl>
                    <Input placeholder="78701" className="h-11 text-base text-black bg-slate-50" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="createdBy"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormControl>
                    <CreatedByField
                      value={field.value ?? ""}
                      onChange={field.onChange}
                      required
                      error={fieldState.error?.message ?? null}
                      labelClassName="text-sm uppercase tracking-widest text-black font-bold"
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            <div className="pt-4 flex justify-end gap-2 sticky bottom-0 bg-white">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting} className="h-11 text-base font-bold">
                {submitting ? "Saving..." : isEdit ? "Save Changes" : "Create Business"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
