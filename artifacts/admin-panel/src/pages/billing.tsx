import { useQuery } from "@tanstack/react-query";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "wouter";
import { CreditCard, AlertTriangle } from "lucide-react";

/* Owner-only billing overview: every campaign with a real Stripe link and its
   live state, plus the account's newest charges (includes payers never linked
   to an admin campaign — legacy clients, funnel tests). */

const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
function rawFetch(path: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (BASE.includes("ngrok")) headers["ngrok-skip-browser-warning"] = "true";
  return fetch(BASE + path, { credentials: "include", headers });
}

interface CampaignBillingRow {
  planId: number;
  clientId: number;
  clientName: string;
  clientStatus: string;
  campaignName: string | null;
  planType: string;
  stripeId: string | null;
  paidConversionDate: string | null;
  campaignStatus: string | null;
  billing: {
    billingEmail: string | null;
    cardLast4: string | null;
    subscriptionStatus: string | null;
    monthlyPrice: number | null;
    currentPeriodEnd: string | null;
    paymentStatus: string | null;
    hasFailedPayment: boolean;
    lastPaymentDate: string | null;
  } | null;
}

interface RecentCharge {
  date: string | null;
  amount: number;
  currency: string;
  status: string;
  name: string | null;
  email: string | null;
  failureMessage: string | null;
}

interface OverviewResponse {
  campaigns: CampaignBillingRow[];
  recentCharges: RecentCharge[];
}

function money(amount: number | null, currency = "usd"): string {
  if (amount == null) return "—";
  return `$${amount.toLocaleString()}${currency !== "usd" ? ` ${currency.toUpperCase()}` : ""}`;
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  const good = ["active", "succeeded", "trialing"].includes(status);
  const bad = [
    "failed",
    "past_due",
    "unpaid",
    "canceled",
    "incomplete",
  ].includes(status);
  return (
    <Badge
      variant={good ? "default" : bad ? "destructive" : "secondary"}
      className="text-xs"
    >
      {status}
    </Badge>
  );
}

export default function Billing() {
  const { data, isLoading, error } = useQuery<OverviewResponse>({
    queryKey: ["/api/billing/overview"],
    queryFn: async () => {
      const res = await rawFetch("/api/billing/overview");
      if (!res.ok) throw new Error("Failed to load billing overview");
      return res.json();
    },
    // Live Stripe fan-out is slow-ish; don't hammer it on refocus.
    staleTime: 60_000,
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-2">
        <CreditCard className="w-5 h-5" />
        <h1 className="text-xl font-bold">Billing</h1>
      </div>

      {isLoading && (
        <p className="text-sm text-muted-foreground">
          Loading live Stripe data…
        </p>
      )}
      {error != null && (
        <p className="text-sm text-red-600">
          {error instanceof Error ? error.message : "Failed to load"}
        </p>
      )}

      {data && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Linked campaigns ({data.campaigns.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.campaigns.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No campaigns hold a Stripe customer/subscription yet.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Client</TableHead>
                        <TableHead>Plan</TableHead>
                        <TableHead>Card</TableHead>
                        <TableHead>Subscription</TableHead>
                        <TableHead>Monthly</TableHead>
                        <TableHead>Last payment</TableHead>
                        <TableHead>Next billing</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.campaigns.map((c) => (
                        <TableRow key={c.planId}>
                          <TableCell>
                            <Link
                              href={`/clients/${c.clientId}`}
                              className="font-medium hover:underline"
                            >
                              {c.clientName}
                            </Link>
                            {c.billing?.billingEmail && (
                              <div className="text-xs text-muted-foreground">
                                {c.billing.billingEmail}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                c.planType === "Free Trial Plans"
                                  ? "secondary"
                                  : "default"
                              }
                              className="text-xs"
                            >
                              {c.planType}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {c.billing?.cardLast4
                              ? `•••• ${c.billing.cardLast4}`
                              : "—"}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <StatusBadge
                                status={c.billing?.subscriptionStatus ?? null}
                              />
                              {c.billing?.hasFailedPayment && (
                                <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            {money(c.billing?.monthlyPrice ?? null)}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <StatusBadge
                                status={c.billing?.paymentStatus ?? null}
                              />
                              <span className="text-xs text-muted-foreground">
                                {c.billing?.lastPaymentDate ?? ""}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            {c.billing?.currentPeriodEnd ?? "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Recent charges — whole Stripe account (
                {data.recentCharges.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Decline reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.recentCharges.map((ch, i) => (
                      <TableRow key={i}>
                        <TableCell className="whitespace-nowrap">
                          {ch.date ?? "—"}
                        </TableCell>
                        <TableCell>{money(ch.amount, ch.currency)}</TableCell>
                        <TableCell>
                          <StatusBadge status={ch.status} />
                        </TableCell>
                        <TableCell>{ch.name ?? "—"}</TableCell>
                        <TableCell className="text-xs">
                          {ch.email ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs text-red-600">
                          {ch.failureMessage ?? ""}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
