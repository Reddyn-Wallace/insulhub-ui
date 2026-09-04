"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import PartnerCompanyWizard from "./PartnerCompanyWizard";
import { PartnerCompanyManagement } from "./PartnerOpsCompanies";
import { settingsRequest, type PartnerCompanySummary } from "@/lib/partner/settings-client";

export default function PartnerCompanyPage({companyId, created, setup}: {companyId:string;created:boolean;setup?:string}) {
  const [company,setCompany] = useState<PartnerCompanySummary|null>(null);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);setError("");
    try {
      const result = await settingsRequest<{companies:PartnerCompanySummary[]}>("/api/settings/partners");
      const item = result.companies.find(company => company.id === companyId);
      if (!item) throw new Error("Company not found.");
      setCompany(item);
    } catch(caught) {setError(caught instanceof Error ? caught.message : "Company details could not be loaded.");}
    finally {setLoading(false);}
  },[companyId]);
  useEffect(() => {void load();},[load]);
  return <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6"><Link href="/jobs/settings?section=partners" className="mb-5 inline-flex min-h-11 items-center font-semibold text-[#1a3a4a] underline">Back to partner companies</Link>
    {loading ? <p role="status">Loading company…</p> : error ? <div role="alert" className="rounded-xl border border-red-200 bg-white p-4"><p>{error}</p><button onClick={() => void load()} className="min-h-11 font-semibold underline">Try again</button></div> : company ? (setup === "users" || setup === "connection") ? <PartnerCompanyWizard key={company.id+setup} initialCompany={company} step={setup}/> : <PartnerCompanyManagement key={company.id} initialCompany={company} created={created}/> : null}
  </main>;
}
