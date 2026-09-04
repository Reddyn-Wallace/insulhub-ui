import "server-only";
import { tokenFromRequest } from "@/lib/insulhub-auth";
import type { NextRequest } from "next/server";

/** Call only after requireInsulhubAuth has verified this token upstream. */
export async function verifiedNoteAuthor(request: NextRequest): Promise<{authorName:string;legacyActorId:string}> {
  const token=tokenFromRequest(request);
  let id:unknown;
  try{id=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8'))._id;}catch{throw Error("Author unavailable");}
  if(typeof id!=="string"||!/^[a-f0-9]{24}$/i.test(id))throw Error("Author unavailable");
  const response=await fetch("https://api.insulhub.nz/graphql",{method:"POST",redirect:"error",cache:"no-store",signal:AbortSignal.timeout(8000),headers:{"content-type":"application/json","x-access-token":token},body:JSON.stringify({query:"query PartnerNoteAuthor { users { results { _id firstname lastname } } }"})});
  if(!response.ok)throw Error("Author unavailable");
  const body=await response.json();
  if(body.errors?.length||!Array.isArray(body.data?.users?.results))throw Error("Author unavailable");
  const user=body.data.users.results.find((candidate:{_id?:unknown})=>candidate?._id===id);
  const name=[user?.firstname,user?.lastname].filter(value=>typeof value==='string').join(' ').trim();
  if(!name||name.length>200||/[\u0000-\u001f]/.test(name))throw Error("Author unavailable");
  return {authorName:name,legacyActorId:id.toLowerCase()};
}
