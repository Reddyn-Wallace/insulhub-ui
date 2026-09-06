type HistoryRow = { id: string; sentAt?: string | null };
// Keep attempts updated locally after a history request began, while still loading older records.
export function mergeJobCommunicationHistory<T extends HistoryRow>(incoming: T[], current: T[], updatedIds: ReadonlySet<string>): T[] {
  const updated = current.filter(item => updatedIds.has(item.id));
  const protectedIds = new Set(updated.map(item => item.id));
  return [...updated, ...incoming.filter(item => !protectedIds.has(item.id))]
    .sort((a, b) => new Date(b.sentAt || 0).getTime() - new Date(a.sentAt || 0).getTime());
}
