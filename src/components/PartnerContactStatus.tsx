"use client";

import { useEffect, useId, useRef, useState } from "react";

export default function PartnerContactStatus({ reference }: { reference: string }) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const pinned = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = () => { if (closeTimer.current) clearTimeout(closeTimer.current); setOpen(true); };
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) { pinned.current = false; setOpen(false); }
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { pinned.current = false; setOpen(false); } };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, [open]);
  return <div ref={root} className="relative shrink-0" onMouseEnter={show} onMouseLeave={() => { if (!pinned.current && !root.current?.contains(document.activeElement)) closeTimer.current = setTimeout(() => setOpen(false), 150); }}>
    <button type="button" aria-expanded={open} aria-describedby={open ? id : undefined}
      onFocus={show} onBlur={() => { pinned.current = false; setOpen(false); }}
      onClick={() => { pinned.current = !pinned.current; setOpen(pinned.current); }}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-amber-50 px-3 text-xs font-semibold text-amber-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e85d04] focus-visible:ring-offset-2">
      Contact Insulmax <span aria-hidden="true">ⓘ</span>
    </button>
    {open ? <div id={id} role="tooltip" className="absolute right-0 top-full z-30 w-64 max-w-[calc(100vw-3rem)] rounded-xl bg-[#1a3a4a] p-4 text-sm leading-6 text-white shadow-lg">
      This submission needs a check. Please contact the Insulmax team directly and quote <strong className="break-words">{reference}</strong>. You don’t need to submit it again.
    </div> : null}
  </div>;
}
