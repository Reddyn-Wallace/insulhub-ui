import { NextRequest, NextResponse } from 'next/server';
import { requireInsulhubAuth, tokenFromRequest } from '@/lib/insulhub-auth';
import { loadDeadQuoteQueue } from '@/lib/dead-followups/server';
import { decorateQueue } from '@/lib/dead-followups/queue-controls';
export const maxDuration = 60;
export async function GET(request: NextRequest) {
  const headers = {'cache-control':'private, no-store'};
  try {
    const unauthorized = await requireInsulhubAuth(request);
    if (unauthorized) return unauthorized;
    return NextResponse.json(await decorateQueue(await loadDeadQuoteQueue(tokenFromRequest(request))),{headers});
  } catch {
    return NextResponse.json({error:'The full quote list could not be verified. Refresh and try again.'},{status:503,headers});
  }
}
