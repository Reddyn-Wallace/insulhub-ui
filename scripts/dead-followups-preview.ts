/** Local-only interactive preview. Business requests terminate here; only GET page/assets reach the local Next server. */
import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FollowupPreview,type PreviewState} from './lib/followup-preview';
import {ControlError} from '../src/lib/dead-followups/controls';
const port=3117;
const upstream='http://127.0.0.1:3116';
const statePath=join(tmpdir(),'insulhub-followup-interactive-preview.json');
let saved:PreviewState|undefined;try{saved=JSON.parse(readFileSync(statePath,'utf8'));}catch{}
let model=new FollowupPreview(saved);
function persist(){writeFileSync(statePath+'.tmp',JSON.stringify(model.state),{mode:0o600});renameSync(statePath+'.tmp',statePath);}
const csp="default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; form-action 'self'; worker-src 'none'";
function json(res:ServerResponse,value:unknown,status=200){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','content-security-policy':csp});res.end(JSON.stringify(value));}
async function body(req:IncomingMessage){let text='';for await(const part of req){text+=part;if(text.length>100000)throw new ControlError('Preview request too large.');}return text?JSON.parse(text):{};}
const bootstrap=`(()=>{localStorage.setItem('token','local-preview-only');localStorage.setItem('me',JSON.stringify({_id:'preview',firstname:'Preview',lastname:'Staff',role:'ADMIN'}));const original=window.fetch.bind(window);window.fetch=(input,init)=>{const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);if(url.origin==='https://api.insulhub.nz'&&url.pathname==='/graphql')return original('/api/preview/graphql',init);if(url.origin!==location.origin)return Promise.reject(new Error('External requests are disabled in the local preview.'));return original(input,init);};})();`;
createServer(async(req,res)=>{
 try{
  // Never serve this preview through a public Host or accept cross-origin writes.
  const host=req.headers.host||'';if(!['127.0.0.1:3117','localhost:3117'].includes(host))return json(res,{error:'Local preview only'},403);
  if(req.headers.origin&&req.headers.origin!==`http://${host}`)return json(res,{error:'Local preview only'},403);
  const url=new URL(req.url||'/',`http://${host}`);const path=url.pathname;const method=req.method||'GET';
  if(path==='/__preview/bootstrap.js'){res.writeHead(200,{'content-type':'text/javascript','cache-control':'no-store'});res.end(bootstrap);return;}
  if(path==='/api/preview/reset'&&method==='POST'){model=new FollowupPreview();persist();return json(res,{ok:true});}
  if(path==='/api/preview/graphql'&&method==='POST'){
   const input=await body(req);if(!/^\s*query\b/.test(input.query||''))throw new ControlError('Only sample reads are available here.');
   const jobs=model.queue().items.map(x=>x.job);const id=input.variables?._id;
   return json(res,{data:{me:{_id:'preview',firstname:'Preview',lastname:'Staff',role:'ADMIN'},job:jobs.find(j=>j._id===id)||jobs[0],jobs:{results:jobs,total:jobs.length},users:{results:[],total:0},listEmailLogs:{results:[],total:0}}});
  }
  if(path==='/api/dead-followups'&&method==='GET')return json(res,model.queue());
  if(path==='/api/dead-followups/templates'){
   if(method==='GET')return json(res,model.templateRead());
   if(method==='PATCH'){const result=model.templateWrite(await body(req));persist();return json(res,result);}
  }
  const match=path.match(/^\/api\/jobs\/([a-f\d]{24})\/dead-followup(\/send)?$/);
  if(match){
   const [,id,send]=match;
   if(method==='GET')return json(res,send?model.sender(id):model.history(id));
   if(method==='POST'){const input=await body(req);const result=send?model.send(id,input):model.change(id,input);persist();return json(res,result);}
  }
  // No business APIs or mutations ever go to the Next server, even unrecognised ones.
  if(path.startsWith('/api/')||!['GET','HEAD'].includes(method))return json(res,{error:'This action is unavailable in the local sample preview.'},403);
  const allowedPage=path==='/jobs'||path==='/jobs/follow-ups'||path==='/jobs/follow-ups/templates'||/^\/jobs\/[a-f\d]{24}(?:\/follow-up-history)?$/.test(path);
  const allowedAsset=path.startsWith('/_next/static/')||['/favicon.ico','/manifest.json','/manifest.webmanifest'].includes(path)||/^\/(?:icons|images)\/[a-zA-Z0-9_./-]+$/.test(path);
  if(path.includes('%')||(!allowedPage&&!allowedAsset))return json(res,{error:'This local preview covers the follow-up workflow only.'},404);
  const target=new URL(upstream);target.pathname=path;target.search=url.search;
  const response=await fetch(target,{redirect:'manual',headers:{accept:req.headers.accept||'*/*',...(req.headers.rsc?{rsc:String(req.headers.rsc)}:{})}});
  const type=response.headers.get('content-type')||'application/octet-stream';
  if(response.status>=300&&response.status<400){const location=response.headers.get('location')||'/jobs/follow-ups';if(location.startsWith('/')&&!location.startsWith('//')){res.writeHead(response.status,{location});res.end();return;}throw Error('External redirects disabled');}
  res.writeHead(response.status,{'content-type':type,'cache-control':'no-store','content-security-policy':csp});
  if(type.includes('text/html'))res.end((await response.text()).replace('<head>','<head><script src="/__preview/bootstrap.js"></script>'));
  else res.end(Buffer.from(await response.arrayBuffer()));
 }catch(error){if(!res.headersSent)json(res,{error:error instanceof ControlError?error.message:'The local preview could not complete this action.'},error instanceof ControlError?error.status:503);else res.end();}
}).listen(port,'127.0.0.1',()=>console.log(`Interactive sample preview: http://127.0.0.1:${port}/jobs/follow-ups?stage=QUOTE\nAll sends are simulated. State: ${statePath}`));
