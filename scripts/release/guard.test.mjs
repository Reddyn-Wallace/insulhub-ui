import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {checkProductionSource, checkBuiltRoutes, checkRequiredFiles} from './guard.mjs';
const candidate='b'.repeat(40), live='a'.repeat(40);
const env={VERCEL_ENV:'production',VERCEL_GIT_COMMIT_REF:'master',VERCEL_GIT_COMMIT_SHA:candidate,VERCEL_GIT_REPO_OWNER:'Reddyn-Wallace',VERCEL_GIT_REPO_SLUG:'insulhub-ui'};
function reader({head=candidate,release={commit:live},comparison='ahead',offline=false}={}){return async url=>{if(offline)throw Error('Offline');if(url.endsWith('/api/release'))return release;if(url.includes('/compare/'))return {status:comparison};return {sha:head};};}
test('accepts a committed mainline release containing live production',async()=>{await checkProductionSource(env,reader());});
test('rejects old feature branches even if they build successfully',async()=>{await assert.rejects(checkProductionSource({...env,VERCEL_GIT_COMMIT_REF:'codex/old'},reader()),/master/);});
test('rejects unidentified or wrong repository source',async()=>{for(const patch of [{VERCEL_GIT_COMMIT_SHA:''},{VERCEL_GIT_REPO_SLUG:'other'}])await assert.rejects(checkProductionSource({...env,...patch},reader()),/source|commit/i);});
test('rejects a superseded master commit',async()=>{await assert.rejects(checkProductionSource(env,reader({head:'c'.repeat(40)})),/latest/);});
test('rejects a release missing commits already live',async()=>{for(const comparison of ['behind','diverged','unknown'])await assert.rejects(checkProductionSource(env,reader({comparison})),/live release/);});
test('fails closed when source or live release cannot be verified',async()=>{await assert.rejects(checkProductionSource(env,reader({offline:true})),/Offline/);await assert.rejects(checkProductionSource(env,reader({release:{commit:null}})),/live release/);});
test('allows rebuilding the exact live commit',async()=>{await checkProductionSource(env,reader({release:{commit:candidate}}));});
test('preview builds do not require production source access',async()=>{await checkProductionSource({VERCEL_ENV:'preview'},()=>{throw Error('Must not query');});});
test('blocks a build where a shipped page or API route disappeared',()=>{const dir=mkdtempSync(join(tmpdir(),'crm-route-gate-'));try{mkdirSync(join(dir,'.next/server'),{recursive:true});writeFileSync(join(dir,'.next/server/app-paths-manifest.json'),JSON.stringify({'/jobs/follow-ups/page':'present'}));assert.throws(()=>checkBuiltRoutes(dir,['/jobs/follow-ups/page','/api/dead-followups/route']),/api\/dead-followups/);checkBuiltRoutes(dir,['/jobs/follow-ups/page']);}finally{rmSync(dir,{recursive:true,force:true});}});
test('blocks deleting a required regression suite instead of running it',()=>{const dir=mkdtempSync(join(tmpdir(),'crm-files-gate-'));try{assert.throws(()=>checkRequiredFiles(dir,['followup.test.ts']),/followup.test.ts/);writeFileSync(join(dir,'followup.test.ts'),'test');checkRequiredFiles(dir,['followup.test.ts']);}finally{rmSync(dir,{recursive:true,force:true});}});

test('uploaded source must match the committed tree, including deleted and extra files',async()=>{
 const {checkSourceTree}=await import('./guard.mjs');
 const dir=mkdtempSync(join(tmpdir(),'crm-source-gate-'));
 const tree={truncated:false,tree:[{path:'src/page.ts',type:'blob',mode:'100644',sha:'ce013625030ba8dba906f756967f9e9ca394464a'}]};
 try{
  mkdirSync(join(dir,'src'));writeFileSync(join(dir,'src/page.ts'),'hello\n');
  checkSourceTree(dir,tree);
  writeFileSync(join(dir,'src/page.ts'),'different\n');assert.throws(()=>checkSourceTree(dir,tree),/source.*match/i);
  rmSync(join(dir,'src/page.ts'));assert.throws(()=>checkSourceTree(dir,tree),/missing/i);
  writeFileSync(join(dir,'src/page.ts'),'hello\n');writeFileSync(join(dir,'src/uncommitted.ts'),'extra');assert.throws(()=>checkSourceTree(dir,tree),/uncommitted/i);
  assert.throws(()=>checkSourceTree(dir,{...tree,truncated:true}),/incomplete/i);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('platform-normalised Vercel config retains the guarded build command',async()=>{
 const {checkVercelConfig}=await import('./guard.mjs');
 const dir=mkdtempSync(join(tmpdir(),'crm-vercel-config-'));
 try{
  writeFileSync(join(dir,'vercel.json'),JSON.stringify({buildCommand:'node scripts/vercel-build.mjs'}));checkVercelConfig(dir);
  writeFileSync(join(dir,'vercel.json'),JSON.stringify({buildCommand:'npm run build'}));assert.throws(()=>checkVercelConfig(dir),/guarded build/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('a missing live provenance endpoint blocks release instead of falling back',async t=>{
 const {readJson,LIVE_RELEASE_URL}=await import('./guard.mjs');
 t.mock.method(globalThis,'fetch',async()=>({status:404,ok:false}));
 await assert.rejects(readJson(LIVE_RELEASE_URL),/HTTP 404/);
});
