import { useGetPlans } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Check, Info } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Plans() {
  const { data: plans, isLoading } = useGetPlans();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1 text-center max-w-2xl mx-auto mb-10">
        <h1 className="text-3xl font-bold tracking-tight text-white">Subscription Tiers</h1>
        <p className="text-muted-foreground">Standardized AEO packages offered to local businesses.</p>
      </div>

      <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="bg-card">
              <CardHeader className="pb-4"><Skeleton className="h-8 w-1/2 mx-auto" /><Skeleton className="h-16 w-3/4 mx-auto mt-4" /></CardHeader>
              <CardContent><Skeleton className="h-64 w-full" /></CardContent>
            </Card>
          ))
        ) : (
          plans?.map((plan) => {
            const isPopular = plan.planName.toLowerCase().includes('pro') || plan.planName.toLowerCase().includes('advanced');
            
            return (
              <Card key={plan.id} className={`bg-card relative flex flex-col ${isPopular ? 'border-primary shadow-[0_0_30px_rgba(37,99,235,0.1)] scale-105 z-10' : ''}`}>
                {isPopular && (
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2">
                    <Badge className="bg-primary text-primary-foreground text-xs uppercase font-bold tracking-wider px-3 py-1">
                      Most Popular
                    </Badge>
                  </div>
                )}
                <CardHeader className="text-center pb-8 pt-8">
                  <CardTitle className="text-2xl font-bold mb-2">{plan.planName}</CardTitle>
                  <div className="flex items-end justify-center gap-1">
                    <span className="text-4xl font-black text-white">${plan.cost}</span>
                    <span className="text-muted-foreground mb-1">/mo</span>
                  </div>
                  <CardDescription className="mt-4">
                    Optimized for {plan.noOfKeywords} target keywords over {plan.numberOfDays} days.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex-1">
                  <ul className="space-y-4 text-sm">
                    <li className="flex items-center gap-3">
                      <div className="bg-emerald-500/20 p-1 rounded-full"><Check className="h-3 w-3 text-emerald-500" /></div>
                      <span className="font-medium text-foreground">{plan.noOfKeywords} Target Keywords</span>
                    </li>
                    <li className="flex items-center gap-3">
                      <div className="bg-emerald-500/20 p-1 rounded-full"><Check className="h-3 w-3 text-emerald-500" /></div>
                      <span className="text-muted-foreground"><span className="text-foreground font-medium">{plan.totalDailyClicks}</span> Total Daily Clicks</span>
                    </li>
                    <li className="flex items-center gap-3">
                      <div className="bg-emerald-500/20 p-1 rounded-full"><Check className="h-3 w-3 text-emerald-500" /></div>
                      <span className="text-muted-foreground"><span className="text-foreground font-medium">{plan.noOfClicks}</span> Clicks / Keyword</span>
                    </li>
                    {plan.aeoSearch !== undefined && (
                      <li className="flex items-center gap-3">
                        <div className="bg-emerald-500/20 p-1 rounded-full"><Check className="h-3 w-3 text-emerald-500" /></div>
                        <span className="text-muted-foreground"><span className="text-foreground font-medium">{plan.aeoSearch}</span> AEO Specific Searches</span>
                      </li>
                    )}
                    {plan.backlinkClickPercentage !== undefined && plan.backlinkClickPercentage > 0 && (
                      <li className="flex items-center gap-3">
                        <div className="bg-emerald-500/20 p-1 rounded-full"><Check className="h-3 w-3 text-emerald-500" /></div>
                        <span className="text-muted-foreground"><span className="text-foreground font-medium">{plan.backlinkClickPercentage}%</span> Backlink Navigation</span>
                      </li>
                    )}
                    {plan.radious !== undefined && plan.radious > 0 && (
                      <li className="flex items-center gap-3">
                        <div className="bg-emerald-500/20 p-1 rounded-full"><Check className="h-3 w-3 text-emerald-500" /></div>
                        <span className="text-muted-foreground"><span className="text-foreground font-medium">{plan.radious}mi</span> Search Radius</span>
                      </li>
                    )}
                  </ul>
                </CardContent>
                <CardFooter className="pt-4">
                  <Button className={`w-full ${isPopular ? 'bg-primary' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'}`}>
                    Assign to Client
                  </Button>
                </CardFooter>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
