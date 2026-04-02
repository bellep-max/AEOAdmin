import { useState } from "react";
import { useGetKeywords, useCreateKeyword, useUpdateKeyword } from "@workspace/api-client-react";
import { 
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow 
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Plus, Filter, CheckCircle2, XCircle, Clock } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useQueryClient } from "@tanstack/react-query";

export default function Keywords() {
  const [search, setSearch] = useState("");
  const { data: keywords, isLoading, refetch } = useGetKeywords();
  const updateKeyword = useUpdateKeyword();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleToggleActive = (id: number, isActive: boolean) => {
    updateKeyword.mutate(
      { id, data: { isActive } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['/api/keywords'] });
          toast({ title: "Keyword status updated" });
        },
        onError: () => {
          toast({ title: "Failed to update keyword", variant: "destructive" });
        }
      }
    );
  };

  const filteredKeywords = keywords?.filter(k => 
    k.keywordText.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Keywords Pool</h1>
          <p className="text-muted-foreground">Manage target search terms across all clients.</p>
        </div>
        
        <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
          <Plus className="w-4 h-4 mr-2" />
          Add Keyword
        </Button>
      </div>

      <div className="flex items-center gap-4 w-full">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search keywords..."
            className="pl-9 bg-card"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button variant="outline" size="icon">
          <Filter className="h-4 w-4" />
        </Button>
      </div>

      <div className="border rounded-md bg-card/50">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Keyword</TableHead>
              <TableHead>Client ID</TableHead>
              <TableHead>Tier</TableHead>
              <TableHead className="text-right">Total Clicks</TableHead>
              <TableHead className="text-right">30d Clicks</TableHead>
              <TableHead>Verification</TableHead>
              <TableHead className="text-right">Active</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-12 ml-auto" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-12 ml-auto" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-10 ml-auto" /></TableCell>
                </TableRow>
              ))
            ) : filteredKeywords?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  No keywords found.
                </TableCell>
              </TableRow>
            ) : (
              filteredKeywords?.map((kw) => (
                <TableRow key={kw.id} className="hover:bg-muted/50">
                  <TableCell className="font-medium text-foreground">{kw.keywordText}</TableCell>
                  <TableCell className="text-muted-foreground font-mono text-xs">{kw.clientId}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={
                      kw.tierLabel === 'aeo' ? 'bg-primary/10 text-primary border-primary/20' : 
                      kw.tierLabel === 'seo' ? 'bg-amber-500/10 text-amber-500 border-amber-500/20' :
                      'bg-purple-500/10 text-purple-500 border-purple-500/20'
                    }>
                      {kw.tierLabel.toUpperCase()}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono">{kw.clickCount}</TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">{kw.last30DaysClickCount}</TableCell>
                  <TableCell>
                    {kw.verificationStatus === 'verified' && <span className="flex items-center text-xs text-emerald-500"><CheckCircle2 className="w-3 h-3 mr-1" /> Verified</span>}
                    {kw.verificationStatus === 'failed' && <span className="flex items-center text-xs text-destructive"><XCircle className="w-3 h-3 mr-1" /> Failed</span>}
                    {kw.verificationStatus === 'pending' && <span className="flex items-center text-xs text-amber-500"><Clock className="w-3 h-3 mr-1" /> Pending</span>}
                  </TableCell>
                  <TableCell className="text-right">
                    <Switch 
                      checked={kw.isActive} 
                      onCheckedChange={(val) => handleToggleActive(kw.id, val)}
                    />
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
