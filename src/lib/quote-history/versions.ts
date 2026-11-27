import { fields, formatValue, quoteMoney, type QuoteChange, type QuoteSnapshot } from "./model";

type VersionLine = { label: string; amount: string };
export type QuoteVersionValues = {
  fields: Record<string, string | null>;
  extras: VersionLine[] | null;
};
export type QuoteVersion = {
  revision: number;
  latest: number;
  at: string | null;
  actor: string | null;
  observed: boolean;
  reconstructed: boolean;
  values: QuoteVersionValues | null;
};

const missing = "—";
const keyByLabel = new Map(fields.map(([key, label]) => [label, key]));
const currency = /^-?\$\d[\d,]*\.\d\d$/;

export function quoteVersionValues(snapshot: QuoteSnapshot | null): QuoteVersionValues | null {
  if (!snapshot) return null;
  const extras = (snapshot.extras ?? []) as { name: string; price: number }[];
  return {
    fields: Object.fromEntries(fields.map(([key, , format]) => [key, formatValue(snapshot[key] ?? null, format)])),
    extras: extras.map(({ name, price }) => ({
      label: name || (price < 0 ? "Discount" : "Extra charge"),
      amount: quoteMoney(price),
    })),
  };
}

export function reconstructQuoteVersion(snapshot: QuoteSnapshot | null, newestFirst: QuoteChange[][]): QuoteVersionValues {
  const result = quoteVersionValues(snapshot) ?? {
    fields: Object.fromEntries(fields.map(([key]) => [key, null])),
    extras: null,
  };
  for (const changes of newestFirst) {
    // Process charge removals before restoring any old charges so duplicate names and prices remain a multiset.
    const restored: VersionLine[] = [];
    const fieldLabels = new Set<string>();
    for (const { label, before, after } of changes) {
      const key = keyByLabel.get(label);
      const extras = result.extras;
      const extraIndex = extras?.findIndex(line => line.label === label && line.amount === after) ?? -1;
      const looksLikeExtra = (before === missing || currency.test(before)) && (after === missing || currency.test(after));
      const fieldMatches = key !== undefined && result.fields[key] === after && !fieldLabels.has(label);

      if (fieldMatches && key) {
        // Historic audit labels were shared by fields and user-entered charges.
        const ambiguous = looksLikeExtra && (extraIndex >= 0 || after === missing);
        result.fields[key] = ambiguous ? null : before;
        if (ambiguous) result.extras = null;
        fieldLabels.add(label);
      } else if (looksLikeExtra && extras && (extraIndex >= 0 || (after === missing && (!key || fieldLabels.has(label))))) {
        if (extraIndex >= 0) extras.splice(extraIndex, 1);
        if (before !== missing) restored.push({ label, amount: before });
      } else if (key && !fieldLabels.has(label)) {
        result.fields[key] = null;
        if (looksLikeExtra) result.extras = null;
      } else {
        result.extras = null;
      }
    }
    result.extras?.push(...restored);
  }
  result.extras?.sort((a, b) => a.label.localeCompare(b.label, "en-NZ") ||
    Number(a.amount.replace(/[$,]/g, "")) - Number(b.amount.replace(/[$,]/g, "")));
  return result;
}
