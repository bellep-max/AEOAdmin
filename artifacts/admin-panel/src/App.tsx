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
import ClientDetail from "@/pages/client-detail";
import BusinessDetail from "@/pages/business-detail";
import CampaignDetail from "@/pages/campaign-detail";
import Keywords from "@/pages/keywords";
import Plans from "@/pages/plans";
import Rankings from "@/pages/rankings";
import Metrics from "@/pages/metrics";
import Profile from "@/pages/profile";
import Packages from "@/pages/packages";
import SessionsDaily from "@/pages/sessions-daily";
import SessionsAudit from "@/pages/sessions-audit";
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
        <Route path="/clients" component={Clients} />
        <Route path="/clients/:id" component={ClientDetail} />
        <Route path="/clients/:clientId/businesses/:businessId" component={BusinessDetail} />
        <Route path="/clients/:clientId/businesses/:businessId/campaigns/:campaignId" component={CampaignDetail} />
        <Route path="/plans" component={Plans} />
        <Route path="/keywords" component={Keywords} />
        <Route path="/rankings" component={Rankings} />
        <Route path="/metrics" component={Metrics} />
        <Route path="/packages" component={Packages} />
        <Route path="/sessions/daily" component={SessionsDaily} />
        <Route path="/sessions/audit" component={SessionsAudit} />
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
      <Route path="/login">
        {user ? <Redirect to="/" /> : <Login />}
      </Route>
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
