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
import { Search, Plus, ExternalLink, MoreHorizontal } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { getPlanMeta, PLAN_NAMES } from "@/lib/plan-meta";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const businessFormSchema = z.object({
  // Business Information
  businessName: z.string().min(2, "Business name is required"),
  searchAddress: z.string().optional(),
  gmbAddress: z.string().optional(),
  gmbLink: z.string().url().optional().or(z.literal('')),
  websitePublishedOnGMB: z.string().optional(),
  websiteLinkedOnGMB: z.string().optional(),
  
  // Subscription Information
  plan: z.string().optional(),
  accountType: z.enum(['agency', 'retail']).optional(),
  startDate: z.string().optional(),
  nextBillDate: z.string().optional(),
  subscriptionId: z.string().optional(),
  
  // Account Information
  accountUser: z.string().optional(),
  accountUserName: z.string().optional(),
  accountEmail: z.string().email().optional().or(z.literal('')),
  billingEmail: z.string().email().optional().or(z.literal('')),
  cardLast4: z.string().optional(),
});

export default function Clients() {
  const [search, setSearch] = useState("");
  const [filterLocation, setFilterLocation] = useState("");
  const [filterAccountType, setFilterAccountType] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterPlan, setFilterPlan] = useState("all");
  const { data: clients, isLoading, refetch } = useGetClients();
  const createClient = useCreateClient();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState<{ id: number; name: string; keywordCount: number } | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);

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
    // Re-activating — do it directly
    await doToggle(clientId, currentStatus);
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
      plan: "",
      accountType: undefined,
      startDate: "",
      nextBillDate: "",
      subscriptionId: "",
      accountUser: "",
      accountUserName: "",
      accountEmail: "",
      billingEmail: "",
      cardLast4: "",
    },
  });

  const onSubmit = (values: z.infer<typeof businessFormSchema>) => {
    createClient.mutate({ data: values }, {
      onSuccess: () => {
        toast({ title: "Business added successfully" });
        setIsAddOpen(false);
        form.reset();
        refetch();
      },
      onError: () => {
        toast({ title: "Failed to add business", variant: "destructive" });
      }
    });
  };

  const filteredClients = clients?.filter((c) => {
    const nameMatch = !search || c.businessName.toLowerCase().includes(search.toLowerCase());
    const locMatch = !filterLocation ||
      (c.searchAddress ?? "").toLowerCase().includes(filterLocation.toLowerCase()) ||
      (c.city ?? "").toLowerCase().includes(filterLocation.toLowerCase());
    const typeMatch = filterAccountType === "all" || (c.accountType ?? "").toLowerCase() === filterAccountType;
    const statusMatch = filterStatus === "all" || c.status === filterStatus;
    const planMatch = filterPlan === "all" || c.planName === filterPlan;
    return nameMatch && locMatch && typeMatch && statusMatch && planMatch;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-black dark:text-white">Business</h1>
          <p className="text-lg text-slate-700 dark:text-slate-300">Business List</p>
        </div>
        
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button className="bg-primary text-primary-foreground hover:bg-primary/90 text-base font-bold h-11">
              <Plus className="w-4 h-4 mr-2" />
              Add Business
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[1200px] bg-white max-h-[90vh]">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold text-black">Add New Business</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 mt-4 max-h-[70vh] overflow-y-auto pr-4">
                {/* Business Information Section */}
                <div>
                  <h3 className="text-sm uppercase tracking-widest text-black font-bold mb-4">Business Information</h3>
                  <div className="space-y-4">
                    <FormField
                      control={form.control}
                      name="businessName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm uppercase tracking-widest text-black font-bold">Business Name *</FormLabel>
                          <FormControl>
                            <Input placeholder="Acme Plumbers" className="h-11 text-base text-black bg-slate-50" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="searchAddress"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm uppercase tracking-widest text-black font-bold">Search Address</FormLabel>
                          <FormControl>
                            <Input placeholder="123 Main St, Austin, TX" className="h-11 text-base text-black bg-slate-50" {...field} />
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
                            <Input placeholder="123 Main St, Austin, TX" className="h-11 text-base text-black bg-slate-50" {...field} />
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
                            <Input placeholder="https://maps.google.com/..." className="h-11 text-base text-black bg-slate-50" {...field} />
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
                            <Input placeholder="https://example.com" className="h-11 text-base text-black bg-slate-50" {...field} />
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
                            <Input placeholder="https://example.com" className="h-11 text-base text-black bg-slate-50" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                {/* Subscription Information Section */}
                <div>
                  <h3 className="text-sm uppercase tracking-widest text-black font-bold mb-4">Subscription Information</h3>
                  <div className="space-y-4">
                    <FormField
                      control={form.control}
                      name="plan"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm uppercase tracking-widest text-black font-bold">Plan</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value || ""}>
                            <FormControl>
                              <SelectTrigger className="h-11 text-base text-black bg-slate-50">
                                <SelectValue placeholder="Select a plan" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {[
                                "The AEO Suite",
                                "Agency Solutions",
                                "Performance Tiers",
                                "Growth Bundles",
                                "Optimization Tracks",
                                "Success Roadmaps",
                              ].map((p) => (
                                <SelectItem key={p} value={p}>{p}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="accountType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm uppercase tracking-widest text-black font-bold">Account Type</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value || ""}>
                            <FormControl>
                              <SelectTrigger className="h-11 text-base text-black bg-slate-50">
                                <SelectValue placeholder="Select account type" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="agency">Agency</SelectItem>
                              <SelectItem value="retail">Retail</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="startDate"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm uppercase tracking-widest text-black font-bold">Start Date</FormLabel>
                            <FormControl>
                              <Input type="date" className="h-11 text-base text-black bg-slate-50" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="nextBillDate"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm uppercase tracking-widest text-black font-bold">Next Bill Date</FormLabel>
                            <FormControl>
                              <Input type="date" className="h-11 text-base text-black bg-slate-50" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <FormField
                      control={form.control}
                      name="subscriptionId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm uppercase tracking-widest text-black font-bold">Subscription ID</FormLabel>
                          <FormControl>
                            <Input placeholder="SUB-12345" className="h-11 text-base text-black bg-slate-50" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                {/* Account Information Section */}
                <div>
                  <h3 className="text-sm uppercase tracking-widest text-black font-bold mb-4">Account Information</h3>
                  <div className="space-y-4">
                    <FormField
                      control={form.control}
                      name="accountUser"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm uppercase tracking-widest text-black font-bold">Account User</FormLabel>
                          <FormControl>
                            <Input placeholder="john.doe" className="h-11 text-base text-black bg-slate-50" {...field} />
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
                            <Input placeholder="John Doe" className="h-11 text-base text-black bg-slate-50" {...field} />
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
                            <Input type="email" placeholder="john@example.com" className="h-11 text-base text-black bg-slate-50" {...field} />
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
                            <Input type="email" placeholder="billing@example.com" className="h-11 text-base text-black bg-slate-50" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="cardLast4"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm uppercase tracking-widest text-black font-bold">Last 4 of Billing Credit Card</FormLabel>
                          <FormControl>
                            <Input placeholder="4242" maxLength={4} className="h-11 text-base text-black bg-slate-50" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                <div className="pt-4 flex justify-end sticky bottom-0 bg-white">
                  <Button type="submit" disabled={createClient.isPending} className="h-12 text-base font-bold">
                    {createClient.isPending ? "Creating..." : "Create Business"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 items-center">
        {/* Business Name */}
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
          <Input
            type="search"
            placeholder="Business name…"
            className="pl-9 h-10 w-52 bg-white text-sm text-black placeholder:text-slate-500"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
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
            onChange={(e) => setFilterLocation(e.target.value)}
          />
        </div>
        {/* Account Type */}
        <Select value={filterAccountType} onValueChange={setFilterAccountType}>
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
        <Select value={filterStatus} onValueChange={setFilterStatus}>
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
        <Select value={filterPlan} onValueChange={setFilterPlan}>
          <SelectTrigger className="h-10 w-52 bg-white text-sm text-black">
            <SelectValue placeholder="Plan" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Plans</SelectItem>
            {PLAN_NAMES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
        {/* Clear filters */}
        {(search || filterLocation || filterAccountType !== "all" || filterStatus !== "all" || filterPlan !== "all") && (
          <Button
            variant="ghost"
            size="sm"
            className="h-10 text-sm text-slate-500 hover:text-slate-900"
            onClick={() => { setSearch(""); setFilterLocation(""); setFilterAccountType("all"); setFilterStatus("all"); setFilterPlan("all"); }}
          >
            Clear filters
          </Button>
        )}
      </div>

      <div className="border rounded-md bg-white dark:bg-slate-950">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50 dark:bg-slate-900">
              <TableHead className="text-base font-bold text-black dark:text-white">Business Name</TableHead>
              <TableHead className="text-base font-bold text-black dark:text-white">Location</TableHead>
              <TableHead className="text-base font-bold text-black dark:text-white">Account Type</TableHead>
              <TableHead className="text-base font-bold text-black dark:text-white">Status</TableHead>
              <TableHead className="text-base font-bold text-black dark:text-white">Plan</TableHead>
              <TableHead className="text-right text-base font-bold text-black dark:text-white">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-52">
                  <div className="flex flex-col items-center justify-center gap-4 py-8">
                    <div className="w-10 h-10 rounded-full border-4 border-primary border-t-transparent animate-spin" />
                    <p className="text-base text-slate-600 dark:text-slate-400 font-medium">Loading businesses…</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : filteredClients?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-slate-600 dark:text-slate-400 text-base">
                  No businesses found.
                </TableCell>
              </TableRow>
            ) : (
              filteredClients?.map((client) => (
                <TableRow key={client.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer relative group border-b border-slate-200 dark:border-slate-800">
                  <TableCell className="font-bold text-base text-black dark:text-slate-100">
                    <Link href={`/clients/${client.id}`} className="absolute inset-0 z-0" />
                    <span className="relative z-10">{client.businessName}</span>
                  </TableCell>
                  <TableCell className="relative z-10 text-base text-black dark:text-slate-100">
                    <div className="space-y-0.5">
                      {client.searchAddress
                        ? <p className="text-sm text-black dark:text-slate-100"><span className="text-xs font-bold uppercase tracking-wide text-slate-500 mr-1">Search:</span>{client.searchAddress}</p>
                        : <p className="text-sm text-slate-400 italic">No search address</p>}
                      {(client as unknown as Record<string,unknown>).publishedAddress
                        ? <p className="text-sm text-black dark:text-slate-100"><span className="text-xs font-bold uppercase tracking-wide text-slate-500 mr-1">GMB:</span>{(client as unknown as Record<string,unknown>).publishedAddress as string}</p>
                        : <p className="text-sm text-slate-400 italic">No GMB address</p>}
                    </div>
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
                  <TableCell className="relative z-10">
                    {client.planName
                      ? (() => {
                          const meta = getPlanMeta(client.planName);
                          return (
                            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${meta.badgeClass} whitespace-nowrap`}>
                              {client.planName}
                            </span>
                          );
                        })()
                      : <span className="text-muted-foreground text-sm">—</span>
                    }
                  </TableCell>
                  <TableCell className="text-right relative z-20">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0 text-slate-600 dark:text-slate-400">
                          <span className="sr-only">Open menu</span>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-black dark:text-white">
                        <DropdownMenuLabel className="text-black dark:text-white font-bold">Actions</DropdownMenuLabel>
                        <Link href={`/clients/${client.id}`}>
                          <DropdownMenuItem className="cursor-pointer">
                            View Details
                          </DropdownMenuItem>
                        </Link>
                        {client.gmbUrl && (
                          <DropdownMenuItem className="cursor-pointer" onClick={() => window.open(client.gmbUrl!, '_blank')}>
                            Open Maps <ExternalLink className="ml-2 h-3 w-3" />
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

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
              {" "}Please confirm this is the correct business.
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
    </div>
  );
}
