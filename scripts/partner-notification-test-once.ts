import { ensurePartnerSubmissionWorkerRole, getPartnerSubmissionPool } from "../src/lib/partner/db";
import { productionNotificationAdapter } from "../src/lib/partner/legacy/notification";
import { PartnerSubmissionWorkerEngine } from "../src/lib/partner/submission-worker-engine";
import { PartnerSubmissionWorkerRepository } from "../src/lib/partner/submission-worker-repository";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function main(){
  const mode=process.argv[2]??"status",eventId=process.env.PARTNER_NOTIFICATION_TEST_EVENT_ID?.trim()??"";
  if(!UUID.test(eventId)||!["status","run"].includes(mode))throw new Error("Set PARTNER_NOTIFICATION_TEST_EVENT_ID to the exact completion event and use status or run");
  if(mode==="run"&&process.env.PARTNER_NOTIFICATION_TEST_CONFIRM!=="SEND_EXACTLY_ONE_EXISTING_JOB_NOTIFICATION")throw new Error("Exact notification confirmation is required");
  const pool=getPartnerSubmissionPool();
  try{
    await ensurePartnerSubmissionWorkerRole();
    const status=async()=>{const value=(await pool.query<{value:Record<string,unknown>|null}>("SELECT public.partner_notification_test_status($1) value",[eventId])).rows[0]?.value??null;if(!value)throw new Error("The exact successful completion event was not found");return value;};
    const before=await status();
    if(mode==="status"){console.log(JSON.stringify({eventId,status:before}));return;}
    if(before.state==="DELIVERED"){console.log(JSON.stringify({eventId,result:{submission:"IDLE",notification:"DELIVERED"},status:before,replayed:true}));return;}
    if(before.state!=="PENDING"&&before.state!=="FAILED")throw new Error("The exact notification is not safely sendable");
    const adapter=productionNotificationAdapter(process.env);if(!adapter)throw new Error("Production notification delivery is not configured");
    const engine=new PartnerSubmissionWorkerEngine(new PartnerSubmissionWorkerRepository(pool,{notificationEventId:eventId}),{env:process.env,deadlineMs:45_000,leaseSeconds:120,processSubmissions:false,resolveProductionNotificationAdapter:()=>adapter});
    const result=await engine.runOnce(`notification-test:${eventId}`),after=await status();
    console.log(JSON.stringify({eventId,result,status:after}));
    if(result.submission!=="IDLE"||result.notification!=="DELIVERED"||after.state!=="DELIVERED")process.exitCode=2;
  }finally{await pool.end();}
}
void main().catch(error=>{console.error(error instanceof Error?error.message:"The notification test failed");process.exitCode=1;});
