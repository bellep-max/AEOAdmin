import { useGetProxies } from "@workspace/api-client-react";
import { 
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow 
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Network, Plus, ShieldCheck, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";

export default function Proxies() {
  const { data: proxies, isLoading } = useGetProxies();

  const resProxies = proxies?.filter(p => p.proxyType === 'residential') || [];
  const mobileProxies = proxies?.filter(p => p.proxyType === 'mobile') || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Proxy Pool</h1>
          <p className="text-muted-foreground">Residential and 5G mobile IP management.</p>
        </div>
        <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
          <Plus className="w-4 h-4 mr-2" />
          Add Proxy
        </Button>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <ProxyTable 
          title="Residential Proxies" 
          icon={<ShieldCheck className="h-5 w-5 text-emerald-500" />}
          proxies={resProxies} 
          isLoading={isLoading} 
        />
        <ProxyTable 
          title="Mobile (5G) Proxies" 
          icon={<Wifi className="h-5 w-5 text-primary" />}
          proxies={mobileProxies} 
          isLoading={isLoading} 
        />
      </div>
    </div>
  );
}

function ProxyTable({ title, icon, proxies, isLoading }: { title: string, icon: React.ReactNode, proxies: any[], isLoading: boolean }) {
  return (
    <div className="border rounded-xl bg-card overflow-hidden">
      <div className="p-4 border-b bg-card flex items-center gap-2">
        {icon}
        <h2 className="font-semibold text-lg">{title}</h2>
        <Badge variant="secondary" className="ml-auto">{proxies.length}</Badge>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Endpoint</TableHead>
            <TableHead className="text-right">Sessions</TableHead>
            <TableHead className="text-right">Last Used</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                <TableCell><Skeleton className="h-5 w-12 ml-auto" /></TableCell>
                <TableCell><Skeleton className="h-5 w-24 ml-auto" /></TableCell>
              </TableRow>
            ))
          ) : proxies.length === 0 ? (
            <TableRow>
              <TableCell colSpan={3} className="h-24 text-center text-muted-foreground">
                No proxies in this pool.
              </TableCell>
            </TableRow>
          ) : (
            proxies.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-mono text-sm text-muted-foreground">
                  {p.proxyUrl.replace(/:\/\/.+@/, '://***:***@')}
                </TableCell>
                <TableCell className="text-right font-mono">{p.sessionCount}</TableCell>
                <TableCell className="text-right text-muted-foreground text-sm">
                  {p.lastUsed ? formatDistanceToNow(new Date(p.lastUsed), { addSuffix: true }) : 'Never'}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
