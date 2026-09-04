BEGIN;
DROP FUNCTION public.partner_note_feed(text,uuid,uuid,integer);
DROP TABLE public.partner_note_reads;
-- Attribution remains compatible with the previous app and is retained so a
-- rollback never erases or rewrites already-published partner notes.
COMMIT;
