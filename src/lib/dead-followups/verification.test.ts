import {expect,it} from 'vitest';
import {validateVerification} from './verification';
import type {SendAttempt} from './sending';
const a={actorId:'sender',status:'unknown',createdAt:'2026-09-30T00:00:00Z'} as SendAttempt;
const input={confirmed:true,evidence:'Matched recipient, content, $500 discount and date in Gmail Sent.'};
it('requires explicit positive evidence from original sender or admin',()=>{expect(validateVerification(a,input,{id:'sender',name:'Sender'},'2026-09-30T00:05:00Z')).toMatchObject({actorName:'Sender',evidence:input.evidence});expect(()=>validateVerification(a,input,{id:'other',name:'Other'},'2026-09-30T00:05:00Z')).toThrow();expect(validateVerification(a,input,{id:'admin',name:'Admin',role:'ADMIN'},'2026-09-30T00:05:00Z')).toBeTruthy();});
it('does not allow not-sent declarations, empty evidence, recent or failed attempts',()=>{for(const value of [{confirmed:false,evidence:'Not found'}, {confirmed:true,evidence:''}])expect(()=>validateVerification(a,value,{id:'sender',name:'Sender'},'2026-09-30T00:05:00Z')).toThrow();expect(()=>validateVerification(a,input,{id:'sender',name:'Sender'},'2026-09-30T00:00:30Z')).toThrow();expect(()=>validateVerification({...a,status:'failed'},input,{id:'sender',name:'Sender'},'2026-09-30T00:05:00Z')).toThrow();});
