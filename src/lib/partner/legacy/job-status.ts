import "server-only";
import { JobLinkError, parseJobIdentifier, type JobLinkTarget } from "../job-link";

const ENDPOINT = "https://api.insulhub.nz/graphql";
// Only fields already used by InsulHub's JOB_QUERY/JOBS_QUERY. No mutations.
const DETAILS = `query PartnerLinkJob($id:ObjectId!){job(_id:$id){_id jobNumber stage archivedAt ebaForm{complete} installation{installDate} client{contactDetails{name streetAddress suburb city postCode}}}}`;
const FIND = `query PartnerLinkFind($search:String!,$skip:Int!,$limit:Int!){jobs(search:$search,skip:$skip,limit:$limit){total results{_id jobNumber}}}`;
const object = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
const field = (v: unknown, max = 300): string => {
  if (v == null) return "";
  if (typeof v !== "string" || v.length > max || /[\u0000-\u001f]/.test(v)) throw new JobLinkError("UNAVAILABLE", 503);
  return v.trim();
};
export function parseLinkedJob(value: unknown, checkedAt = new Date().toISOString(), allowArchived = false): JobLinkTarget {
  const job = object(value);
  if (!job) throw new JobLinkError("NOT_FOUND", 404);
  if (typeof job._id !== "string" || !/^[a-f0-9]{24}$/i.test(job._id) || !Number.isSafeInteger(job.jobNumber) || Number(job.jobNumber) <= 0 || (job.archivedAt && !allowArchived)) throw new JobLinkError("UNAVAILABLE", 503);
  const contact = object(object(job.client)?.contactDetails);
  if (!contact) throw new JobLinkError("UNAVAILABLE", 503);
  const customerName = field(contact.name);
  const address = { street: field(contact.streetAddress), suburb: field(contact.suburb), city: field(contact.city), postcode: field(contact.postCode, 20) };
  if (!customerName || !address.street) throw new JobLinkError("UNAVAILABLE", 503);
  const date = object(job.installation)?.installDate;
  let installDate: string | null = null;
  if (date != null) {
    const parsed = new Date(typeof date === "string" && /^\d{13}$/.test(date) ? Number(date) : date as string);
    if ((typeof date !== "string" && typeof date !== "number") || !Number.isFinite(parsed.getTime())) throw new JobLinkError("UNAVAILABLE", 503);
    installDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland", year: "numeric", month: "2-digit", day: "2-digit" }).format(parsed);
  }
  const completed = object(job.ebaForm)?.complete;
  const stage = ["LEAD","QUOTE","SCHEDULED","INSTALLATION","INVOICE","COMPLETED"].includes(String(job.stage)) ? job.stage : null;
  return { id: job._id.toLowerCase(), jobNumber: Number(job.jobNumber), customerName, address,
    status: { ebaCompleted: typeof completed === "boolean" ? completed : null, installDate, jobCompleted: stage === null ? null : stage === "COMPLETED", checkedAt } };
}
export class LegacyJobStatusReader {
  constructor(private readonly token: string, private readonly send: typeof fetch = fetch) {}
  private async query(query: string, variables: Record<string, unknown>) {
    if (!this.token || this.token.length > 8192 || /[\r\n]/.test(this.token)) throw new JobLinkError("UNAVAILABLE", 503);
    try {
      const response = await this.send(ENDPOINT, { method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8000),
        headers: { "content-type": "application/json", "x-access-token": this.token }, body: JSON.stringify({ query, variables }) });
      if (!response.ok) throw new Error("upstream");
      const body = await response.json();
      if (body.errors?.length || !object(body.data)) throw new Error("upstream");
      return body.data as Record<string, unknown>;
    } catch { throw new JobLinkError("UNAVAILABLE", 503); }
  }
  async read(identifier: string, options: {allowArchived?: boolean} = {}): Promise<JobLinkTarget> {
    const parsed = parseJobIdentifier(identifier);
    let id: string;
    if ("id" in parsed) id = parsed.id;
    else {
      // Never select an approximate search match or silently truncate results.
      const matches: string[] = [];
      let complete = false;
      for (let skip = 0; skip < 500; skip += 100) {
        const result = object((await this.query(FIND, { search: String(parsed.number), skip, limit: 100 })).jobs);
        if (!result || !Array.isArray(result.results) || !Number.isSafeInteger(result.total) || Number(result.total) < 0) throw new JobLinkError("UNAVAILABLE", 503);
        for (const row of result.results) {
          const candidate = object(row);
          if (candidate?.jobNumber === parsed.number && typeof candidate._id === "string" && /^[a-f0-9]{24}$/i.test(candidate._id)) matches.push(candidate._id.toLowerCase());
        }
        if (skip + result.results.length >= Number(result.total)) { complete = true; break; }
        if (result.results.length === 0) break;
      }
      if (!complete) throw new JobLinkError("INVALID", 400); // Use the exact link/ID.
      if (matches.length !== 1) throw new JobLinkError("NOT_FOUND", 404);
      id = matches[0];
    }
    const result = parseLinkedJob((await this.query(DETAILS, { id })).job, undefined, options.allowArchived === true);
    if (result.id !== id || ("number" in parsed && result.jobNumber !== parsed.number)) throw new JobLinkError("UNAVAILABLE", 503);
    return result;
  }
}
