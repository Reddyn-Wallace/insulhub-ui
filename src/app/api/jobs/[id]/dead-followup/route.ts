import {NextRequest,NextResponse} from 'next/server';
import {requireInsulhubAuth,tokenFromRequest} from '@/lib/insulhub-auth';
import {readControlJob} from '@/lib/dead-followups/access';
import {controlsRepository,emptyRecord} from '@/lib/dead-followups/repository';
import {ControlError} from '@/lib/dead-followups/controls';
const headers={'cache-control':'private, no-store'};
type Context={params:Promise<{id:string}>};
function failure(error:unknown){return NextResponse.json({error:error instanceof ControlError?error.message:'Follow-up storage is unavailable. Your change was not confirmed; refresh before retrying.'},{status:error instanceof ControlError?error.status:503,headers});}
export async function GET(request:NextRequest,context:Context){
  try{
    const unauthorized=await requireInsulhubAuth(request);if(unauthorized)return unauthorized;
    const {id}=await context.params;const {job}=await readControlJob(tokenFromRequest(request),id);
    const repo=controlsRepository();if(!repo)throw new ControlError('Follow-up storage needs setup.',503);
    const [records,events]=await Promise.all([repo.list([id]),repo.events(id)]);
    return NextResponse.json({job,record:records[id] || emptyRecord(),events,readOnly:process.env.DEAD_QUOTE_FOLLOWUPS_ENABLED!=='true'},{headers});
  }catch(error){return failure(error);}
}
export async function POST(request:NextRequest,context:Context){
  try{
    const unauthorized=await requireInsulhubAuth(request);if(unauthorized)return unauthorized;
    if(process.env.DEAD_QUOTE_FOLLOWUPS_ENABLED!=='true')throw new ControlError('Follow-up changes are not enabled.',503);
    const raw=await request.text();if(raw.length>10000)throw new ControlError('Follow-up change is too large.');
    let input;try{input=JSON.parse(raw);}catch{throw new ControlError('Invalid follow-up change.');}
    if(!input || !Number.isInteger(input.revision) || input.revision<0 || typeof input.jobVersion!=='string')throw new ControlError('Refresh the quote before saving.');
    const {id}=await context.params;const {job,actor}=await readControlJob(tokenFromRequest(request),id);
    if(input.jobVersion!==job.updatedAt)throw new ControlError('The quote changed since you opened it. Refresh and review it again.',409);
    const repo=controlsRepository();if(!repo)throw new ControlError('Follow-up storage needs setup.',503);
    const record=await repo.change(job,input.revision,input.command,actor);
    return NextResponse.json({record},{headers});
  }catch(error){return failure(error);}
}
