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
  Zap
} from "lucide-react";
import { useGetNetworkHealth } from "@workspace/api-client-react";

export function AppSidebar() {
  const [location] = useLocation();
  const { data: health } = useGetNetworkHealth();
  
  const navItems = [
    { name: "Dashboard", href: "/", icon: LayoutDashboard },
    { name: "Clients", href: "/clients", icon: Users },
    { name: "Keywords", href: "/keywords", icon: Key },
    { name: "Sessions", href: "/sessions", icon: Activity },
    { name: "Stress Test", href: "/sessions/stress-test", icon: Zap },
    { name: "Devices", href: "/devices", icon: Server },
    { name: "Proxies", href: "/proxies", icon: Network },
    { name: "Rankings", href: "/rankings", icon: Trophy },
    { name: "Scaling Plan", href: "/scaling", icon: TrendingUp },
    { name: "Tasks", href: "/tasks", icon: CheckSquare },
    { name: "Plans", href: "/plans", icon: CreditCard },
  ];

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border px-4 py-4">
        <div className="flex items-center gap-2 font-bold text-lg text-primary tracking-tight">
          <Activity className="w-6 h-6 text-primary" />
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
      <SidebarFooter className="border-t border-sidebar-border p-4 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${health?.score && health.score > 90 ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          System Status: {health?.score ? `${health.score}%` : 'Checking...'}
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
