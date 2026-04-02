import { useGetScalingPlan } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Target, Cpu, CheckCircle2, Clock, CalendarDays } from "lucide-react";

export default function Scaling() {
  const { data: milestones, isLoading } = useGetScalingPlan();

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight text-white">Scaling Plan</h1>
        <p className="text-muted-foreground">Hardware procurement and client capacity roadmap.</p>
      </div>

      <div className="relative pl-8 md:pl-0">
        {/* Vertical line for desktop */}
        <div className="hidden md:block absolute left-1/2 top-0 bottom-0 w-px bg-border -translate-x-1/2 z-0" />
        
        {/* Vertical line for mobile */}
        <div className="md:hidden absolute left-4 top-0 bottom-0 w-px bg-border z-0" />

        <div className="space-y-8 md:space-y-12 relative z-10">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex flex-col md:flex-row gap-8 items-center w-full">
                <div className="hidden md:flex flex-1 justify-end">
                  <Skeleton className="h-32 w-full max-w-sm" />
                </div>
                <div className="w-8 h-8 rounded-full bg-muted flex shrink-0 items-center justify-center -ml-4 md:ml-0 z-10 border-4 border-background" />
                <div className="flex-1 w-full">
                  <Skeleton className="h-32 w-full max-w-sm md:hidden" />
                </div>
              </div>
            ))
          ) : (
            milestones?.map((milestone, index) => {
              const isEven = index % 2 === 0;
              const isCompleted = milestone.status === 'completed';
              const isActive = milestone.status === 'active';
              
              return (
                <div key={milestone.id} className={`flex flex-col md:flex-row gap-4 md:gap-8 items-start md:items-center w-full ${isEven ? '' : 'md:flex-row-reverse'}`}>
                  
                  {/* Content side */}
                  <div className={`flex-1 w-full ${isEven ? 'md:text-right' : 'md:text-left'} pt-2 md:pt-0`}>
                    <Card className={`w-full md:max-w-md ${isEven ? 'md:ml-auto' : 'md:mr-auto'} ${isActive ? 'border-primary/50 shadow-[0_0_15px_rgba(37,99,235,0.15)]' : 'bg-card/50'}`}>
                      <CardHeader className="pb-3">
                        <div className={`flex items-center justify-between ${isEven ? 'md:flex-row-reverse' : ''}`}>
                          <div className={`flex items-center gap-2 ${isEven ? 'md:flex-row-reverse' : ''}`}>
                            <CalendarDays className="h-4 w-4 text-muted-foreground" />
                            <CardDescription className="font-medium text-foreground">{milestone.targetDate}</CardDescription>
                          </div>
                          <Badge variant="outline" className={
                            isCompleted ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' :
                            isActive ? 'bg-primary/10 text-primary border-primary/20' :
                            'bg-muted text-muted-foreground'
                          }>
                            {milestone.status.toUpperCase()}
                          </Badge>
                        </div>
                        <CardTitle className="text-xl mt-2">{milestone.phase}</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-4 bg-muted/30 p-3 rounded-lg border">
                          <div>
                            <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                              <Target className="h-3 w-3" /> Target Clients
                            </div>
                            <div className="text-xl font-bold">{milestone.targetCompanies}</div>
                          </div>
                          <div>
                            <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                              <Cpu className="h-3 w-3" /> Devices Req.
                            </div>
                            <div className={`text-xl font-bold ${milestone.devicesAvailable < milestone.devicesNeeded ? 'text-amber-500' : 'text-emerald-500'}`}>
                              {milestone.devicesAvailable} / {milestone.devicesNeeded}
                            </div>
                          </div>
                        </div>
                        {milestone.notes && (
                          <p className="text-sm text-muted-foreground">{milestone.notes}</p>
                        )}
                      </CardContent>
                    </Card>
                  </div>

                  {/* Node icon */}
                  <div className={`w-8 h-8 rounded-full shrink-0 flex items-center justify-center -ml-[35px] md:ml-0 z-10 border-4 border-background ${
                    isCompleted ? 'bg-emerald-500' :
                    isActive ? 'bg-primary' :
                    'bg-muted border-border'
                  }`}>
                    {isCompleted ? <CheckCircle2 className="h-4 w-4 text-white" /> : 
                     isActive ? <div className="w-2 h-2 rounded-full bg-white animate-pulse" /> : 
                     <Clock className="h-4 w-4 text-muted-foreground" />}
                  </div>

                  {/* Empty spacer for alignment */}
                  <div className="hidden md:block flex-1" />
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
