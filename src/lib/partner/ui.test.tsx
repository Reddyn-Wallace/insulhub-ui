import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/partner",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

import PartnerDashboard, { filterPartnerJobs } from "@/components/PartnerDashboard";
import PartnerDraftForm from "@/components/PartnerDraftForm";
import PartnerLoginForm, { partnerLoginErrorMessage } from "@/components/PartnerLoginForm";
import type { PartnerJobView } from "./repository";
import { calculateQuote, createQuoteDraft, PRODUCT_QUOTE_DEFAULTS } from "./quote";

const emptyQuote = createQuoteDraft(PRODUCT_QUOTE_DEFAULTS, "LOCAL-DEMO-101", "2026-08-28T00:00:00.000Z");

const job: PartnerJobView = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  clientReference: "DEMO-101",
  submissionState: "DRAFT",
  customerName: "Fictional Customer",
  customerMobile: "",
  customerEmail: "",
  siteAddress: { street: "", suburb: "Brookfield", city: "Tauranga", postcode: "" },
  leadSources: [], notes: "", revision: 0, trackingFacts: [],
  quote: emptyQuote, quoteCalculation: calculateQuote(emptyQuote),
  createdAt: "2026-08-28T00:00:00.000Z", updatedAt: "2026-08-29T00:00:00.000Z",
};

