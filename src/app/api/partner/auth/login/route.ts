import { partnerLogin } from "@/lib/partner/auth-route";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return partnerLogin(request, "partner");
}
