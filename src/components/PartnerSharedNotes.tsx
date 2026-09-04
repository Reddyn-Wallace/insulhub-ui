"use client";
import { noteDate, type PartnerNoteUpdate } from "@/lib/partner/note-updates";
export default function PartnerSharedNotes({ updates }: { updates: PartnerNoteUpdate[] }) {
  if (!updates.length) return null;
  return <div className="mt-4 border-t border-slate-100 pt-3" aria-label="Shared with partner">
    <p className="mb-3 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Shared with partner</p>
    <div className="space-y-3">{[...updates].sort((a,b)=>b.sequence-a.sequence).map(note=><div key={note.sequence} className="border-l-2 border-orange-200 pl-3"><p className="whitespace-pre-wrap break-words text-sm text-slate-700">{note.description}</p><p className="mt-1 text-xs text-slate-400">{note.authorName || "InsulHub team"} · {noteDate(note.createdAt)}</p></div>)}</div>
  </div>;
}
