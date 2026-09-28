import { expect, it } from "vitest";
import { linkInvoices } from "./linking";
const job = (id: string, quote = "AP28968") => ({
  id,
  number: "28968",
  quote,
  status: "JOB_NOT_STARTED_YET",
  archived: false,
  name: "Test job",
  invoiceNumbers: [],
});
const invoice = (reference = "AP28968") => ({
  id: "i1",
  number: "INV-0426",
  reference,
});
it("links unique exact quote and canonical job-ID references", () => {
  expect(linkInvoices([invoice()], [job("j1")], []).get("i1")).toMatchObject({
    jobId: "j1",
    method: "quote reference",
  });
  expect(
    linkInvoices([invoice("j1")], [job("j1")], []).get("i1"),
  ).toMatchObject({ jobId: "j1" });
});
it("rejects duplicate quote references and conflicting direct/reference evidence", () => {
  expect(
    linkInvoices([invoice()], [job("j1"), job("j2")], []).get("i1")?.jobId,
  ).toBeNull();
  expect(
    linkInvoices(
      [invoice()],
      [job("j1"), { ...job("j2", "BW1"), invoiceNumbers: ["INV-0426"] }],
      [],
    ).get("i1")?.jobId,
  ).toBeNull();
});
it("never infers a job from a bare number, customer name or partial quote substring", () => {
  for (const ref of ["28968", "Test job", "AP289680"])
    expect(
      linkInvoices([invoice(ref)], [job("j1")], []).get("i1")?.jobId,
    ).toBeNull();
});
it("retains archived jobs and uses direct invoice-number links", () => {
  expect(
    linkInvoices(
      [invoice("")],
      [{ ...job("j1"), archived: true, invoiceNumbers: ["INV-0426"] }],
      [],
    ).get("i1")?.jobId,
  ).toBe("j1");
});
it("recognises the observed Xero quote and deposit labels without fuzzy matching", () => {
  for (const ref of ["Quote #AP28968", "AP28968 (deposit)", " quote #ap28968 "])
    expect(linkInvoices([invoice(ref)], [job("j1")], []).get("i1")?.jobId).toBe("j1");
  for (const ref of ["AP28968 and BW123", "Quote #AP289680", "AP28968 (deposit) extra", "Quote #AP28968 / BW123"])
    expect(linkInvoices([invoice(ref)], [job("j1")], []).get("i1")?.jobId).toBeNull();
  expect(linkInvoices([invoice("Quote #AP28968")], [job("j1"), job("j2")], []).get("i1")?.jobId).toBeNull();
});
it('normalises other observed whole quote labels and preserves revision suffixes',()=>{for(const ref of ['#AP28968 (deposit)','Quote AP28968','Quote#AP28968','Deposit #AP28968','#AP28968'])expect(linkInvoices([invoice(ref)],[job('j1')],[]).get('i1')?.jobId).toBe('j1');expect(linkInvoices([invoice('Quote #AP28968-2')],[job('j1')],[]).get('i1')?.jobId).toBeNull();expect(linkInvoices([invoice('Quote #AP28968-2')],[job('j2','AP28968-2')],[]).get('i1')?.jobId).toBe('j2');});
