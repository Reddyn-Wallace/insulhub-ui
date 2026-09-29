import {NextRequest,NextResponse} from 'next/server';
import {jobSmsIdentity} from '@/lib/job-sms-access';
import {templateRepository} from '@/lib/dead-followups/template-repository';
import {ControlError} from '@/lib/dead-followups/controls';
const headers={'cache-control':'private, no-store'};
function failure(e:unknown){return NextResponse.json({error:e instanceof ControlError?e.message:'Could not load or save follow-up templates. Check access and database setup.'},{status:e instanceof ControlError?e.status:503,headers});}
export async function GET(request:NextRequest){
 try{const {me}=await jobSmsIdentity(request);const repo=templateRepository();if(!repo)throw new ControlError('Template storage needs setup.',503);const [record,events]=await Promise.all([repo.read(),repo.events()]);return NextResponse.json({record,events,canManage:me.role==='ADMIN'&&process.env.DEAD_QUOTE_FOLLOWUPS_ENABLED==='true'},{headers});}catch(e){return failure(e);}
}
export async function PATCH(request:NextRequest){
 try{
  const {me}=await jobSmsIdentity(request);if(me.role!=='ADMIN')throw new ControlError('Only an administrator can change shared templates.',403);
  if(process.env.DEAD_QUOTE_FOLLOWUPS_ENABLED!=='true')throw new ControlError('Follow-up changes are switched off.',503);
  const raw=await request.text();if(raw.length>50000)throw new ControlError('Templates are too large.');
  let input;try{input=JSON.parse(raw);}catch{throw new ControlError('Invalid templates.');}
  const repo=templateRepository();if(!repo)throw new ControlError('Template storage needs setup.',503);
  const record=await repo.save(input?.revision,input?.templates,{id:me._id,name:[me.firstname,me.lastname].filter(Boolean).join(' ')||me._id});
  return NextResponse.json({record},{headers});
 }catch(e){return failure(e);}
}
