import { useRoute, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Mail } from "lucide-react";
import { CampaignEmailsCard } from "@/components/CampaignEmailsCard";
import { rawFetch } from "@/lib/period-comparison";

/* Full-page view of a campaign's sent emails. The campaign page links here —
   it shows only a clickable summary card; the list + Reply live on this page. */

interface Campaign {
  id: number;
  name: string | null;
  planType: string;
}

export default function CampaignEmails() {
  const [, params] = useRoute(
    "/clients/:clientId/businesses/:businessId/campaigns/:campaignId/emails",
  );
  const clientId = Number(params?.clientId);
  const businessId = Number(params?.businessId);
  const campaignId = Number(params?.campaignId);

  const { data: campaign } = useQuery<Campaign>({
    queryKey: ["/api/clients", clientId, "aeo-plans", campaignId],
    queryFn: async () => {
      const res = await rawFetch(
        `/api/clients/${clientId}/aeo-plans/${campaignId}`,
      );
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!clientId && !!campaignId,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href={`/clients/${clientId}/businesses/${businessId}/campaigns/${campaignId}`}
        >
          <Button variant="ghost" size="sm" className="gap-1">
            <ChevronLeft className="w-4 h-4" />
            Back to campaign
          </Button>
        </Link>
      </div>
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <Mail className="w-6 h-6 text-primary" />
        Sent Emails
        {campaign && (
          <span className="text-muted-foreground font-normal text-lg">
            — {campaign.name ?? campaign.planType}
          </span>
        )}
      </h1>
      {!!clientId && !!campaignId && (
        <CampaignEmailsCard clientId={clientId} aeoPlanId={campaignId} />
      )}
    </div>
  );
}
