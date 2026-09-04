import { ensurePartnerSubmissionWorkerRole, getPartnerSubmissionPool } from "../src/lib/partner/db";
import { PartnerSubmissionWorkerEngine } from "../src/lib/partner/submission-worker-engine";
import { PartnerSubmissionWorkerRepository } from "../src/lib/partner/submission-worker-repository";
import { partnerLiveTestRunConfig } from "../src/lib/partner/live-test-runner-policy";

async function main(){
  const {requestId,mode}=partnerLiveTestRunConfig(process.env,process.argv.slice(2));
  const pool=getPartnerSubmissionPool();
  try{
    await ensurePartnerSubmissionWorkerRole();
    const status=async()=>{
      const value=(await pool.query<{value:Record<string,unknown>|null}>("SELECT public.partner_live_test_status($1) value",[requestId])).rows[0]?.value??null;
      if(!value)throw new Error("The submitted request was not found");
      return value;
    };
    if(mode==="status")console.log(JSON.stringify({requestId,status:await status()}));
    else{
      const engine=new PartnerSubmissionWorkerEngine(new PartnerSubmissionWorkerRepository(pool,{liveTestRequestId:requestId}),{env:process.env,deadlineMs:180_000,leaseSeconds:300,processNotifications:false});
      const result=await engine.runOnce(`live-test:${requestId}`);
      const finalStatus=await status();
      console.log(JSON.stringify({requestId,result,status:finalStatus}));
      if(result.submission!=="SUCCEEDED")process.exitCode=2;
    }
  }finally{await pool.end();}
}

void main().catch((error)=>{console.error(error instanceof Error?error.message:"The live test runner failed");process.exitCode=1;});
