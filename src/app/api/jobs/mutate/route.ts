import {NextRequest,NextResponse} from 'next/server';
import {requireInsulhubAuth,tokenFromRequest} from '@/lib/insulhub-auth';
import {isTrackedMutation} from '@/lib/dead-followups/dates';
import {dateRepository,datesEnabled} from '@/lib/dead-followups/date-repository';
import {readControlJob} from '@/lib/dead-followups/access';
import {ControlError} from '@/lib/dead-followups/controls';
const headers={'cache-control':'private, no-store'};
export async function POST(request:NextRequest){
 try{
  const unauthorized=await requireInsulhubAuth(request);if(unauthorized)return unauthorized;
  const raw=await request.text();if(raw.length>2000000)throw new ControlError('Job update is too large.');
  const payload=JSON.parse(raw);if(typeof payload.query!=='string')throw new ControlError('Invalid job update.');
  const id=isTrackedMutation(payload.query,payload.variables);if(!id||!/^[a-f\d]{24}$/i.test(id))throw new ControlError('Invalid job update.');
  const token=tokenFromRequest(request);
  const dispatch=async()=>{
   const response=await fetch('https://api.insulhub.nz/graphql',{method:'POST',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(30000),headers:{'content-type':'application/json','x-access-token':token},body:raw});
   if(!response.ok)throw new ControlError('Job save could not be confirmed. Refresh before retrying.',503);
   return response.json();
  };
  if(!datesEnabled())return NextResponse.json(await dispatch(),{headers});
  const current=await readControlJob(token,id,false);
  if(current.job.stage!=='QUOTE'&&payload.variables?.input?.stage!=='QUOTE')return NextResponse.json(await dispatch(),{headers});
  const repo=dateRepository();if(!repo)throw new ControlError('Dead-date storage needs setup. The job was not changed.',503);
  const {actor}=current;
  const read=async()=>(await readControlJob(token,id,false)).job;
  return NextResponse.json(await repo.capture(id,read,dispatch,read,actor),{headers});
 }catch(error){return NextResponse.json({errors:[{message:error instanceof ControlError?error.message:'Job save could not be confirmed. Refresh before retrying.'}]},{status:error instanceof ControlError?error.status:503,headers});}
}
