import PartnerCompanyPage from "@/components/PartnerCompanyPage";

export default async function CompanyPage({params, searchParams}: {params: Promise<{companyId:string}>; searchParams: Promise<{created?:string;setup?:string}>}) {
  const {companyId} = await params;
  const {created,setup} = await searchParams;
  return <PartnerCompanyPage key={`${companyId}:${setup ?? "manage"}`} companyId={companyId} created={created === "1"} setup={setup}/>;
}
