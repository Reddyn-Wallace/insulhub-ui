import {ControlError} from './controls';
import type {SendAttempt} from './sending';
export type Verification={actorId:string;actorName:string;evidence:string;verifiedAt:string};
export type Verifier={id:string;name:string;role?:string};
export function validateVerification(attempt:SendAttempt,input:unknown,actor:Verifier,now:string):Verification{
 if(actor.id!==attempt.actorId&&actor.role!=='ADMIN')throw new ControlError('Only the original sender or an administrator can verify this send.',403);
 if(!['sending','accepted','unknown'].includes(attempt.status))throw new ControlError('This attempt is already resolved. Refresh its history.',409);
 if(!Number.isFinite(Date.parse(attempt.createdAt))||Date.parse(now)-Date.parse(attempt.createdAt)<60000)throw new ControlError('Allow the sending request to finish, then check its status first.',409);
 const value=input as {confirmed?:unknown;evidence?:unknown}|null;
 if(value?.confirmed!==true||typeof value.evidence!=='string'||value.evidence.trim().length<20||value.evidence.length>2000||value.evidence.includes('\0'))throw new ControlError('Confirm the message was actually sent and provide detailed evidence (20–2,000 characters).');
 return {actorId:actor.id,actorName:actor.name,evidence:value.evidence.trim(),verifiedAt:now};
}
