import {NextRequest,NextResponse} from 'next/server';
import {requireInsulhubAuth,tokenFromRequest} from '@/lib/insulhub-auth';
import {readControlJob} from '@/lib/dead-followups/access';
import {dateRepository} from '@/lib/dead-followups/date-repository';
import {ControlError} from '@/lib/dead-followups/controls';
export async function POST(request:NextRequest,context:{params:Promise<{id:string}>}){
 try{
  const denied=await requireInsulhubAuth(request);if(denied)return denied;
  const {id}=await context.params;const token=tokenFromRequest(request);
  await readControlJob(token,id,false);
  const repo=dateRepository();if(!repo)throw new ControlError('Dead-date storage needs setup.',503);
  await repo.reconcile(id,async()=>(await readControlJob(token,id,false)).job);
  return NextResponse.json({ok:true},{headers:{'cache-control':'private, no-store'}});
 }catch(e){return NextResponse.json({error:e instanceof ControlError?e.message:'Date check could not be confirmed. Try again.'},{status:e instanceof ControlError?e.status:503});}
}
