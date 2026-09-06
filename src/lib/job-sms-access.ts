import "server-only";
import { requireInsulhubAuth, tokenFromRequest } from "./insulhub-auth";
import type { NextRequest } from "next/server";

export async function jobSmsIdentity(request: NextRequest, jobId?: string) {
  if (await requireInsulhubAuth(request)) throw Error("Unauthorized");
  const token = tokenFromRequest(request);
  if (!token || token.length > 8192 || /[\r\n]/.test(token)) throw Error("Unauthorized");
  if (jobId && !/^[a-f\d]{24}$/i.test(jobId)) throw Error("Job not found");
  const response = await fetch("https://api.insulhub.nz/graphql", {
    method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000),
    headers: { "content-type": "application/json", "x-access-token": token },
    body: JSON.stringify({ query: jobId
      ? "query JobSmsAccess($id:ObjectId!){me{_id firstname lastname role} job(_id:$id){_id jobNumber client{contactDetails{name phoneMobile phoneSecondary}}}}"
      : "query JobSmsIdentity{me{_id firstname lastname role}}", variables: jobId ? { id: jobId } : {} }),
  });
  if (!response.ok) throw Error("Could not verify access");
  const json = await response.json();
  if (json.errors?.length || !json.data?.me?._id) throw Error("Unauthorized");
  if (jobId && json.data?.job?._id !== jobId) throw Error("Job not found");
  return json.data as { me: { _id: string; firstname: string; lastname: string; role: string }; job?: { _id: string; jobNumber: number; client?: { contactDetails?: { name?: string; phoneMobile?: string; phoneSecondary?: string } } } };
}
