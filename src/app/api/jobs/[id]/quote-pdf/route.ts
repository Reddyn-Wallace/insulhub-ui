import { NextRequest, NextResponse } from "next/server";
import { requireInsulhubAuth, tokenFromRequest } from "@/lib/insulhub-auth";
import { ControlError } from "@/lib/dead-followups/controls";
import { confirmQuotePdf } from "@/lib/quote-history/confirmation";
import { record, snapshotQuote } from "@/lib/quote-history/model";
import { validQuoteJobId } from "@/lib/quote-history/mutation";
import { quoteHistoryEnabled, quoteHistoryRepository, readQuoteHistoryJob } from "@/lib/quote-history/server";

const headers = { "cache-control": "private, no-store" };

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!quoteHistoryEnabled()) return new NextResponse(null, { status: 204, headers });
  try {
    const { id } = await context.params;
    if (!validQuoteJobId(id)) throw new ControlError("Quote not found.", 404);
    const unauthorized = await requireInsulhubAuth(request);
    if (unauthorized) return unauthorized;
    const raw = await request.text();
    if (raw.length > 2000000) throw new ControlError("Quote PDF request is too large.");
    const input = record(JSON.parse(raw));
    if (input._id !== id || input.stage !== "QUOTE" || !Object.keys(record(input.quote)).length ||
        Object.keys(input).some(key => !["_id", "stage", "quote", "sitePlanNotes"].includes(key))) {
      throw new ControlError("Invalid quote PDF request.");
    }
    const token = tokenFromRequest(request);
    const download = async () => {
      // The legacy renderer takes the token and job input in its query string.
      const params = new URLSearchParams({ token: encodeURIComponent(token), input: JSON.stringify(input) });
      const response = await fetch(`https://api.insulhub.nz/pdf/saveJobAndGetQuotePDF?${params}`, {
        cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new ControlError("Could not confirm PDF generation. Refresh the quote before trying again.", 502);
      const bytes = await response.arrayBuffer();
      if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new ControlError("InsulHub returned an invalid quote PDF.", 502);
      return bytes;
    };

    const read = () => readQuoteHistoryJob(token, id);
    const pdf = await quoteHistoryRepository().capture(id, read, download,
      async (_, before) => confirmQuotePdf(before, snapshotQuote(input), (await read()).snapshot));
    return new NextResponse(pdf, { headers: { ...headers, "content-type": "application/pdf", "content-disposition": 'inline; filename="quote.pdf"' } });
  } catch (error) {
    const reason = error instanceof ControlError ? error : new ControlError("Could not open the quote PDF. Refresh before trying again.", 503);
    return NextResponse.json({ error: reason.message }, { status: reason.status, headers });
  }
}
