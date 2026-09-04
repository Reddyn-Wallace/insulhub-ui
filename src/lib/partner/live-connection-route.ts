import "server-only";
import {createHash} from "node:crypto";
import {NextRequest,NextResponse} from "next/server";
import {requireInsulhubAuth,tokenFromRequest} from "@/lib/insulhub-auth";
import {ensurePartnerOpsRole,getPartnerOpsPool} from "./db";
import {PartnerLiveConnectionRepository} from "./live-connection";
import {allowedPartnerOrigins,verifyMutationOrigin,verifyPartnerRequestHost,withPartnerNoStore} from "./security";

type Dependencies={verify:(request:NextRequest)=>Promise<Response|null>;repository:PartnerLiveConnectionRepository;origins:ReadonlySet<string>;ensure?:()=>Promise<void>};
const json=(body:unknown,status=200)=>withPartnerNoStore(NextResponse.json(body,{status}));
const uuid=(value:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
async function body(request:Request):Promise<unknown>{const text=await request.text();if(new TextEncoder().encode(text).length>4096)throw new Error("oversize");return JSON.parse(text);}
const inFlight=new Set<string>();

export async function partnerLiveConnectionRoute(request:Request,companyId:string,injected?:Dependencies):Promise<Response>{
  try{
    if(!uuid(companyId))return json({error:"Not found"},404);
    const origins=injected?.origins??allowedPartnerOrigins();
    if(!injected&&!verifyPartnerRequestHost(request.headers))return json({error:"Forbidden"},403);
    if(request.method!=="GET"&&!verifyMutationOrigin(request.headers,origins))return json({error:"Forbidden"},403);
    const canonical=new NextRequest(request.url,{headers:request.headers});
    const denied=await(injected?.verify??requireInsulhubAuth)(canonical);if(denied)return withPartnerNoStore(denied);
    await(injected?.ensure??ensurePartnerOpsRole)();
    const repository=injected?.repository??new PartnerLiveConnectionRepository(getPartnerOpsPool());
    if(request.method==="GET"){
      const status=await repository.status(companyId);return status?json({status}):json({error:"Not found"},404);
    }
    if(request.method!=="POST")return json({error:"Method not allowed"},405);
    if(request.headers.get("content-type")?.split(";",1)[0]!=="application/json")return json({error:"Use application/json"},415);
    const raw=await body(request);if(!raw||typeof raw!=="object"||Array.isArray(raw)||Object.keys(raw).sort().join(",")!=="email,password,revision")return json({error:"Check the connection details"},400);
    const value=raw as Record<string,unknown>;
    if(!Number.isInteger(value.revision)||Number(value.revision)<0||typeof value.email!=="string"||value.email.length>254||typeof value.password!=="string"||value.password.length<1||value.password.length>256)return json({error:"Check the connection details"},400);
    const token=tokenFromRequest(canonical);if(!token)return json({error:"Forbidden"},403);
    const attemptKey=createHash("sha256").update(`legacy-connect:${companyId}:`).update(createHash("sha256").update(token).digest()).digest("hex");
    if(!await repository.allowAttempt(attemptKey,5))return json({error:"Too many connection attempts. Wait before trying again."},429);
    if(inFlight.has(attemptKey))return json({error:"A connection check is already in progress."},409);
    inFlight.add(attemptKey);
    let result:Awaited<ReturnType<PartnerLiveConnectionRepository["connect"]>>;
    try{result=await repository.connect({companyId,revision:Number(value.revision),email:value.email,password:value.password});}
    finally{inFlight.delete(attemptKey);}
    if(result==="CONNECTED")return json({ok:true});
    if(result==="INVALID_CREDENTIALS")return json({error:"Those InsulHub login details were not accepted."},400);
    if(result==="STALE")return json({error:"Company details changed. Reload and try again."},409);
    return json({error:"InsulHub could not be reached. No connection was changed."},503);
  }catch{return json({error:"The InsulHub connection could not be changed."},503);}
}
