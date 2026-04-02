import { useRoute } from "wouter";
import { 
  useGetClient, 
  useGetClientGbpSnippet, 
  useGetClientAeoSummary,
  useGetSessions
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MapPin, Globe, ExternalLink, ArrowUp, ArrowDown, Minus, Activity } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";

export default function ClientDetail() {
  const [, params] = useRoute("/clients/:id");
  const clientId = Number(params?.id);

  const { data: client, isLoading: isClientLoading } = useGetClient(clientId, { 
    query: { enabled: !!clientId, queryKey: ['getClient', clientId] } 
  });
  
  const { data: snippet, isLoading: isSnippetLoading } = useGetClientGbpSnippet(clientId, {
    query: { enabled: !!clientId, queryKey: ['getGbpSnippet', clientId] }
  });

  const { data: aeo, isLoading: isAeoLoading } = useGetClientAeoSummary(clientId, {
    query: { enabled: !!clientId, queryKey: ['getAeoSummary', clientId] }
  });

  const { data: sessions, isLoading: isSessionsLoading } = useGetSessions(
    { clientId, limit: 10 },
    { query: { enabled: !!clientId, queryKey: ['getSessions', clientId] } }
  );

  if (isClientLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-1/3" />
        <div className="grid gap-6 md:grid-cols-2">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (!client) {
    return <div>Client not found</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight text-white">{client.businessName}</h1>
          <Badge variant="outline" className={client.status === 'active' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-muted text-muted-foreground'}>
            {client.status}
          </Badge>
        </div>
        <p className="text-muted-foreground">
          {client.city && client.state ? `${client.city}, ${client.state}` : 'Location not set'} 
          {client.planName ? ` • ${client.planName}` : ''}
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Google Business Profile</CardTitle>
            <CardDescription>Verified map entity integration</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isSnippetLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : snippet ? (
              <>
                <div className="flex items-start gap-4">
                  <div className="bg-muted p-3 rounded-full">
                    <MapPin className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-foreground">{snippet.businessName}</span>
                      <Badge variant="outline" className={
                        snippet.verificationStatus === 'verified' ? 'border-emerald-500 text-emerald-500' :
                        snippet.verificationStatus === 'failed' ? 'border-destructive text-destructive' :
                        'border-amber-500 text-amber-500'
                      }>
                        {snippet.verificationStatus}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground break-all">{snippet.publishedAddress || 'No published address'}</p>
                    {snippet.placeId && <p className="text-xs text-muted-foreground font-mono mt-1">Place ID: {snippet.placeId}</p>}
                  </div>
                </div>
                
                <div className="flex gap-3 pt-2">
                  {snippet.gmbUrl && (
                    <a href={snippet.gmbUrl} target="_blank" rel="noreferrer" className="text-sm flex items-center text-primary hover:underline">
                      <MapPin className="h-3 w-3 mr-1" /> View on Maps
                    </a>
                  )}
                  {client.websiteUrl && (
                    <a href={client.websiteUrl} target="_blank" rel="noreferrer" className="text-sm flex items-center text-primary hover:underline">
                      <Globe className="h-3 w-3 mr-1" /> Website
                    </a>
                  )}
                </div>
              </>
            ) : (
              <div className="text-muted-foreground text-sm">No GBP snippet data available for this client.</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>AEO Campaign Performance</CardTitle>
            <CardDescription>Overall tracking metrics</CardDescription>
          </CardHeader>
          <CardContent>
             {isAeoLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : aeo ? (
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Total Clicks Delivered</p>
                    <p className="text-3xl font-bold text-white mt-1">{aeo.totalClicksDelivered.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Avg. Rank Position</p>
                    <p className="text-3xl font-bold text-white mt-1">{aeo.averageRankingPosition ? aeo.averageRankingPosition.toFixed(1) : '-'}</p>
                  </div>
                </div>
                
                <div>
                  <p className="text-sm font-medium mb-3">Top Keywords</p>
                  <div className="space-y-2">
                    {aeo.aeoKeywords.slice(0, 3).map(kw => {
                      const delta = (kw.initialRankingPosition || 0) - (kw.currentRankingPosition || 0);
                      const isUp = delta > 0;
                      const isDown = delta < 0;
                      return (
                        <div key={kw.keywordId} className="flex items-center justify-between text-sm p-2 bg-muted/50 rounded-md">
                          <span className="font-medium truncate max-w-[150px]" title={kw.keywordText}>{kw.keywordText}</span>
                          <div className="flex items-center gap-4">
                            <span className="text-muted-foreground">{kw.clicksDelivered} clicks</span>
                            <div className="flex items-center gap-1 w-16 justify-end font-mono">
                              {kw.currentRankingPosition || '-'}
                              {isUp && <ArrowUp className="h-3 w-3 text-emerald-500" />}
                              {isDown && <ArrowDown className="h-3 w-3 text-destructive" />}
                              {!isUp && !isDown && <Minus className="h-3 w-3 text-muted-foreground" />}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            ) : (
               <div className="text-muted-foreground text-sm">No AEO metrics available for this client.</div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Sessions</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead>Keyword</TableHead>
                <TableHead>Device</TableHead>
                <TableHead>Duration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isSessionsLoading ? (
                 Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={5}><Skeleton className="h-6 w-full" /></TableCell>
                  </TableRow>
                ))
              ) : sessions?.sessions && sessions.sessions.length > 0 ? (
                sessions.sessions.map(s => (
                  <TableRow key={s.id}>
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {format(new Date(s.timestamp), 'MMM d, HH:mm')}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={
                        s.aiPlatform === 'gemini' ? 'border-blue-500/30 text-blue-500' :
                        s.aiPlatform === 'chatgpt' ? 'border-emerald-500/30 text-emerald-500' :
                        'border-amber-500/30 text-amber-500'
                      }>
                        {s.aiPlatform}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">{s.keywordText || '-'}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{s.deviceIdentifier || '-'}</TableCell>
                    <TableCell className="text-muted-foreground">{s.durationSeconds ? `${s.durationSeconds}s` : '-'}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-6 text-muted-foreground">No recent sessions.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
