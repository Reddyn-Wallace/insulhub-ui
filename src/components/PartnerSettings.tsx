"use client";
import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import PartnerOpsCompanies from "./PartnerOpsCompanies";
import { settingsRequest, type PartnerCompanySummary } from "@/lib/partner/settings-client";
import { OpsRequestError } from "@/lib/partner/operations-client";
import { useAppDialog } from "./AppDialog";

export default function PartnerSettings() {
  const [archivedNotice,setArchivedNotice]=useState(false);
  const [companies,setCompanies] = useState<PartnerCompanySummary[]>([]);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState("");
  const [signIn,setSignIn] = useState(false);
  const load=useCallback(async()=>{
    setLoading(true);setError("");setSignIn(false);
    try { const result=await settingsRequest<{companies:PartnerCompanySummary[]}>("/api/settings/partners");setCompanies(result.companies); }
    catch(error) { setError(error instanceof Error ? error.message : "Partners could not be loaded.");setSignIn(error instanceof OpsRequestError && error.status===401); }
    finally { setLoading(false); }
  },[]);
  useEffect(()=>{setArchivedNotice(new URLSearchParams(window.location.search).get("archived")==="1");void load();},[load]);
  if(loading)return <p role="status" className="rounded-xl border bg-white p-5">Loading partners…</p>;
  if(error)return <div role="alert" className="rounded-xl border border-red-200 bg-white p-5"><p>{error}</p>{signIn?<Link href="/login" className="mt-3 inline-flex min-h-11 items-center font-semibold underline">Sign in to InsulHub</Link>:<button onClick={()=>void load()} className="mt-3 min-h-11 font-semibold underline">Try again</button>}</div>;
  return <div className="grid gap-6">{archivedNotice ? <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">Company archived. Its employees are inactive.</p> : null}<PartnerOpsCompanies companies={companies}/><details className="rounded-xl border border-slate-200 bg-white p-4"><summary className="cursor-pointer font-semibold text-[#1a3a4a]">Submission notifications</summary><SubmissionNotificationSettings/></details></div>;
}

type NotificationSettings={recipientEmail:string|null;revision:number;updatedAt:string};
function SubmissionNotificationSettings(){
  const[settings,setSettings]=useState<NotificationSettings|null>(null);const[email,setEmail]=useState("");const[loading,setLoading]=useState(true);const[saving,setSaving]=useState(false);const[error,setError]=useState("");const[notice,setNotice]=useState("");
  const{confirm,dialog}=useAppDialog();
  const load=useCallback(async()=>{setLoading(true);setError("");try{const result=await settingsRequest<{settings:NotificationSettings}>("/api/settings/partners/notifications");setSettings(result.settings);setEmail(result.settings.recipientEmail??"");}catch(caught){setError(caught instanceof Error?caught.message:"Notification settings could not be loaded.");}finally{setLoading(false);}},[]);
  useEffect(()=>{void load();},[load]);
  async function save(event:FormEvent<HTMLFormElement>){event.preventDefault();if(!settings||saving)return;const value=email.trim().toLowerCase();if(!/^\S+@\S+\.\S+$/.test(value)||value.length>254){setError("Enter a valid email address.");return;}
    if(value!==settings.recipientEmail&&!await confirm({title:"Change submission notification email?",description:`New submission emails contain the customer's name, property address and quote total. They will be sent to ${value}.`,confirmLabel:"Use this email",tone:"warning"}))return;
    setSaving(true);setError("");setNotice("");try{const result=await settingsRequest<{settings:NotificationSettings}>("/api/settings/partners/notifications","PUT",{revision:settings.revision,recipientEmail:value});setSettings(result.settings);setEmail(result.settings.recipientEmail??"");setNotice("Submission notification email saved.");}catch(caught){setError(caught instanceof Error?caught.message:"The notification email could not be saved.");}finally{setSaving(false);}}
  return <section className="pt-3"><p className="mt-1 text-sm text-slate-600">A notification is sent here after a partner job has been successfully created in InsulHub.</p>
    <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"><strong>Customer information:</strong> each email includes the customer name, property address and quote total. Use an internal Insulmax mailbox only.</p>
    {loading?<p role="status" className="mt-4 text-sm text-slate-600">Loading notification settings…</p>:<form onSubmit={save} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end" noValidate><label className="grid flex-1 gap-1 text-sm font-semibold">Notification email<input type="email" autoComplete="email" maxLength={254} required disabled={saving} value={email} onChange={event=>setEmail(event.target.value)} className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 outline-none focus:border-[#e85d04] focus:ring-2 focus:ring-[#e85d04]/25"/></label><button disabled={saving||!settings} className="min-h-11 rounded-lg bg-[#1a3a4a] px-4 font-semibold text-white disabled:opacity-60">{saving?"Saving…":"Save email"}</button></form>}
    {error?<p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>:null}{notice?<p role="status" className="mt-3 text-sm font-semibold text-emerald-800">{notice}</p>:null}{dialog}
  </section>;
}
