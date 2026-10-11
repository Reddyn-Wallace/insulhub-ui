import {existsSync, readFileSync, readdirSync, lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
export const RECOVERY_COMMIT='15671bd4b96ce162eadfc9a6d90520e508c425ca';
export const REPOSITORY='Reddyn-Wallace/insulhub-ui';
export const LIVE_RELEASE_URL='https://insulhub-ui.vercel.app/api/release';
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
export async function readJson(url){
 const response=await fetch(url,{headers:{accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(15000),cache:'no-store'});
 // One-time compatibility with the recovery release, which predates this endpoint.
 // Every subsequent build must contain /api/release (checked after compilation).
 if(response.status===404&&url===LIVE_RELEASE_URL)return {commit:RECOVERY_COMMIT,bootstrap:true};
 if(!response.ok)throw Error(`Release verification unavailable (HTTP ${response.status}). Production is unchanged; retry later.`);
 return response.json();
}
export async function checkProductionSource(env=process.env,get=readJson){
 if(env.VERCEL_ENV!=='production')return;
 const commit=env.VERCEL_GIT_COMMIT_SHA;
 if(!sha(commit)||`${env.VERCEL_GIT_REPO_OWNER}/${env.VERCEL_GIT_REPO_SLUG}`!==REPOSITORY)throw Error('Production requires an identified Git commit from the CRM source repository. Local uploads are not releases.');
 if(env.VERCEL_GIT_COMMIT_REF!=='master')throw Error('Production releases must come from master. Merge and verify your branch first.');
 const main=await get(`https://api.github.com/repos/${REPOSITORY}/commits/master`);
 if(main.sha!==commit)throw Error('This is not the latest master commit. A newer release exists; rebuild from current master.');
 const live=await get(LIVE_RELEASE_URL);
 if(!sha(live.commit))throw Error('Cannot identify the live release; refusing to replace it.');
 if(live.commit!==commit){
  const comparison=await get(`https://api.github.com/repos/${REPOSITORY}/compare/${live.commit}...${commit}`);
  if(!['ahead','identical'].includes(comparison.status))throw Error('Candidate does not contain the live release. Merge all shipped work before releasing.');
 }
 console.log(`Release source verified: ${commit.slice(0,7)} contains live ${live.commit.slice(0,7)}.`);
}
export function checkRequiredFiles(root,files){
 const missing=files.filter(file=>!existsSync(resolve(root,file)));
 if(missing.length)throw Error(`Required CRM regression coverage is missing:\n${missing.join('\n')}`);
}
export function checkBuiltRoutes(root,routes){
 const built=JSON.parse(readFileSync(resolve(root,'.next/server/app-paths-manifest.json'),'utf8'));
 const missing=routes.filter(route=>!Object.hasOwn(built,route));
 if(missing.length)throw Error(`Shipped CRM routes are missing from the build:\n${missing.join('\n')}`);
 console.log(`Shipped route check passed (${routes.length} routes).`);
}

const sourceDirectories=['src','scripts','migrations','public','app','pages'];
const sourceFiles=['package.json','package-lock.json','next.config.ts','next.config.js','next.config.mjs','tsconfig.json','postcss.config.mjs','.vercelignore','middleware.ts','middleware.js','proxy.ts','instrumentation.ts'];
const generated=path=>path==='public/sw.js'||/^public\/workbox-[^/]+\.js$/.test(path);
const inScope=path=>!generated(path)&&(sourceFiles.includes(path)||sourceDirectories.some(dir=>path.startsWith(`${dir}/`)));
export function checkSourceTree(root,remote){
 if(remote.truncated||!Array.isArray(remote.tree))throw Error('Committed source inventory is incomplete; refusing release.');
 const expected=new Map(remote.tree.filter(item=>item.type==='blob'&&inScope(item.path)).map(item=>[item.path,item]));
 for(const [path,item] of expected){
  const file=resolve(root,path);
  if(!existsSync(file))throw Error(`Committed source file missing: ${path}`);
  if(!lstatSync(file).isFile()||!['100644','100755'].includes(item.mode))throw Error(`Unsupported source file: ${path}`);
  const contents=readFileSync(file);
  const hash=createHash('sha1').update(`blob ${contents.length}\0`).update(contents).digest('hex');
  if(hash!==item.sha)throw Error(`Uploaded source does not match committed source: ${path}`);
 }
 function visit(path){
  if(generated(path)||!existsSync(resolve(root,path)))return;
  const info=lstatSync(resolve(root,path));
  if(info.isDirectory()){for(const name of readdirSync(resolve(root,path)))visit(`${path}/${name}`);}
  else if(!expected.has(path))throw Error(`Uncommitted source file in release: ${path}`);
 }
 for(const path of [...sourceDirectories,...sourceFiles])visit(path);
 console.log(`Committed source verified (${expected.size} files).`);
}
export async function checkProductionFiles(root=process.cwd(),env=process.env,get=readJson){
 if(env.VERCEL_ENV!=='production')return;
 const tree=await get(`https://api.github.com/repos/${REPOSITORY}/git/trees/${env.VERCEL_GIT_COMMIT_SHA}?recursive=1`);
 checkSourceTree(root,tree);
 checkVercelConfig(root);
}

// Vercel normalises this file before invoking the build. Validate the effective
// command separately; application and build-script bytes still must match Git.
export function checkVercelConfig(root){
 const config=JSON.parse(readFileSync(resolve(root,'vercel.json'),'utf8'));
 if(config.buildCommand!=='node scripts/vercel-build.mjs')throw Error('Vercel configuration must retain the guarded build command.');
}
