import 'server-only';
import { overlaySql } from '@/lib/overlay-db';
import type { CampaignExclusionRecipient } from './campaign-exclusions';

export class UnknownExclusionCampaignError extends Error {}

export async function loadCampaignExclusions(campaignIds: string[]): Promise<CampaignExclusionRecipient[]> {
  if (!campaignIds.length) return [];
  // Include campaigns without sent recipients so missing/deleted campaigns are detected.
  const rows = await overlaySql`
    SELECT c.id AS campaign_id, c.channel, cr.insulhub_job_id, cr.destination
    FROM campaigns c
    LEFT JOIN campaign_recipients cr ON cr.campaign_id = c.id
      AND cr.selected = true AND cr.status = 'sent'
    WHERE c.id IN (SELECT jsonb_array_elements_text(${JSON.stringify(campaignIds)}::jsonb)::uuid)
  `;
  const found = new Set(rows.map(row => String(row.campaign_id).toLowerCase()));
  if (campaignIds.some(id => !found.has(id.toLowerCase()))) {
    throw new UnknownExclusionCampaignError('An excluded campaign no longer exists. Refresh the campaign list.');
  }
  return rows.filter(row => row.insulhub_job_id || row.destination).map(row => ({
    jobId: String(row.insulhub_job_id || ''),
    destination: String(row.destination || ''),
    channel: row.channel === 'sms' ? 'sms' : 'email',
  }));
}
