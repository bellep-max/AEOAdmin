import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout/main-layout";
import { AuthProvider, useAuth } from "@/lib/auth";
import NotFound from "@/pages/not-found";

// Pages
import Login from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import Clients from "@/pages/clients";
import ClientDetail from "@/pages/client-detail";
import Keywords from "@/pages/keywords";
import Sessions from "@/pages/sessions";
import StressTest from "@/pages/stress-test";
import Devices from "@/pages/devices";
import Proxies from "@/pages/proxies";
import Rankings from "@/pages/rankings";
import Metrics from "@/pages/metrics";
import Scaling from "@/pages/scaling";
import Tasks from "@/pages/tasks";
import Plans from "@/pages/plans";
import FarmMetrics from "@/pages/farm-metrics";
import BusinessMetrics from "@/pages/business-metrics";

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
        <Route path="/keywords" component={Keywords} />
        <Route path="/sessions" component={Sessions} />
        <Route path="/sessions/stress-test" component={StressTest} />
        <Route path="/devices" component={Devices} />
        <Route path="/proxies" component={Proxies} />
        <Route path="/rankings" component={Rankings} />
        <Route path="/metrics" component={Metrics} />
        <Route path="/scaling" component={Scaling} />
        <Route path="/tasks" component={Tasks} />
        <Route path="/plans" component={Plans} />
        <Route path="/farm-metrics" component={FarmMetrics} />
        <Route path="/business-metrics" component={BusinessMetrics} />
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
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider>
            <Router />
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
