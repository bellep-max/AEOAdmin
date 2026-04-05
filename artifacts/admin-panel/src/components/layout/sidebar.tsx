import {
  Sidebar, SidebarContent, SidebarHeader, SidebarMenu, SidebarMenuItem,
  SidebarMenuButton, SidebarRail, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarFooter,
} from "@/components/ui/sidebar";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Users, Key, Trophy, BarChart3, LogOut, Radio,
} from "lucide-react";
import { useGetNetworkHealth } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";

const navGroups = [
  {
    label: "Overview",
    items: [
      { name: "Dashboard", href: "/",         icon: LayoutDashboard },
    ],
  },
  {
    label: "Campaigns",
    items: [
      { name: "Clients",  href: "/clients",   icon: Users },
      { name: "Keywords", href: "/keywords",  icon: Key },
    ],
  },
  {
    label: "Analytics",
    items: [
      { name: "Rankings",         href: "/rankings", icon: Trophy    },
      { name: "Session Metrics",  href: "/metrics",  icon: BarChart3 },
    ],
  },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { data: health } = useGetNetworkHealth();
  const { user, logout } = useAuth();

  const isActive = (href: string) =>
    href === "/" ? location === "/" : location.startsWith(href);

  const healthScore = health?.score ?? 0;
  const healthColor = healthScore > 90 ? "bg-emerald-500" : healthScore > 70 ? "bg-amber-500" : "bg-destructive";

  return (
    <Sidebar variant="inset" collapsible="icon">
      {/* Logo */}
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-2.5 px-2 py-3">
          <div className="relative flex-shrink-0">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shadow-sm">
              <Radio className="w-4 h-4 text-white" />
            </div>
            <span className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-sidebar ${healthColor}`} />
          </div>
          <div className="group-data-[collapsible=icon]:hidden leading-tight">
            <p className="text-sm font-bold text-foreground tracking-tight">Signal AEO</p>
            <p className="text-[10px] text-muted-foreground">Operations</p>
          </div>
        </div>
      </SidebarHeader>

      {/* Nav */}
      <SidebarContent className="py-2">
        {navGroups.map((group) => (
          <SidebarGroup key={group.label} className="py-0">
            <SidebarGroupLabel className="text-[10px] uppercase tracking-widest text-muted-foreground/50 px-3 py-1.5 group-data-[collapsible=icon]:hidden">
              {group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const active = isActive(item.href);
                  return (
                    <SidebarMenuItem key={item.name}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={item.name}
                        className={`mx-1 rounded-lg transition-all ${
                          active
                            ? "bg-primary/15 text-primary font-medium"
                            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                        }`}
                      >
                        <Link href={item.href} className="flex items-center gap-2.5 px-2 py-2">
                          <item.icon className={`w-4 h-4 flex-shrink-0 ${active ? "text-primary" : ""}`} />
                          <span className="text-sm group-data-[collapsible=icon]:hidden">{item.name}</span>
                          {active && (
                            <span className="ml-auto w-1.5 h-1.5 rounded-full bg-primary group-data-[collapsible=icon]:hidden" />
                          )}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      {/* Footer / user */}
      <SidebarFooter className="border-t border-sidebar-border p-3">
        {/* Health indicator */}
        <div className="mb-2 group-data-[collapsible=icon]:hidden">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">System</span>
            <span className={`text-[10px] font-bold ${healthScore > 90 ? "text-emerald-400" : "text-amber-400"}`}>
              {healthScore}%
            </span>
          </div>
          <div className="w-full bg-sidebar-accent rounded-full h-1 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${
                healthScore > 90 ? "gradient-bar-green" : "gradient-bar-amber"
              }`}
              style={{ width: `${healthScore}%` }}
            />
          </div>
        </div>

        {/* User row */}
        {user && (
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary/20 flex items-center justify-center text-xs font-bold text-primary flex-shrink-0">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
              <p className="text-xs font-medium text-foreground truncate">{user.name}</p>
              <p className="text-[10px] text-muted-foreground truncate">{user.role}</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 flex-shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              onClick={logout}
              title="Sign out"
            >
              <LogOut className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
