import { campaignOpenLabels, type CampaignOpenStatus } from "@/lib/campaign-open-tracking";

export default function EmailOpenBadge({ status }: { status: CampaignOpenStatus }) {
  const colour = status === "opened" ? "bg-emerald-50 text-emerald-800" : "bg-orange-50 text-orange-800";
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${colour}`}>
      {campaignOpenLabels[status]}
    </span>
  );
}
