"use client";
import Link from "next/link";
import {useState} from "react";
import {useRouter} from "next/navigation";
import {blankCompany,CompanyForm,LegacyConnection,Users,type CompanyDraft} from "./PartnerOpsCompanies";
import {opsButtonClass} from "@/lib/partner/operations-client";

export default function PartnerCompanyWizard({initialCompany,step="company"}: {initialCompany?:CompanyDraft;step?:"company"|"users"|"connection"}) {
  const router=useRouter();
  const [company,setCompany]=useState<CompanyDraft>(()=>initialCompany??blankCompany());
  const [locked,setLocked]=useState(false);
  const steps=["Company","First user","InsulHub connection"];
  const index=step==="company"?0:step==="users"?1:2;
  const continueToConnection=()=>router.replace(`/jobs/settings/partners/${company.id}?setup=connection`);
  return <section className="mx-auto max-w-3xl">
    <h1 className="text-2xl font-bold text-[#1a3a4a]">{company.id ? `Set up ${company.name}` : "Add company"}</h1>
    <ol aria-label="Company setup progress" className="my-5 grid grid-cols-3 gap-2">{steps.map((label,i)=><li key={label} aria-current={i===index?"step":undefined} className={`rounded-lg border px-3 py-2 text-sm ${i===index?"border-[#1a3a4a] bg-[#1a3a4a] font-semibold text-white":"border-slate-200 bg-white text-slate-500"}`}><span className="block text-xs">Step {i+1}</span>{label}</li>)}</ol>
    {step==="company" ? <CompanyForm company={company} onLock={setLocked} close={()=>router.push("/jobs/settings?section=partners")} onSaved={saved=>router.replace(`/jobs/settings/partners/${saved.id}?setup=users`)} submitLabel="Create company and continue" disabled={locked}/> : step==="users" ? <>
      <p className="text-sm text-slate-600">Company created. Invite the first Admin to manage their team, or choose Sales for job access only.</p>
      <Users companyId={company.id} companyName={company.name} onLock={setLocked} initiallyAdding initialRole="ADMIN" onCreated={continueToConnection}/>
      <button type="button" disabled={locked} onClick={continueToConnection} className="mt-4 min-h-11 font-semibold text-[#1a3a4a] underline">Skip user setup for now</button>
    </> : <>
      <p className="text-sm text-slate-600">Connect this company’s InsulHub account so submitted jobs go to the right place. You can also do this later from Edit company.</p>
      <LegacyConnection company={company} onLock={setLocked} onUpdated={setCompany} disabled={locked}/>
      <button type="button" disabled={locked} onClick={()=>router.replace(`/jobs/settings/partners/${company.id}`)} className={opsButtonClass+" mt-5"}>Finish setup</button>
    </>}
    {step!=="company"&&!locked?<p className="mt-4 text-sm text-slate-500">Progress is saved. <Link href={`/jobs/settings/partners/${company.id}`} className="underline">Leave setup</Link></p>:null}
  </section>;
}