describe("partner portal UI states", () => {
  it("shows submission and saved update dates without using the status-check date", () => {
    const submitted = {...job, submissionState:"SUBMITTED" as const, submittedAt:"2026-08-30T00:00:00.000Z", updatedAt:"2026-08-31T00:00:00.000Z", linkedStatus:{checkedAt:"2026-09-02T00:00:00.000Z",ebaCompleted:false,installDate:null,jobCompleted:false}};
    const html = renderToStaticMarkup(<PartnerDashboard jobs={[submitted]} companyName="Northwind Insulation"/>);
    expect(html).toContain('Submitted <time dateTime="2026-08-30T00:00:00.000Z"');
    expect(html).toContain('Last updated <time dateTime="2026-08-31T00:00:00.000Z"');
    expect(html).not.toContain("Status checked");
    expect(html).not.toContain("2026-09-02");
    const draft = renderToStaticMarkup(<PartnerDashboard jobs={[job]} companyName="Northwind Insulation"/>);
    expect(draft).not.toContain("Submitted <time");
    expect(draft).toContain("Last updated <time");
  });

  it("shows final submitted references, safe fallbacks, and full site addresses", () => {
    const submitted = { ...job, clientReference: "DRAFT-260829A8", submissionState: "SUBMITTED" as const, finalQuoteNumber: "NW-1234", legacyJobNumber: 1234,
      siteAddress: { street: "12 Example Road", suburb: "Brookfield", city: "Tauranga", postcode: "3110" } };
    const render = (value: PartnerJobView) => renderToStaticMarkup(<PartnerDashboard jobs={[value]} companyName="Northwind Insulation" />);
    expect(render(submitted)).toContain("NW-1234");
    expect(render(submitted)).not.toContain("DRAFT-260829A8");
    expect(render(submitted)).toContain("12 Example Road, Brookfield, Tauranga, 3110");
    expect(render({ ...submitted, finalQuoteNumber: null })).toContain("Job 1234");
    const missingReference = render({ ...submitted, finalQuoteNumber: null, legacyJobNumber: null });
    expect(missingReference).toContain("Submitted job");
    expect(missingReference).not.toContain("DRAFT-260829A8");
    expect(render({ ...submitted, submissionState: "DRAFT", finalQuoteNumber: null, legacyJobNumber: null })).toContain("DRAFT-260829A8");
    expect(filterPartnerJobs([submitted], "nw-1234", "ALL")).toEqual([submitted]);
    expect(filterPartnerJobs([submitted], "1234", "ALL")).toEqual([submitted]);
    expect(filterPartnerJobs([submitted], "draft-260829a8", "ALL")).toEqual([submitted]);
  });

  it("filters dashboard jobs by customer, reference and attention state", () => {
    const attention = { ...job, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", clientReference: "DEMO-ERR", customerName: "Another Person", submissionState: "FAILED_RETRYABLE" as const };
    expect(filterPartnerJobs([job, attention], "fictional", "ALL")).toEqual([job]);
    expect(filterPartnerJobs([job, attention], "demo-err", "ALL")).toEqual([attention]);
    expect(filterPartnerJobs([job, attention], "", "NEEDS_ATTENTION")).toEqual([attention]);
  });

  it("renders dashboard milestones, filters, empty and error states semantically", () => {
    const populated = renderToStaticMarkup(<PartnerDashboard jobs={[job]} companyName="Northwind Insulation" />);
    expect(populated).toContain("Search customer or reference");
    expect(populated).toContain("Awaiting update");
    expect(populated).not.toMatch(/Invoice|Commission|Remittance/);
    expect(populated).toContain("Showing 1 of 1 jobs");
    expect(populated).toContain("aria-label=\"Company jobs\"");
    expect(populated).toContain("New quote / lead");
    expect(populated).toContain("bg-[#c04e03]");
    const submitted=renderToStaticMarkup(<PartnerDashboard jobs={[{...job,submissionState:"SUBMITTED"}]} companyName="Northwind Insulation" />);expect(submitted).toContain("View job");expect(submitted).toContain("min-h-11");
    expect(renderToStaticMarkup(<PartnerDashboard jobs={[]} companyName="Northwind Insulation" />)).toContain("No partner jobs yet");
    const error = renderToStaticMarkup(<PartnerDashboard jobs={[]} companyName="Northwind Insulation" errorMessage="Try again later." />);
    expect(error).toContain("role=\"alert\"");
    expect(error).toContain("Jobs could not be loaded");
    expect(renderToStaticMarkup(<PartnerDashboard jobs={[{ ...job, updatedAt: "not-a-timestamp" }]} companyName="Northwind Insulation" />)).toContain('Last updated <time dateTime="not-a-timestamp">Date unavailable</time>');
  });

  it("renders accessible permissive draft fields and save feedback affordances", () => {
    const create = renderToStaticMarkup(<PartnerDraftForm recoveryScope="scope-a" />);
    for (const label of ["Customer name", "Mobile", "Email", "Street address", "Suburb", "City", "Postcode", "Notes"]) expect(create).toContain(label);
    expect(create).not.toContain("required=\"\"");
    expect(create).toContain("Changes save automatically.");
    for (const quoteLabel of ["Wall insulation", "Ceiling insulation", "Council Fee", "Quote totals"]) expect(create).toContain(quoteLabel);
    expect(create).not.toContain("aria-label=\"Draft sections\"");
    expect(create).not.toContain("Your lead and quote save automatically.");
    expect(create).not.toContain("sticky bottom");
    expect(create).toContain("min-h-14");
    expect(create).toContain("Quote totals");
    const edit = renderToStaticMarkup(<PartnerDraftForm initialJob={job} recoveryScope="scope-a" />);
    expect(edit).toContain("Edit DEMO-101");
    expect(edit).not.toContain("Save changes");
  });

  it("renders local demo account choices and maps generic versus rate-limit login states", () => {
    const html = renderToStaticMarkup(<PartnerLoginForm surface="partner" demoAccounts={[{ company: "Northwind Insulation", email: "partner.demo@example.test", password: "fictional" }]} />);
    expect(html).toContain("Local demo · fictional accounts");
    expect(html).toContain("autoComplete=\"username\"");
    expect(partnerLoginErrorMessage(401)).toBe("Email or password is incorrect");
    expect(partnerLoginErrorMessage(403, "ACCOUNT_DISABLED")).toBe("Your account is disabled. Contact your administrator.");
    expect(partnerLoginErrorMessage(403)).toBe("Email or password is incorrect");
    expect(partnerLoginErrorMessage(401, "ACCOUNT_DISABLED")).toBe("Email or password is incorrect");
    expect(partnerLoginErrorMessage(429, "ACCOUNT_DISABLED")).toContain("Too many sign-in attempts");
    expect(partnerLoginErrorMessage(429)).toContain("Too many sign-in attempts");
  });
});
