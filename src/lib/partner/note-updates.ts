export type PartnerNoteUpdate = { sequence: number; description: string; authorName: string; createdAt: string };
export type PartnerNoteFeed = { updates: PartnerNoteUpdate[]; latestSequence: number; readSequence: number };
export type PartnerNoteSummary = { id: string; latestSequence: number; readSequence: number };
export const EMPTY_NOTE_FEED: PartnerNoteFeed = { updates: [], latestSequence: 0, readSequence: 0 };
export function noteDate(value: string): string {
  return new Intl.DateTimeFormat("en-NZ", { timeZone: "Pacific/Auckland", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
