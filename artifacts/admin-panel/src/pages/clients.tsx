import { useState } from "react";
import { Link } from "wouter";
import { useGetClients, useCreateClient } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { 
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow 
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Search, Plus, Pencil, Trash2, Building2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { getPlanMeta } from "@/lib/plan-meta";
import { useAllPlanNames } from "@/hooks/use-all-plan-names";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AddBusinessDialog } from "@/components/AddBusinessDialog";
import { CampaignFormDialog } from "@/components/CampaignFormDialog";
import { CreatedByField } from "@/components/CreatedByField";

const businessFormSchema = z.object({
  // Business Information
  businessName: z.string()
    .min(2, "Client name must be at least 2 characters")
    .max(100, "Client name cannot exceed 100 characters"),
  searchAddress: z.string()
    .max(200, "Address cannot exceed 200 characters")
    .optional(),
  gmbAddress: z.string()
    .max(200, "Address cannot exceed 200 characters")
    .optional(),
  gmbLink: z.string()
    .url("Please enter a valid URL (e.g., https://maps.google.com/...)")
    .max(500, "URL cannot exceed 500 characters")
    .optional()
    .or(z.literal('')),
  websitePublishedOnGMB: z.string()
    .max(200, "Website URL cannot exceed 200 characters")
    .optional(),
  websiteLinkedOnGMB: z.string()
    .max(200, "Website URL cannot exceed 200 characters")
    .optional(),
  
  // Account Information
  accountType: z.enum(["Agency", "Retail"]).optional().or(z.literal('')),
  accountUser: z.string()
    .max(50, "Username cannot exceed 50 characters")
    .optional(),
  accountUserName: z.string()
    .max(100, "Name cannot exceed 100 characters")
    .optional(),
  accountEmail: z.string()
    .email("Please enter a valid email address")
    .max(100, "Email cannot exceed 100 characters")
    .optional()
    .or(z.literal('')),
  billingEmail: z.string()
    .email("Please enter a valid email address")
    .max(100, "Email cannot exceed 100 characters")
    .optional()
    .or(z.literal('')),
  createdBy: z.string().min(1, "Created By is required"),
});

