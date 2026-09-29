'use client';
import {use} from 'react';
import Link from 'next/link';
import FollowupSender from '@/components/FollowupSender';
export default function FollowupHistory({params}:{params:Promise<{id:string}>}){
 const {id}=use(params);
 return <main className="mx-auto max-w-3xl space-y-5 p-5"><Link href={`/jobs/${encodeURIComponent(id)}`} className="text-sm underline">← Back to job</Link><h1 className="text-2xl font-semibold">Follow-up send history</h1><p className="text-sm text-slate-600">Check saved sends and retry pending job notes, including after a quote has moved out of Dead.</p><FollowupSender item={{job:{_id:id,stage:'UNKNOWN'},eligibility:{state:'review',reason:'History view only'},suggestion:null,earliestFirstApproach:null,sendEnabled:false}} readOnly onChanged={()=>window.location.reload()} onAccessLost={()=>window.location.assign('/login')}/></main>;
}
