import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Bell } from "lucide-react";
import {
  useGetClients,
  getGetClientsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Newest signups appear at the top of GET /api/clients (ordered created_at desc).
// The unread badge is per-browser: we remember when the bell was last opened in
// localStorage and count clients created since. No server-side read state needed.
const LAST_SEEN_KEY = "aeo:notifications:lastSeenAt";
const RECENT_WINDOW_DAYS = 30;
const MAX_ITEMS = 10;

/** Reads the last-opened timestamp; seeds it to "now" on first ever load so
 *  pre-existing clients don't all light up the badge. */
function readLastSeen(): number {
  try {
    const stored = localStorage.getItem(LAST_SEEN_KEY);
    if (stored) return Number(stored);
    const now = Date.now();
    localStorage.setItem(LAST_SEEN_KEY, String(now));
    return now;
  } catch {
    return Date.now();
  }
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < RECENT_WINDOW_DAYS) return `${days}d`;
  return new Date(iso).toLocaleDateString();
}

export function NotificationBell() {
  const { data: clients } = useGetClients(
    { status: "active" },
    {
      // Poll every 2 min to match the auto-onboard cadence; don't refetch on
      // every navigation/focus.
      query: {
        queryKey: getGetClientsQueryKey({ status: "active" }),
        staleTime: 60_000,
        refetchInterval: 120_000,
        refetchOnWindowFocus: false,
      },
    },
  );
  const [lastSeen, setLastSeen] = useState<number>(readLastSeen);

  const recent = useMemo(() => {
    if (!clients) return [];
    const cutoff = Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    return [...clients]
      .filter((c) => {
        const t = new Date(c.createdAt).getTime();
        return Number.isFinite(t) && t >= cutoff;
      })
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .slice(0, MAX_ITEMS);
  }, [clients]);

  const unreadCount = useMemo(
    () =>
      recent.filter((c) => new Date(c.createdAt).getTime() > lastSeen).length,
    [recent, lastSeen],
  );

  const handleOpenChange = (open: boolean) => {
    if (open && unreadCount > 0) {
      const now = Date.now();
      try {
        localStorage.setItem(LAST_SEEN_KEY, String(now));
      } catch {
        // ignore — badge just won't clear this browser
      }
      setLastSeen(now);
    }
  };

  return (
    <DropdownMenu onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-foreground relative"
          title="Recent signups"
        >
          <Bell className="w-4 h-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold flex items-center justify-center leading-none">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>Recent signups</span>
          {recent.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              {recent.length}
            </span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {recent.length === 0 ? (
          <div className="px-2 py-6 text-center text-sm text-muted-foreground">
            No recent signups
          </div>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            {recent.map((c) => {
              const isNew = new Date(c.createdAt).getTime() > lastSeen;
              return (
                <DropdownMenuItem key={c.id} asChild className="cursor-pointer">
                  <Link href={`/clients/${c.id}`}>
                    <div className="flex w-full items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {isNew && (
                            <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-red-500 align-middle" />
                          )}
                          {c.businessName}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {c.planName || c.city || "New client"}
                        </p>
                      </div>
                      <span className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground">
                        {timeAgo(c.createdAt)}
                      </span>
                    </div>
                  </Link>
                </DropdownMenuItem>
              );
            })}
          </div>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="cursor-pointer justify-center">
          <Link href="/clients" className="text-xs text-primary">
            View all clients →
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
