import { useState } from "react";
import { useGetSessions } from "@workspace/api-client-react";
import { 
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow 
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, ExternalLink, MessageSquare } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";

export default function Sessions() {
  const [search, setSearch] = useState("");
  const { data: sessionsData, isLoading } = useGetSessions({ limit: 50 });

  const sessions = sessionsData?.sessions;

  const filteredSessions = sessions?.filter(s => 
    (s.clientName && s.clientName.toLowerCase().includes(search.toLowerCase())) ||
    (s.keywordText && s.keywordText.toLowerCase().includes(search.toLowerCase()))
  );

  const getPlatformColor = (platform: string) => {
    switch(platform) {
      case 'gemini': return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
      case 'chatgpt': return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
      case 'perplexity': return 'bg-amber-500/10 text-amber-500 border-amber-500/20';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Session Log</h1>
          <p className="text-muted-foreground">Raw log of all executed AEO search sessions.</p>
        </div>
      </div>

      <div className="flex items-center gap-4 w-full">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search by client or keyword..."
            className="pl-9 bg-card"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="border rounded-md bg-card/50">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Timestamp</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Keyword</TableHead>
              <TableHead>Platform</TableHead>
              <TableHead>Device ID</TableHead>
              <TableHead>Follow-up</TableHead>
              <TableHead className="text-right">Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 10 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-8" /></TableCell>
                  <TableCell><Skeleton className="h-8 w-8 ml-auto" /></TableCell>
                </TableRow>
              ))
            ) : filteredSessions?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  No sessions found.
                </TableCell>
              </TableRow>
            ) : (
              filteredSessions?.map((s) => (
                <TableRow key={s.id} className="hover:bg-muted/50">
                  <TableCell className="text-muted-foreground font-mono text-xs whitespace-nowrap">
                    {format(new Date(s.timestamp), 'yyyy-MM-dd HH:mm:ss')}
                  </TableCell>
                  <TableCell className="font-medium text-foreground">{s.clientName || `Client #${s.clientId}`}</TableCell>
                  <TableCell className="max-w-[200px] truncate" title={s.keywordText || ''}>{s.keywordText || '-'}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={getPlatformColor(s.aiPlatform)}>
                      {s.aiPlatform}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{s.deviceIdentifier || '-'}</TableCell>
                  <TableCell>
                    {s.followupText ? (
                      <MessageSquare className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {s.screenshotUrl && (
                      <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                        <a href={s.screenshotUrl} target="_blank" rel="noreferrer" title="View Screenshot">
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
