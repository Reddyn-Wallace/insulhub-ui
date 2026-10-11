import { NextRequest, NextResponse } from 'next/server';
import { requireInsulhubAuth } from '@/lib/insulhub-auth';
import { ensureOverlaySchema } from '@/lib/overlay-db';
import { validExcludedCampaignIds } from '@/lib/campaign-exclusions';
import { loadCampaignExclusions, UnknownExclusionCampaignError } from '@/lib/campaign-exclusion-data';

export async function GET(request: NextRequest) {
  try {
    const unauthorized = await requireInsulhubAuth(request);
    if (unauthorized) return unauthorized;
    const ids = request.nextUrl.searchParams.getAll('campaignId');
    if (!validExcludedCampaignIds(ids)) {
      return NextResponse.json({ error: 'Choose valid campaigns to exclude' }, { status: 400 });
    }
    await ensureOverlaySchema();
    return NextResponse.json({ recipients: await loadCampaignExclusions(ids) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load exclusions' },
      { status: error instanceof UnknownExclusionCampaignError ? 400 : 500 });
  }
}
