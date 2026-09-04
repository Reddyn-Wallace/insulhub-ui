"use client";

// One active editor per page. Shell sign-out shares the same drain as links.
let saveBeforeLeaving: (() => Promise<boolean>) | null = null;
export function registerPartnerSaveGuard(save: () => Promise<boolean>): () => void {
  saveBeforeLeaving = save;
  return () => { if (saveBeforeLeaving === save) saveBeforeLeaving = null; };
}
export async function flushPartnerEdits(): Promise<boolean> {
  return saveBeforeLeaving ? saveBeforeLeaving() : true;
}
