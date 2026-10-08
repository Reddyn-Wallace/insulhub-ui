import type { NextRequest } from "next/server";
import { requireFinanceOwner } from "@/lib/finance/access";
import { financeError, financeJson, FinanceError } from "@/lib/finance/errors";
import {
  listXeroOrganisations,
  selectXeroOrganisation,
} from "@/lib/finance/xero-oauth";
export async function GET(request: NextRequest) {
  try {
    const owner = await requireFinanceOwner(request);
    return financeJson({
      organisations: await listXeroOrganisations(owner.userId),
    });
  } catch (error) {
    return financeError(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    const owner = await requireFinanceOwner(request);
    const body = await request.json();
    if (typeof body.tenantId !== "string" || body.tenantId.length > 100)
      throw new FinanceError(400, "Select a valid organisation.");
    await selectXeroOrganisation(owner.userId, body.tenantId);
    return financeJson({ selected: true });
  } catch (error) {
    return financeError(error);
  }
}
