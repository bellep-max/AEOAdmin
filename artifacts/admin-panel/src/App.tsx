import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout/main-layout";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ThemeProvider } from "@/lib/theme";
import NotFound from "@/pages/not-found";

// Pages
import Login from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import Clients from "@/pages/clients";
import Businesses from "@/pages/businesses";
import ClientDetail from "@/pages/client-detail";
import BusinessDetail from "@/pages/business-detail";
import CampaignDetail from "@/pages/campaign-detail";
import Keywords from "@/pages/keywords";
import KeywordsAll from "@/pages/keywords-all";
import KeywordDetail from "@/pages/keyword-detail";
import Plans from "@/pages/plans";
import Rankings from "@/pages/rankings";
import SentEmails from "@/pages/sent-emails";
import Metrics from "@/pages/metrics";
import Profile from "@/pages/profile";
import Packages from "@/pages/packages";
import SessionsDaily from "@/pages/sessions-daily";
import SessionsAudit from "@/pages/sessions-audit";
import Prompts from "@/pages/prompts";
import Reports from "@/pages/reports";
import ReportDetail from "@/pages/report-detail";
import AdminVariants from "@/pages/admin-variants";
import AeoReporter from "@/pages/aeo-reporter";
import SalesAI from "@/pages/sales-ai";
import Chatbot from "@/pages/chatbot";
import KeywordRotation from "@/pages/keyword-rotation";
import RotationOverview from "@/pages/rotation-overview";
import LockedKeywords from "@/pages/locked-keywords";
import Archived from "@/pages/archived";
import SummaryReport from "@/pages/summary-report";

import type { ComponentType } from "react";

function OwnerGate({
  component: Component,
}: {
  component: ComponentType<unknown>;
}) {
  const { isOwner, isLoading } = useAuth();
  if (isLoading) return null;
  if (!isOwner) return <Redirect to="/" />;
  return <Component />;
}

/** owner, sales, OR chuckslocal — mirrors BE
 *  requireRoles("owner","sales","chuckslocal") on /api/llm/sales-ai/stream.
 *  Used on /sales-ai. */
function OwnerOrSalesGate({
  component: Component,
}: {
  component: ComponentType<unknown>;
}) {
  const { isOwner, isSales, isChucksLocal, isLoading } = useAuth();
  if (isLoading) return null;
  if (!isOwner && !isSales && !isChucksLocal) return <Redirect to="/" />;
  return <Component />;
}

/** Routes reserved for the admin-panel role chain (viewer/editor/admin/owner).
 *  Scoped roles (sales, account-manager) get redirected to the dashboard —
 *  they have their own scoped surface (Dashboard, Clients, Rankings, AEO
 *  Reporter) and shouldn't reach admin tooling even if they type the URL or
 *  follow a deep link from elsewhere. */
function AdminTierGate({
  component: Component,
}: {
  component: ComponentType<unknown>;
}) {
  const { user, isSales, isAccountManager, isChucksLocal, isLoading } =
    useAuth();
  if (isLoading) return null;
  if (!user || isSales || isAccountManager || isChucksLocal)
    return <Redirect to="/" />;
  return <Component />;
}

/** Routes chuckslocal is explicitly allowed on (scoped to his plan slice by
 *  the BE), plus the admin chain. Sales and account-manager still get
 *  redirected away. Used for /archived — chuckslocal can view/archive/
 *  restore his own clients but has no other admin-tier access. */
function AdminTierOrChucksLocalGate({
  component: Component,
}: {
  component: ComponentType<unknown>;
}) {
  const { user, isSales, isAccountManager, isLoading } = useAuth();
  if (isLoading) return null;
  if (!user || isSales || isAccountManager) return <Redirect to="/" />;
  return <Component />;
}

/** Routes account-manager is explicitly allowed on, plus the admin chain.
 *  Sales still gets redirected away. Used for /keywords routes where account-
 *  manager is in scope but sales is not. */
function AccountManagerOrAdminGate({
  component: Component,
}: {
  component: ComponentType<unknown>;
}) {
  const { user, isSales, isLoading } = useAuth();
  if (isLoading) return null;
  if (!user || isSales) return <Redirect to="/" />;
  return <Component />;
}
// import OrganizationDetails from "@/pages/organization-details";

const queryClient = new QueryClient();

function ProtectedRoutes() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Redirect to="/login" />;
  }

  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/archived">
          <AdminTierOrChucksLocalGate component={Archived} />
        </Route>
        <Route path="/clients" component={Clients} />
        <Route path="/businesses" component={Businesses} />
        <Route path="/clients/:id/summary-report" component={SummaryReport} />
        <Route path="/clients/:id" component={ClientDetail} />
        <Route
          path="/clients/:clientId/businesses/:businessId"
          component={BusinessDetail}
        />
        <Route
          path="/clients/:clientId/businesses/:businessId/campaigns/:campaignId/keywords/:keywordId"
          component={KeywordDetail}
        />
        <Route
          path="/clients/:clientId/businesses/:businessId/campaigns/:campaignId"
          component={CampaignDetail}
        />
        <Route path="/plans">
          <AdminTierGate component={Plans} />
        </Route>
        <Route path="/keywords">
          <AccountManagerOrAdminGate component={Keywords} />
        </Route>
        <Route path="/keywords/all">
          <AccountManagerOrAdminGate component={KeywordsAll} />
        </Route>
        <Route path="/rankings" component={Rankings} />
        <Route path="/sent-emails" component={SentEmails} />
        <Route path="/metrics">
          <AdminTierGate component={Metrics} />
        </Route>
        <Route path="/packages">
          <AdminTierGate component={Packages} />
        </Route>
        <Route path="/sessions/daily">
          <AdminTierGate component={SessionsDaily} />
        </Route>
        <Route path="/sessions/audit">
          <AdminTierGate component={SessionsAudit} />
        </Route>
        <Route path="/reports/:id">
          <OwnerGate component={ReportDetail} />
        </Route>
        <Route path="/reports">
          <OwnerGate component={Reports} />
        </Route>
        <Route path="/aeo-reporter" component={AeoReporter} />
        <Route path="/chatbot" component={Chatbot} />
        <Route path="/sales-ai">
          <OwnerOrSalesGate component={SalesAI} />
        </Route>
        <Route path="/keyword-rotation">
          <AdminTierGate component={KeywordRotation} />
        </Route>
        <Route path="/keyword-rotation/overview">
          <AdminTierGate component={RotationOverview} />
        </Route>
        <Route path="/keyword-rotation/locked">
          <AdminTierGate component={LockedKeywords} />
        </Route>
        <Route path="/admin/prompts">
          <AdminTierGate component={Prompts} />
        </Route>
        <Route path="/admin/variants">
          <OwnerGate component={AdminVariants} />
        </Route>
        {/* <Route path="/organization" component={OrganizationDetails} /> */}
        <Route path="/profile" component={Profile} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function Router() {
  const { user, isLoading } = useAuth();

  if (isLoading) return null;

  return (
    <Switch>
      <Route path="/login">{user ? <Redirect to="/" /> : <Login />}</Route>
      <Route>
        <ProtectedRoutes />
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <AuthProvider>
              <Router />
            </AuthProvider>
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
