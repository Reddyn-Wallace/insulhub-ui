import "server-only";
import { calculateQuote, type QuoteDraft } from "./quote";

/**
 * Adapter-shaped, local-only mapping for a later verified legacy integration.
 * It deliberately makes no network request and never claims a legacy job number.
 */
export function mapQuoteToLegacyAdapterShape(quote: QuoteDraft) {
  const calculation = calculateQuote(quote);
  const dollars = (cents: number | null) => cents === null ? null : cents / 100;
  return {
    quoteNumber: quote.quoteNumber,
    date: quote.quoteDate,
    wall: quote.wall.enabled ? {
      SQMPrice: dollars(quote.wall.rateCentsPerSqm),
      SQM: quote.wall.areaSqm,
      cavityDepthMeters: quote.wall.cavityDepthCm === null ? null : quote.wall.cavityDepthCm / 100,
      c_RValue: calculation.wall.rValue,
      c_bagCount: calculation.wall.bags,
    } : null,
    ceiling: quote.ceiling.enabled ? {
      SQMPrice: dollars(quote.ceiling.rateCentsPerSqm),
      SQM: quote.ceiling.areaSqm,
      RValue: quote.ceiling.rValue,
      downlights: quote.ceiling.downlights,
      c_thickness: calculation.ceiling.thicknessMm,
      c_bagCount: calculation.ceiling.bags,
    } : null,
    extras: quote.extras.map((extra) => ({ name: extra.name, price: dollars(extra.priceCents) })),
    quoteNote: quote.comments,
    consentFee: dollars(quote.consentFeeCents),
    depositPercentage: quote.depositBasisPoints === null ? null : quote.depositBasisPoints / 100,
    c_contractPrice: dollars(calculation.contractCents),
    c_gst: dollars(calculation.gstCents),
    c_total: dollars(calculation.totalCents),
    c_deposit: dollars(calculation.depositCents),
    quoteResultNote: "",
  };
}
