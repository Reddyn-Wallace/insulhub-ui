"use client";
import Link from "next/link";
import { useState } from "react";
import { Users } from "./PartnerOpsCompanies";

export default function PartnerTeamManagement({companyId,companyName,currentUserId}: {companyId:string;companyName:string;currentUserId:string}) {
  const [locked,setLocked] = useState(false);
  return <>
    {locked ? <p className="mb-4 text-sm text-slate-600">Finish the current change before leaving this page.</p> : <Link href="/partner" className="mb-4 inline-flex min-h-11 items-center font-semibold text-[#1a3a4a] underline">Back to dashboard</Link>}
    <h1 className="text-2xl font-bold text-[#1a3a4a]">Manage users</h1>
    <Users companyId={companyId} companyName={companyName} currentUserId={currentUserId} partnerMode onLock={setLocked}/>
  </>;
}
