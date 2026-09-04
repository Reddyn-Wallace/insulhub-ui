import { publicAccountPassword } from "@/lib/partner/account-access-routes";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function POST(request:Request){return publicAccountPassword(request,"complete");}
