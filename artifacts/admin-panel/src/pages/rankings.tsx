import { useState } from "react";
import { useGetRankingReports, useGetInitialVsCurrentRankings } from "@workspace/api-client-react";
import { 
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow 
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowUp, ArrowDown, Minus, MapPin } from "lucide-react";
import { format } from "date-fns";

export default function Rankings() {
  const { data: reports, isLoading: isReportsLoading } = useGetRankingReports();
  const { data: comparison, isLoading: isComparisonLoading } = useGetInitialVsCurrentRankings();

  const getRankBadge = (pos: number | null | undefined) => {
    if (!pos) return <Badge variant="outline" className="bg-muted">N/A</Badge>;
    if (pos <= 3) return <Badge className="bg-amber-400 hover:bg-amber-400/90 text-amber-950">Top {pos}</Badge>;
    if (pos <= 7) return <Badge className="bg-slate-300 hover:bg-slate-300/90 text-slate-900">Rank {pos}</Badge>;
    if (pos <= 10) return <Badge className="bg-amber-700 hover:bg-amber-700/90 text-white">Rank {pos}</Badge>;
    return <Badge variant="outline">Rank {pos}</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight text-white">Ranking Reports</h1>
        <p className="text-muted-foreground">AI search visibility and answer engine placement over time.</p>
      </div>

      <Tabs defaultValue="comparison" className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="comparison">Before / After</TabsTrigger>
          <TabsTrigger value="history">Historical Scrapes</TabsTrigger>
        </TabsList>
        
        <TabsContent value="comparison" className="mt-6">
          <div className="border rounded-md bg-card/50">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Keyword</TableHead>
                  <TableHead>Maps</TableHead>
                  <TableHead className="text-center">Initial Position</TableHead>
                  <TableHead className="text-center">Current Position</TableHead>
                  <TableHead className="text-right">Change</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isComparisonLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-16 mx-auto" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-16 mx-auto" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-16 ml-auto" /></TableCell>
                    </TableRow>
                  ))
                ) : comparison?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      No ranking comparison data available.
                    </TableCell>
                  </TableRow>
                ) : (
                  comparison?.map((row, i) => (
                    <TableRow key={`${row.clientId}-${row.keywordId}-${i}`} className="hover:bg-muted/50">
                      <TableCell className="font-medium">{row.clientName}</TableCell>
                      <TableCell>{row.keywordText}</TableCell>
                      <TableCell>
                        {row.mapsPresence === 'yes' ? (
                          <MapPin className="h-4 w-4 text-emerald-500" />
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex flex-col items-center">
                          {getRankBadge(row.initialPosition)}
                          {row.initialDate && <span className="text-[10px] text-muted-foreground mt-1">{format(new Date(row.initialDate), 'MMM d, yy')}</span>}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex flex-col items-center">
                          {getRankBadge(row.currentPosition)}
                          {row.currentDate && <span className="text-[10px] text-muted-foreground mt-1">{format(new Date(row.currentDate), 'MMM d, yy')}</span>}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {row.positionChange ? (
                          <div className={`flex items-center justify-end gap-1 ${row.positionChange > 0 ? 'text-emerald-500' : 'text-destructive'}`}>
                            {row.positionChange > 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                            {Math.abs(row.positionChange)}
                          </div>
                        ) : (
                          <div className="flex items-center justify-end text-muted-foreground"><Minus className="h-3 w-3" /></div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="history" className="mt-6">
          <div className="border rounded-md bg-card/50">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Keyword</TableHead>
                  <TableHead>Position</TableHead>
                  <TableHead>Snippet Reason</TableHead>
                  <TableHead>Type</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isReportsLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-48" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                    </TableRow>
                  ))
                ) : reports?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      No raw ranking reports found.
                    </TableCell>
                  </TableRow>
                ) : (
                  reports?.map((report) => (
                    <TableRow key={report.id} className="hover:bg-muted/50">
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {format(new Date(report.createdAt), 'MMM d, yyyy')}
                      </TableCell>
                      <TableCell className="font-medium">{report.clientName || `ID: ${report.clientId}`}</TableCell>
                      <TableCell>{report.keywordText || `ID: ${report.keywordId}`}</TableCell>
                      <TableCell>{getRankBadge(report.rankingPosition)}</TableCell>
                      <TableCell className="text-sm max-w-[300px] truncate text-muted-foreground" title={report.reasonRecommended || ''}>
                        {report.reasonRecommended || '-'}
                      </TableCell>
                      <TableCell>
                        {report.isInitialRanking ? (
                          <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">Initial</Badge>
                        ) : (
                          <Badge variant="outline" className="bg-muted text-muted-foreground">Check-in</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
