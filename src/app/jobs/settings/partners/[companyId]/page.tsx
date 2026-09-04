import PartnerCompanyPage from "@/components/PartnerCompanyPage";

export default async function CompanyPage({params, searchParams}: {params: Promise<{companyId:string}>; searchParams: Promise<{created?:string}>}) {
  const {companyId} = await params;
  const {created} = await searchParams;
  return <PartnerCompanyPage companyId={companyId} created={created === "1"}/>;
}
