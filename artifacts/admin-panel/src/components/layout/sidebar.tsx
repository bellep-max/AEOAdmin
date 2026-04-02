import { Sidebar, SidebarContent, SidebarHeader, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarProvider, SidebarRail, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarFooter } from "@/components/ui/sidebar";
import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  Users, 
  Key, 
  Activity, 
  Server, 
  Network, 
  Trophy, 
  TrendingUp, 
  CheckSquare, 
  CreditCard,
  Zap,
  BarChart3,
  LogOut,
  Radio
} from "lucide-react";
import { useGetNetworkHealth } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";

export function AppSidebar() {
  const [location] = useLocation();
  const { data: health } = useGetNetworkHealth();
  const { user, logout } = useAuth();
  
  const navItems = [
    { name: "Dashboard", href: "/", icon: LayoutDashboard },
    { name: "Clients", href: "/clients", icon: Users },
    { name: "Keywords", href: "/keywords", icon: Key },
    { name: "Sessions", href: "/sessions", icon: Activity },
    { name: "Stress Test", href: "/sessions/stress-test", icon: Zap },
    { name: "Devices", href: "/devices", icon: Server },
    { name: "Proxies", href: "/proxies", icon: Network },
    { name: "Rankings", href: "/rankings", icon: Trophy },
    { name: "Session Metrics", href: "/metrics", icon: BarChart3 },
    { name: "Scaling Plan", href: "/scaling", icon: TrendingUp },
    { name: "Tasks", href: "/tasks", icon: CheckSquare },
    { name: "Plans", href: "/plans", icon: CreditCard },
  ];

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border px-4 py-4">
        <div className="flex items-center gap-2 font-bold text-lg text-primary tracking-tight">
          <Radio className="w-6 h-6 text-primary" />
          <span className="group-data-[collapsible=icon]:hidden">SIGNAL AEO</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Operations</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.name}>
                  <SidebarMenuButton asChild isActive={location === item.href} tooltip={item.name}>
                    <Link href={item.href} className="flex items-center gap-3">
                      <item.icon className="w-4 h-4" />
                      <span>{item.name}</span>
                      {item.name === "Devices" && health && health.devicesAvailable > 0 && (
                        <span className="ml-auto w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      )}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border p-4 group-data-[collapsible=icon]:p-2">
        <div className="space-y-2 group-data-[collapsible=icon]:hidden">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${health?.score && health.score > 90 ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            System: {health?.score ? `${health.score}%` : 'Checking…'}
          </div>
          {user && (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-foreground truncate max-w-[120px]">{user.name}</p>
                <p className="text-[10px] text-muted-foreground truncate max-w-[120px]">{user.email}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                onClick={logout}
                title="Sign out"
              >
                <LogOut className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}
        </div>
        <div className="hidden group-data-[collapsible=icon]:flex justify-center">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={logout}
            title="Sign out"
          >
            <LogOut className="w-3.5 h-3.5" />
          </Button>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