export default function Clients() {
  const [search, setSearch] = useState("");
  const [filterLocation, setFilterLocation] = useState("");
  const [filterAccountType, setFilterAccountType] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterPlan, setFilterPlan] = useState("all");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;
  const { data: clients, isLoading, refetch } = useGetClients();
  const createClient = useCreateClient();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState<{ id: number; name: string; keywordCount: number } | null>(null);
  const [confirmReactivate, setConfirmReactivate] = useState<{ id: number; name: string; keywordCount: number } | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [confirmAddClient, setConfirmAddClient] = useState<z.infer<typeof businessFormSchema> | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [postCreatePrompt, setPostCreatePrompt] = useState<{ clientId: number; clientName: string } | null>(null);
  const [addBusinessFor, setAddBusinessFor] = useState<{ clientId: number; clientName: string } | null>(null);
  const [postBusinessPrompt, setPostBusinessPrompt] = useState<{ clientId: number; clientName: string; businessId: number; businessName: string } | null>(null);
  const [addCampaignFor, setAddCampaignFor] = useState<{ clientId: number; businessId: number; businessName: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: number; name: string } | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const allPlanNames = useAllPlanNames();

  const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
  function rawFetch(path: string, init?: RequestInit): Promise<Response> {
    const headers: Record<string, string> = { ...(init?.headers as Record<string, string> ?? {}), "Content-Type": "application/json" };
    if (BASE.includes("ngrok")) headers["ngrok-skip-browser-warning"] = "true";
    return fetch(BASE + path, { ...init, headers });
  }

  async function toggleStatus(clientId: number, currentStatus: string, businessName: string) {
    // When deactivating: show confirmation dialog first
    if (currentStatus === "active") {
      const client = clients?.find((c) => c.id === clientId);
      const keywordCount = (client as any)?.keywordCount ?? 0;
      setConfirmDeactivate({ id: clientId, name: businessName, keywordCount });
      return;
    }
    // Re-activating — show confirmation first
    const client = clients?.find((c) => c.id === clientId);
    const keywordCount = (client as any)?.keywordCount ?? 0;
    setConfirmReactivate({ id: clientId, name: businessName, keywordCount });
  }

  async function doDeleteClient(clientId: number) {
    setDeletingId(clientId);
    try {
      const res = await rawFetch(`/api/clients/${clientId}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) throw new Error("Failed");
      toast({ title: "Client deleted" });
      refetch();
    } catch {
      toast({ title: "Failed to delete client", variant: "destructive" });
    } finally {
      setDeletingId(null);
      setConfirmDelete(null);
    }
  }

  async function doToggle(clientId: number, currentStatus: string) {
    const newStatus = currentStatus === "active" ? "inactive" : "active";
    setTogglingId(clientId);
    // Optimistic update
    queryClient.setQueryData(
      ["/api/clients"],
      (old: any) => old?.map((c: any) => c.id === clientId ? { ...c, status: newStatus } : c)
    );
    try {
      const res = await rawFetch(`/api/clients/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error("Failed");
      toast({
        title: `${newStatus === "inactive" ? "Deactivated" : "Reactivated"} successfully`,
        description: newStatus === "inactive"
          ? "All keywords for this client have been deactivated."
          : "All keywords for this client have been reactivated.",
      });
    } catch {
      // Revert
      queryClient.setQueryData(
        ["/api/clients"],
        (old: any) => old?.map((c: any) => c.id === clientId ? { ...c, status: currentStatus } : c)
      );
      toast({ title: "Failed to update status", variant: "destructive" });
    } finally {
      setTogglingId(null);
      refetch();
      // Invalidate keywords cache so the Keywords page reflects the change immediately
      queryClient.invalidateQueries({ queryKey: ["/api/keywords"] });
    }
  }

  const form = useForm<z.infer<typeof businessFormSchema>>({
    resolver: zodResolver(businessFormSchema),
    defaultValues: {
      businessName: "",
      searchAddress: "",
      gmbAddress: "",
      gmbLink: "",
      websitePublishedOnGMB: "",
      websiteLinkedOnGMB: "",
      accountUser: "",
      accountUserName: "",
      accountEmail: "",
      billingEmail: "",
      createdBy: "",
    },
  });

  const onSubmit = (values: z.infer<typeof businessFormSchema>) => {
    // Show confirmation dialog before submitting
    setConfirmAddClient(values);
  };

  const handleConfirmAdd = () => {
    if (!confirmAddClient) return;
    
    createClient.mutate({ data: confirmAddClient as any }, {
      onSuccess: (created: unknown) => {
        toast({
          title: "✅ Client added successfully!",
          description: `${confirmAddClient.businessName} has been added to your client list.`
        });
        const newClient = (created as { client?: { id: number; businessName: string } })?.client;
        setConfirmAddClient(null);
        setIsAddOpen(false);
        form.reset();
        refetch();
        if (newClient?.id) {
          setPostCreatePrompt({ clientId: newClient.id, clientName: newClient.businessName });
        }
      },
      onError: () => {
        toast({ 
          title: "❌ Failed to add client", 
          description: "Something went wrong. Please try again.",
          variant: "destructive" 
        });
        setConfirmAddClient(null);
      }
    });
  };

  const handleDialogClose = (open: boolean) => {
    if (!open) {
      // Check if form has any data before showing cancel confirmation
      const hasData = Object.values(form.getValues()).some(val => val && val !== "");
      if (hasData) {
        setConfirmCancel(true);
      } else {
        setIsAddOpen(false);
        form.reset();
      }
    } else {
      setIsAddOpen(true);
    }
  };

  const handleConfirmCancel = () => {
    setConfirmCancel(false);
    setIsAddOpen(false);
    form.reset();
  };

  const filteredClients = (clients ?? [])
    .filter((c) => {
    const nameMatch = !search || c.businessName.toLowerCase().includes(search.toLowerCase());
    const locMatch = !filterLocation ||
      (c.searchAddress ?? "").toLowerCase().includes(filterLocation.toLowerCase()) ||
      (c.city ?? "").toLowerCase().includes(filterLocation.toLowerCase());
    const typeMatch = filterAccountType === "all" || (c.accountType ?? "").toLowerCase() === filterAccountType;
    const statusMatch = filterStatus === "all" || c.status === filterStatus;
    const planMatch = filterPlan === "all" || c.planName === filterPlan;
    return nameMatch && locMatch && typeMatch && statusMatch && planMatch;
  })
    .sort((a, b) => (a.businessName ?? "").localeCompare(b.businessName ?? ""));

  const totalFiltered = filteredClients.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));
  const pagedClients = filteredClients.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-black dark:text-white">Client</h1>
          <p className="text-lg text-slate-700 dark:text-slate-300">Client List</p>
        </div>
        
        <Dialog open={isAddOpen} onOpenChange={handleDialogClose}>
          <DialogTrigger asChild>
            <Button className="bg-primary text-primary-foreground hover:bg-primary/90 text-base font-bold h-11">
              <Plus className="w-4 h-4 mr-2" />
              Add Client
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[1200px] bg-white max-h-[90vh]">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold text-black">Add New Client</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 mt-4 max-h-[70vh] overflow-y-auto pr-4">
                {/* Client Information Section */}
                <div>
                  <h3 className="text-sm uppercase tracking-widest text-black font-bold mb-4">Client Information</h3>
                  <div className="space-y-4">
                    <FormField
                      control={form.control}
                      name="businessName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm uppercase tracking-widest text-black font-bold">Client Name *</FormLabel>
                          <FormControl>
                            <Input placeholder="Acme Plumbers" maxLength={100} className="h-11 text-base text-black bg-slate-50" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    {/* Search Address, GMB Address, GMB Link, Website fields moved to Add Campaign form */}
                    {/*
                    <FormField
                      control={form.control}
                      name="searchAddress"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm uppercase tracking-widest text-black font-bold">Search Address</FormLabel>
                          <FormControl>
                            <Input placeholder="123 Main St, Austin, TX" maxLength={200} className="h-11 text-base text-black bg-slate-50" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="gmbAddress"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm uppercase tracking-widest text-black font-bold">GMB Address</FormLabel>
                          <FormControl>
                            <Input placeholder="123 Main St, Austin, TX" maxLength={200} className="h-11 text-base text-black bg-slate-50" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="gmbLink"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm uppercase tracking-widest text-black font-bold">GMB Link</FormLabel>
                          <FormControl>
                            <Input placeholder="https://maps.google.com/..." maxLength={500} className="h-11 text-base text-black bg-slate-50" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="websitePublishedOnGMB"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm uppercase tracking-widest text-black font-bold">Website Published on GMB</FormLabel>
                          <FormControl>
                            <Input placeholder="https://example.com" maxLength={200} className="h-11 text-base text-black bg-slate-50" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="websiteLinkedOnGMB"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm uppercase tracking-widest text-black font-bold">Website Linked on GMB (if different)</FormLabel>
                          <FormControl>
                            <Input placeholder="https://example.com" maxLength={200} className="h-11 text-base text-black bg-slate-50" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    */}
                  </div>
                </div>

                {/* Account Information Section */}
                <div>
                  <h3 className="text-sm uppercase tracking-widest text-black font-bold mb-4">Account Information</h3>
                  <div className="space-y-4">
                    <FormField
                      control={form.control}
                      name="accountType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm uppercase tracking-widest text-black font-bold">Account Type</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value ?? ""}>
                            <FormControl>
                              <SelectTrigger className="h-11 text-base text-black bg-slate-50">
                                <SelectValue placeholder="Select account type…" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="Agency">Agency</SelectItem>
                              <SelectItem value="Retail">Retail</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="accountUser"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm uppercase tracking-widest text-black font-bold">Account User</FormLabel>
                          <FormControl>
                            <Input placeholder="john.doe" maxLength={50} className="h-11 text-base text-black bg-slate-50" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="accountUserName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm uppercase tracking-widest text-black font-bold">Account User Name</FormLabel>
                          <FormControl>
                            <Input placeholder="John Doe" maxLength={100} className="h-11 text-base text-black bg-slate-50" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="accountEmail"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm uppercase tracking-widest text-black font-bold">Account Email</FormLabel>
                          <FormControl>
                            <Input type="email" placeholder="john@example.com" maxLength={100} className="h-11 text-base text-black bg-slate-50" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="billingEmail"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm uppercase tracking-widest text-black font-bold">Contact / Billing Email</FormLabel>
                          <FormControl>
                            <Input type="email" placeholder="billing@example.com" maxLength={100} className="h-11 text-base text-black bg-slate-50" {...field} />
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

                  </div>
                </div>

                <div className="pt-4 flex justify-end sticky bottom-0 bg-white">
                  <Button type="submit" disabled={createClient.isPending} className="h-12 text-base font-bold">
                    {createClient.isPending ? "Creating..." : "Create Client"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 items-center">
        {/* Client Name */}
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
          <Input
            type="search"
            placeholder="Client name…"
            className="pl-9 h-10 w-52 bg-white text-sm text-black placeholder:text-slate-500"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          />
        </div>
        {/* Location */}
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
          <Input
            type="search"
            placeholder="Location…"
            className="pl-9 h-10 w-44 bg-white text-sm text-black placeholder:text-slate-500"
            value={filterLocation}
            onChange={(e) => { setFilterLocation(e.target.value); setPage(0); }}
          />
        </div>
        {/* Account Type */}
        <Select value={filterAccountType} onValueChange={(v) => { setFilterAccountType(v); setPage(0); }}>
          <SelectTrigger className="h-10 w-40 bg-white text-sm text-black">
            <SelectValue placeholder="Account Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="retail">Retail</SelectItem>
            <SelectItem value="agency">Agency</SelectItem>
          </SelectContent>
        </Select>
        {/* Status */}
        <Select value={filterStatus} onValueChange={(v) => { setFilterStatus(v); setPage(0); }}>
          <SelectTrigger className="h-10 w-36 bg-white text-sm text-black">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
        {/* Plan */}
        <Select value={filterPlan} onValueChange={(v) => { setFilterPlan(v); setPage(0); }}>
          <SelectTrigger className="h-10 w-52 bg-white text-sm text-black">
            <SelectValue placeholder="Plan" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Plans</SelectItem>
            {allPlanNames.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
        {/* Clear filters */}
        {(search || filterLocation || filterAccountType !== "all" || filterStatus !== "all" || filterPlan !== "all") && (
          <Button
            variant="ghost"
            size="sm"
            className="h-10 text-sm text-slate-500 hover:text-slate-900"
            onClick={() => { setSearch(""); setFilterLocation(""); setFilterAccountType("all"); setFilterStatus("all"); setFilterPlan("all"); setPage(0); }}
          >
            Clear filters
          </Button>
        )}
      </div>

      <div className="border rounded-md bg-white dark:bg-slate-950">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50 dark:bg-slate-900">
              <TableHead className="text-base font-bold text-black dark:text-white">Client Name</TableHead>
              <TableHead className="text-base font-bold text-black dark:text-white">Businesses</TableHead>
              <TableHead className="text-base font-bold text-black dark:text-white">Campaigns</TableHead>
              <TableHead className="text-base font-bold text-black dark:text-white">Account Type</TableHead>
              <TableHead className="text-base font-bold text-black dark:text-white">Status</TableHead>
              <TableHead className="text-right text-base font-bold text-black dark:text-white">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="h-52">
                  <div className="flex flex-col items-center justify-center gap-4 py-8">
                    <div className="w-10 h-10 rounded-full border-4 border-primary border-t-transparent animate-spin" />
                    <p className="text-base text-slate-600 dark:text-slate-400 font-medium">Loading clients…</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : pagedClients?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-slate-600 dark:text-slate-400 text-base">
                  No clients found.
                </TableCell>
              </TableRow>
            ) : (
              pagedClients?.map((client) => (
                <TableRow key={client.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer relative group border-b border-slate-200 dark:border-slate-800">
                  <TableCell className="font-bold text-base text-black dark:text-slate-100">
                    <Link href={`/clients/${client.id}`} className="relative z-10 hover:underline text-primary">
                      {client.businessName}
                    </Link>
                  </TableCell>
                  <TableCell className="relative z-10 text-base text-black dark:text-slate-100">
                    {(() => {
                      const count = (client as unknown as { businessCount?: number }).businessCount ?? 0;
                      return (
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${
                          count > 0
                            ? "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700"
                            : "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700"
                        }`}>
                          {count} {count === 1 ? "business" : "businesses"}
                        </span>
                      );
                    })()}
                  </TableCell>
                  <TableCell className="relative z-10 text-base text-black dark:text-slate-100">
                    {(() => {
                      const count = (client as unknown as { campaignCount?: number }).campaignCount ?? 0;
                      return (
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${
                          count > 0
                            ? "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700"
                            : "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700"
                        }`}>
                          {count} {count === 1 ? "campaign" : "campaigns"}
                        </span>
                      );
                    })()}
                  </TableCell>
                  <TableCell className="relative z-10">
                    {(() => {
                      const acct = (client.accountType ?? "").toLowerCase();
                      if (acct === "agency") return (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700">
                          Agency
                        </span>
                      );
                      if (acct === "retail") return (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-900/30 dark:text-violet-300 dark:border-violet-700">
                          Retail
                        </span>
                      );
                      return <span className="text-muted-foreground text-sm">—</span>;
                    })()}
                  </TableCell>
                  <TableCell className="relative z-10" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={client.status === "active"}
                        onCheckedChange={() => toggleStatus(client.id, client.status, client.businessName)}
                        className="data-[state=checked]:bg-emerald-500"
                        disabled={togglingId === client.id}
                      />
                      <span className={`text-xs font-semibold ${
                        client.status === "active"
                          ? "text-emerald-700 dark:text-emerald-400"
                          : "text-slate-500 dark:text-slate-400"
                      }`}>
                        {client.status === "active" ? "Active" : "Inactive"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right relative z-20" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-slate-600 hover:text-primary"
                        onClick={() => setAddBusinessFor({ clientId: client.id, clientName: client.businessName })}
                        title="Add Business"
                      >
                        <Building2 className="h-4 w-4" />
                      </Button>
                      <Link href={`/clients/${client.id}?edit=biz`}>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-slate-600 hover:text-primary"
                          title="Edit Client"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </Link>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-slate-600 hover:text-destructive"
                        onClick={() => setConfirmDelete({ id: client.id, name: client.businessName })}
                        title="Delete Client"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {totalFiltered} client{totalFiltered !== 1 ? "s" : ""}
        </span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Prev</Button>
          <span className="text-sm text-muted-foreground">Page {page + 1} / {totalPages}</span>
          <Button size="sm" variant="outline" disabled={page + 1 >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      </div>

      {/* Reactivate confirmation dialog */}
      <AlertDialog open={!!confirmReactivate} onOpenChange={(open) => { if (!open) setConfirmReactivate(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reactivate "{confirmReactivate?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will reactivate <strong>{confirmReactivate?.name}</strong> (ID&nbsp;{confirmReactivate?.id}).
              {confirmReactivate?.keywordCount != null && confirmReactivate.keywordCount > 0
                ? ` All ${confirmReactivate.keywordCount} keyword${confirmReactivate.keywordCount !== 1 ? "s" : ""} for this client will also be reactivated.`
                : " No keywords are linked to this client."}
              {" "}Please confirm this is the correct client.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmReactivate(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={() => {
                if (confirmReactivate) {
                  doToggle(confirmReactivate.id, "inactive");
                  setConfirmReactivate(null);
                }
              }}
            >
              Yes, reactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Deactivate confirmation dialog */}
      <AlertDialog open={!!confirmDeactivate} onOpenChange={(open) => { if (!open) setConfirmDeactivate(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate "{confirmDeactivate?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will deactivate <strong>{confirmDeactivate?.name}</strong> (ID&nbsp;{confirmDeactivate?.id}).
              {confirmDeactivate?.keywordCount != null && confirmDeactivate.keywordCount > 0
                ? ` All ${confirmDeactivate.keywordCount} keyword${confirmDeactivate.keywordCount !== 1 ? "s" : ""} for this client will also be deactivated.`
                : " No keywords are linked to this client."}
              {" "}Please confirm this is the correct client.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmDeactivate(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (confirmDeactivate) {
                  doToggle(confirmDeactivate.id, "active");
                  setConfirmDeactivate(null);
                }
              }}
            >
              Yes, deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Add Client confirmation dialog */}
      <AlertDialog open={!!confirmAddClient} onOpenChange={(open) => { if (!open) setConfirmAddClient(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Add New Client?</AlertDialogTitle>
            <AlertDialogDescription>
              Would you like to add <strong>{confirmAddClient?.businessName}</strong> to your client list?
              {" "}Please review the information and confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmAddClient(null)}>Go Back</AlertDialogCancel>
            <AlertDialogAction
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={handleConfirmAdd}
              disabled={createClient.isPending}
            >
              {createClient.isPending ? "Adding..." : "Yes, Add Client"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete client confirmation */}
      <AlertDialog open={!!confirmDelete} onOpenChange={(open) => { if (!open) setConfirmDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{confirmDelete?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the client along with all of its businesses, keywords, sessions, and ranking reports. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmDelete(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deletingId != null}
              onClick={() => { if (confirmDelete) doDeleteClient(confirmDelete.id); }}
            >
              Yes, delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Post-create: prompt to add first business */}
      <AlertDialog open={!!postCreatePrompt} onOpenChange={(open) => { if (!open) setPostCreatePrompt(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Add a business for {postCreatePrompt?.clientName}?</AlertDialogTitle>
            <AlertDialogDescription>
              Every client needs at least one business to track keywords and rankings.
              You can add it now or later from the client's page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPostCreatePrompt(null)}>Later</AlertDialogCancel>
            <AlertDialogAction
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={() => {
                if (postCreatePrompt) {
                  setAddBusinessFor(postCreatePrompt);
                  setPostCreatePrompt(null);
                }
              }}
            >
              Yes, add business now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Post-business: prompt to add first campaign */}
      <AlertDialog open={!!postBusinessPrompt} onOpenChange={(open) => { if (!open) setPostBusinessPrompt(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Add a campaign for {postBusinessPrompt?.businessName}?</AlertDialogTitle>
            <AlertDialogDescription>
              Campaigns are how keywords are organized. Add one now or later from the business page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPostBusinessPrompt(null)}>Later</AlertDialogCancel>
            <AlertDialogAction
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={() => {
                if (postBusinessPrompt) {
                  setAddCampaignFor({
                    clientId: postBusinessPrompt.clientId,
                    businessId: postBusinessPrompt.businessId,
                    businessName: postBusinessPrompt.businessName,
                  });
                  setPostBusinessPrompt(null);
                }
              }}
            >
              Yes, add campaign now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {addBusinessFor && (
        <AddBusinessDialog
          open={!!addBusinessFor}
          onOpenChange={(open) => { if (!open) setAddBusinessFor(null); }}
          clientId={addBusinessFor.clientId}
          clientName={addBusinessFor.clientName}
          onCreated={(business) => {
            refetch();
            setAddBusinessFor(null);
            setPostBusinessPrompt({
              clientId: addBusinessFor.clientId,
              clientName: addBusinessFor.clientName,
              businessId: business.id,
              businessName: business.name,
            });
          }}
          onUpdated={() => refetch()}
        />
      )}

      {addCampaignFor && (
        <CampaignFormDialog
          open={!!addCampaignFor}
          onOpenChange={(open) => { if (!open) setAddCampaignFor(null); }}
          clientId={addCampaignFor.clientId}
          businessId={addCampaignFor.businessId}
          businessName={addCampaignFor.businessName}
          onSaved={() => { refetch(); setAddCampaignFor(null); }}
        />
      )}

      {/* Cancel creating client confirmation dialog */}
      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Creating Client?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to cancel? All the information you've entered will be lost. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmCancel(false)}>Continue Editing</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleConfirmCancel}
            >
              Yes, Cancel
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
