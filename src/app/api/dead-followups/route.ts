import { NextRequest, NextResponse } from 'next/server';
import { requireInsulhubAuth, tokenFromRequest } from '@/lib/insulhub-auth';
import { loadDeadQuoteQueue, loadFollowupCards, quoteQueueItem } from '@/lib/dead-followups/server';
import { readFollowupDetail } from '@/lib/dead-followups/access';
import { ControlError } from '@/lib/dead-followups/controls';
import { quoteInCohort } from '@/lib/dead-followups/dates';
import { classifyQuote } from '@/lib/dead-followups/rules';
import { needsFollowup } from '@/lib/dead-followups/queue-view';
import { decorateQueue } from '@/lib/dead-followups/queue-controls';
export const maxDuration = 60;
export async function GET(request: NextRequest) {
  const timings: string[] = [];
  const headers = () => ({'cache-control':'private, no-store','server-timing':timings.join(', ')});
  async function timed<T>(name: string, read: () => Promise<T>): Promise<T> {
    const start=performance.now();
    try {
      return await read();
    } finally {
      timings.push(`${name};dur=${(performance.now()-start).toFixed(1)}`);
    }
  }
  try {
    const unauthorized = await timed('auth',()=>requireInsulhubAuth(request));
    if (unauthorized) return unauthorized;
    const token=tokenFromRequest(request);
    const checkedAt=new Date().toISOString();
    const id=request.nextUrl.searchParams.get('jobId');
    if(id!==null){
      const {job}=await timed('quote',()=>readFollowupDetail(token,id));
      if(classifyQuote(job)!=='dead'||!quoteInCohort(job)){
        throw new ControlError('This quote is no longer ready for follow-up. Refresh the queue.',409);
      }
      const detail=await timed('history',()=>decorateQueue({items:[quoteQueueItem(job,checkedAt)],checkedAt,readOnly:true,historyAvailable:false},false));
      if(!needsFollowup(detail.items[0],checkedAt))throw new ControlError('This quote is no longer ready for follow-up. Refresh the queue.',409);
      return NextResponse.json(detail,{headers:headers()});
    }
    const indexOnly=request.nextUrl.searchParams.get('view')==='queue';
    const index=await timed('index',()=>loadDeadQuoteQueue(token,checkedAt,indexOnly));
    const queue=await timed('history',()=>decorateQueue(index));
    if(!indexOnly)return NextResponse.json(queue,{headers:headers()});
    const items=await timed('cards',()=>loadFollowupCards(token,queue.items.filter(item=>needsFollowup(item,checkedAt))));
    return NextResponse.json({...queue,items,detailsDeferred:true},{headers:headers()});
  } catch(error) {
    if(error instanceof ControlError && [401,403,404,409].includes(error.status)){
      return NextResponse.json({error:error.message},{status:error.status,headers:headers()});
    }
    return NextResponse.json({error:'The full quote list could not be verified. Refresh and try again.'},{status:503,headers:headers()});
  }
}
