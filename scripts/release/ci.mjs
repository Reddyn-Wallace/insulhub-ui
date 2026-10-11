import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {checkRequiredFiles,readJson,LIVE_RELEASE_URL,RECOVERY_COMMIT} from './guard.mjs';
const contract=JSON.parse(readFileSync(new URL('./contract.json',import.meta.url),'utf8'));
checkRequiredFiles(process.cwd(),contract.tests);
const live=await readJson(LIVE_RELEASE_URL);
if(!/^[a-f0-9]{40}$/.test(live.commit||''))throw Error('Live release has no verifiable commit.');
for(const commit of new Set([RECOVERY_COMMIT,live.commit])){
 try{execFileSync('git',['merge-base','--is-ancestor',commit,'HEAD'],{stdio:'pipe'});}
 catch{throw Error(`Release must contain shipped commit ${commit}. Fetch full history and merge current master.`);}
}
console.log('Shipped release ancestry and regression coverage verified.');
