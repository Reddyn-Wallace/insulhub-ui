import {existsSync, readFileSync} from 'node:fs';
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
