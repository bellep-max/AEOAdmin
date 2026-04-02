import { useGetDevices, useGetDeviceFarmStatus } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Smartphone, Clock, Activity, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";

export default function Devices() {
  const { data: status, isLoading: isStatusLoading } = useGetDeviceFarmStatus();
  const { data: devices, isLoading: isDevicesLoading } = useGetDevices();

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Device Farm</h1>
          <p className="text-muted-foreground">Manage physical Android hardware nodes.</p>
        </div>
        <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
          <Plus className="w-4 h-4 mr-2" />
          Add Device
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <StatusCard title="Total Devices" value={status?.total} loading={isStatusLoading} />
        <StatusCard title="Available" value={status?.available} className="border-emerald-500/20 text-emerald-500" loading={isStatusLoading} />
        <StatusCard title="In Use" value={status?.inUse} className="border-primary/20 text-primary" loading={isStatusLoading} />
        <StatusCard title="Offline" value={status?.offline} className="border-destructive/20 text-destructive" loading={isStatusLoading} />
      </div>

      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {isDevicesLoading ? (
          Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} className="bg-card/50">
              <CardHeader className="pb-2"><Skeleton className="h-5 w-24" /></CardHeader>
              <CardContent><Skeleton className="h-10 w-full mb-2" /><Skeleton className="h-4 w-32" /></CardContent>
            </Card>
          ))
        ) : devices?.length === 0 ? (
          <div className="col-span-full py-12 text-center text-muted-foreground border rounded-lg bg-card/50">
            No devices configured.
          </div>
        ) : (
          devices?.map((device) => (
            <Card key={device.id} className="bg-card flex flex-col">
              <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm font-medium font-mono text-muted-foreground">
                  {device.deviceIdentifier}
                </CardTitle>
                <Badge variant="outline" className={
                  device.status === 'available' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' :
                  device.status === 'in_use' ? 'bg-primary/10 text-primary border-primary/20' :
                  'bg-destructive/10 text-destructive border-destructive/20'
                }>
                  {device.status.replace('_', ' ').toUpperCase()}
                </Badge>
              </CardHeader>
              <CardContent className="pb-2 flex-1">
                <div className="flex items-center gap-2 mt-1 mb-4">
                  <Smartphone className="h-5 w-5 text-foreground" />
                  <span className="font-bold text-lg text-foreground">{device.model}</span>
                </div>
                {device.retiredToday && (
                  <Badge variant="secondary" className="mb-2 bg-amber-500/10 text-amber-500">Retired Today</Badge>
                )}
              </CardContent>
              <CardFooter className="border-t border-border/50 bg-muted/20 px-6 py-3 flex justify-between text-xs text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Activity className="h-3 w-3" />
                  {device.sessionsToday || 0} today
                </div>
                <div className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {device.lastUsedAt ? formatDistanceToNow(new Date(device.lastUsedAt), { addSuffix: true }) : 'Never'}
                </div>
              </CardFooter>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

function StatusCard({ title, value, className = "", loading }: { title: string, value?: number, className?: string, loading: boolean }) {
  return (
    <Card className={`bg-card/50 ${className}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? <Skeleton className="h-8 w-16" /> : <div className={`text-3xl font-bold ${className.includes('text-') ? '' : 'text-foreground'}`}>{value || 0}</div>}
      </CardContent>
    </Card>
  );
}
