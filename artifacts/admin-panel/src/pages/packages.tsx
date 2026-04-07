import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Box } from "lucide-react";
import { PLAN_META } from "@/lib/plan-meta";

const PACKAGE_DETAILS: Record<string, { description: string; target: string; features: string[] }> = {
  "The AEO Suite":       { description: "The complete answer-engine optimization bundle — covers all AEO channels end-to-end.", target: "Enterprise clients",       features: ["Full AEO audit", "Multi-channel deployment", "Priority support", "Monthly reporting"] },
  "Agency Solutions":    { description: "Designed for agencies managing multiple client accounts under a single dashboard.",    target: "Marketing agencies",        features: ["Multi-client management", "White-label reports", "Bulk keyword tracking", "Team access"] },
  "Performance Tiers":   { description: "Tiered approach scaled to traffic and performance targets, growing with results.",     target: "Growth-stage businesses",   features: ["Baseline benchmarking", "Tier advancement plan", "Performance dashboards", "Quarterly reviews"] },
  "Growth Bundles":      { description: "Pre-packaged growth strategies bundled for faster deployment and measurable ROI.",     target: "SMBs scaling up",           features: ["Strategy templates", "Content bundles", "Local SEO boost", "Citation building"] },
  "Optimization Tracks": { description: "Structured optimization workflows with defined checkpoints and measurable outcomes.",  target: "Established businesses",    features: ["Workflow automation", "On-page optimization", "Technical audits", "Link health tracking"] },
  "Success Roadmaps":    { description: "Milestone-based roadmaps guiding businesses to long-term AEO dominance.",             target: "New market entrants",       features: ["90-day roadmap", "Goal milestone tracking", "Onboarding support", "Monthly check-ins"] },
};

export default function Packages() {
  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
          <Box className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Package Options</h1>
          <p className="text-sm text-muted-foreground">All available service packages offered to clients</p>
        </div>
      </div>

      {/* Table card */}
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-[200px] font-semibold">Package Name</TableHead>
              <TableHead className="font-semibold">Description</TableHead>
              <TableHead className="font-semibold">Best For</TableHead>
              <TableHead className="font-semibold">Key Features</TableHead>
              <TableHead className="text-right font-semibold">Tier</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {PLAN_META.map((pkg, index) => {
              const details = PACKAGE_DETAILS[pkg.name] ?? { description: "", target: "", features: [] };
              return (
              <TableRow
                key={pkg.name}
                className={index % 2 === 0 ? "bg-background" : "bg-muted/20"}
              >
                {/* Name — coloured pill */}
                <TableCell className="align-top py-4">
                  <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${pkg.badgeClass} whitespace-nowrap`}>
                    {pkg.name}
                  </span>
                </TableCell>

                {/* Description */}
                <TableCell className="text-sm text-muted-foreground align-top py-4 max-w-[280px]">
                  {details.description}
                </TableCell>

                {/* Best For */}
                <TableCell className="align-top py-4">
                  <span className="text-sm font-medium text-foreground">{details.target}</span>
                </TableCell>

                {/* Key Features */}
                <TableCell className="align-top py-4">
                  <div className="flex flex-wrap gap-1">
                    {details.features.map((f) => (
                      <Badge
                        key={f}
                        variant="outline"
                        className="text-xs font-normal text-muted-foreground"
                      >
                        {f}
                      </Badge>
                    ))}
                  </div>
                </TableCell>

                {/* Tier — same colour as name */}
                <TableCell className="text-right align-top py-4">
                  <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${pkg.tierClass}`}>
                    {pkg.tier}
                  </span>
                </TableCell>
              </TableRow>
            )})}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        {PLAN_META.length} packages available · Assign a package to a client via the Campaigns page
      </p>
    </div>
  );
}
