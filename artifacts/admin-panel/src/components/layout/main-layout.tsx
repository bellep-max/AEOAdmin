import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./sidebar";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { LogOut, Bell } from "lucide-react";

const PAGE_TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/clients": "Clients",
  "/keywords": "Keywords",
  "/sessions": "Sessions",
  "/sessions/stress-test": "Stress Test",
  "/devices": "Devices",
  "/proxies": "Proxies",
  "/rankings": "Rankings",
  "/metrics": "Session Metrics",
  "/scaling": "Scaling Plan",
  "/tasks": "Tasks",
  "/plans": "Plans",
};

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const [location] = useLocation();

  // Find the best matching title
  const title =
    PAGE_TITLES[location] ??
    Object.entries(PAGE_TITLES).find(([k]) => location.startsWith(k) && k !== "/")?.[1] ??
    "Signal AEO";

  return (
    <SidebarProvider>
      <AppSidebar />
      <div className="flex-1 flex flex-col min-h-screen bg-background text-foreground overflow-hidden">
        <header className="h-12 flex items-center justify-between px-4 border-b border-border/40 shrink-0 bg-card/40 backdrop-blur-md z-10 sticky top-0">
          <div className="flex items-center gap-3">
            <SidebarTrigger className="text-muted-foreground hover:text-foreground -ml-1" />
            <span className="text-sm font-semibold text-foreground hidden sm:block">{title}</span>
          </div>

          {user && (
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground relative">
                <Bell className="w-4 h-4" />
              </Button>
              <div className="hidden sm:flex items-center gap-2 pl-2 border-l border-border/50">
                <div className="w-7 h-7 rounded-lg bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <div className="hidden md:block leading-tight text-right">
                  <p className="text-xs font-medium text-foreground">{user.name}</p>
                  <p className="text-[10px] text-muted-foreground capitalize">{user.role}</p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                onClick={logout}
                title="Sign out"
              >
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
          )}
        </header>

        <main className="flex-1 overflow-auto">
          <div className="max-w-[1600px] mx-auto w-full p-4 md:p-6">
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
