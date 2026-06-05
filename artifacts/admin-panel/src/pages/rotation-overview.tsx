import { KeywordPerformanceOverview } from "@/components/KeywordPerformanceOverview";

export default function RotationOverview() {
  return (
    <div className="flex flex-col gap-6 p-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Keyword Rotation · Overview</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Summary counts and rank distribution across all clients — last 30 days.
        </p>
      </div>
      <KeywordPerformanceOverview />
    </div>
  );
}
