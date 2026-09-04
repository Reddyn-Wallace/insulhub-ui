type SummaryIssue = { path: string; message: string; simple: boolean };
const concise: Record<string, string> = {
  "The full site address will be required.": "Complete the site address.",
  "A phone number or email will be required.": "Add a phone number or email.",
  "Customer name will be required.": "Add a customer name.",
  "Add at least one floor plan.": "Add a floor plan.",
  "Enable at least one insulation product.": "Select wall or ceiling insulation.",
};

/** Compact the overview while retaining precise validation beside each field. */
export function summariseDraftErrors(entries: [string, string][]): SummaryIssue[] {
  const result: SummaryIssue[] = [];
  const included = new Set<string>();
  for (const [path, message] of entries) {
    if (included.has(path)) continue;
    const product = path.startsWith("wall.") ? "wall" : path.startsWith("ceiling.") ? "ceiling" : null;
    if (product && /^(Wall|Ceiling) (area|rate|R-value) must be greater than zero\.$/.test(message)) {
      const fields = entries.filter(([key, detail]) => key.startsWith(`${product}.`) && /^(Wall|Ceiling) (area|rate|R-value) must be greater than zero\.$/.test(detail));
      const names = fields.map(([key, detail]) => { included.add(key); return detail.split(" ")[1]; });
      const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
      result.push({ path, message: `Enter ${product} ${list} above 0.`, simple: true });
    } else {
      result.push({ path, message: concise[message] ?? message, simple: Boolean(concise[message]) || path === "floorPlan" });
    }
  }
  return result;
}
