import 'server-only';
import { NextResponse } from 'next/server';
export class FinanceError extends Error {
  constructor(public status:number, message:string){super(message);}
}
export function financeJson(value:unknown,status=200){return NextResponse.json(value,{status,headers:{'Cache-Control':'no-store, private','Vary':'Authorization, x-access-token'}});}
export function financeError(error:unknown){return financeJson({error:error instanceof FinanceError?error.message:'Finance service unavailable. Try again later.'},error instanceof FinanceError?error.status:503);}
export function required(name:string):string {const value=process.env[name]?.trim();if(!value)throw new FinanceError(503,'Finance connection setup is incomplete.');return value;}
export function financeOrigin(){const url=new URL(required('FINANCE_APP_ORIGIN'));if(url.protocol!=='https:' && !(process.env.NODE_ENV!=='production' && url.hostname==='localhost'))throw new FinanceError(503,'Invalid finance application origin.');return url.origin;}
export async function safeFetch(url:string,init:RequestInit={}){try{return await fetch(url,{...init,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});}catch{throw new FinanceError(503,'The source could not be reached.');}}
