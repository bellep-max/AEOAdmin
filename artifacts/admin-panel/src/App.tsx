import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout/main-layout";
import NotFound from "@/pages/not-found";

// Pages
import Dashboard from "@/pages/dashboard";
import Clients from "@/pages/clients";
import ClientDetail from "@/pages/client-detail";
import Keywords from "@/pages/keywords";
import Sessions from "@/pages/sessions";
import StressTest from "@/pages/stress-test";
import Devices from "@/pages/devices";
import Proxies from "@/pages/proxies";
import Rankings from "@/pages/rankings";
import Scaling from "@/pages/scaling";
import Tasks from "@/pages/tasks";
import Plans from "@/pages/plans";

const queryClient = new QueryClient();

function Router() {
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
        <Route path="/scaling" component={Scaling} />
        <Route path="/tasks" component={Tasks} />
        <Route path="/plans" component={Plans} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
