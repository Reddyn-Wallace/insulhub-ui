import 'server-only';
import type { NextRequest } from 'next/server';
import { FinanceError, required, safeFetch } from './errors';
export async function verifiedFinanceIdentity(request:NextRequest):Promise<{userId:string;token:string}> {
  const auth=request.headers.get('authorization');
  const token=auth?.toLowerCase().startsWith('bearer ')?auth.slice(7).trim():request.headers.get('x-access-token')||'';
  if(!token || token.length>8192 || /[\r\n]/.test(token))throw new FinanceError(401,'Sign in to Insulhub.');
  const email=required('FINANCE_OWNER_EMAIL').toLowerCase();
  const response=await safeFetch('https://api.insulhub.nz/graphql',{method:'POST',headers:{'content-type':'application/json','x-access-token':token},body:JSON.stringify({query:'query FinanceIdentity { me { _id email } }'})});
  if(response.status===401 || response.status===403)throw new FinanceError(401,'Sign in to Insulhub.');
  if(!response.ok)throw new FinanceError(503,'CRM identity verification is unavailable.');
  const result=await response.json();
  if(result.errors?.length)throw new FinanceError(401,'Could not verify your CRM session.');
  const me=result.data?.me;
  if(typeof me?._id!=='string'||!me._id||typeof me.email!=='string')throw new FinanceError(401,'Could not verify your CRM identity.');
  if(me.email.trim().toLowerCase()!==email)throw new FinanceError(403,'Finance access is restricted to the owner.');
  return {userId:me._id,token};
}
export async function requireFinanceOwner(request:NextRequest){
  const owner=required('FINANCE_OWNER_USER_ID');
  const identity=await verifiedFinanceIdentity(request);
  if(identity.userId!==owner)throw new FinanceError(403,'Finance access is restricted to the owner.');
  return identity;
}
