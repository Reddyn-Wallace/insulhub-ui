import 'server-only';
import {loadFinanceInputs} from './live-data';
import type {FinanceInputs} from './model';
// Short-lived server memory only. Every request still verifies its CRM owner.
const cache = new Map<string,{expires:number;input:FinanceInputs}>();
const pending = new Map<string,Promise<FinanceInputs>>();
export function clearDashboardInputs(){cache.clear();pending.clear();}
export async function dashboardInputs(owner:{userId:string;token:string},bankCheck=false,force=false){
 const key=owner.userId+':'+(bankCheck?'bank':'overview');
 const saved=cache.get(key);
 if(!force && saved && saved.expires>Date.now()) return saved.input;
 const running=pending.get(key);if(running)return running;
 const promise=loadFinanceInputs(owner,bankCheck).then(input=>{if(cache.size>10)cache.clear();cache.set(key,{input,expires:Date.now()+60000});return input;}).finally(()=>pending.delete(key));
 pending.set(key,promise);return promise;
}
