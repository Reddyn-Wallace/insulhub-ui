BEGIN;

-- Reuse the append-only partner update stream, retaining authenticated attribution.
ALTER TABLE public.partner_job_amendments DROP CONSTRAINT partner_amendment_v1_patch;
ALTER TABLE public.partner_job_amendments ADD CONSTRAINT partner_amendment_v1_patch CHECK (
  jsonb_typeof(patch)='object' AND patch ? 'version' AND patch ? 'description'
  AND jsonb_typeof(patch->'version')='number' AND patch->>'version'='1'
  AND patch - ARRAY['version','description','contractDeltaCents','requestKey','authorName','legacyActorId']='{}'::jsonb
  AND jsonb_typeof(patch->'description')='string' AND patch->>'description'=btrim(patch->>'description') AND length(patch->>'description') BETWEEN 1 AND 1000
  AND (NOT patch ? 'contractDeltaCents' OR (jsonb_typeof(patch->'contractDeltaCents')='number' AND (patch->>'contractDeltaCents') ~ '^-?[0-9]{1,12}$' AND (patch->>'contractDeltaCents')::bigint BETWEEN -999999999999 AND 999999999999))
  AND (NOT patch ? 'requestKey' OR (jsonb_typeof(patch->'requestKey')='string' AND (patch->>'requestKey') ~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-5][0-9A-Fa-f]{3}-[89AaBb][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$'))
  AND (NOT patch ? 'authorName' OR (jsonb_typeof(patch->'authorName')='string' AND length(btrim(patch->>'authorName')) BETWEEN 1 AND 200))
  AND (NOT patch ? 'legacyActorId' OR (jsonb_typeof(patch->'legacyActorId')='string' AND patch->>'legacyActorId' ~ '^[a-f0-9]{24}$'))
);

-- Preserve the existing projections and their access checks; add only attribution.
DO $$ DECLARE signature text; definition text; updated text; BEGIN
  FOREACH signature IN ARRAY ARRAY['public.partner_ops_job_detail(text,uuid)','public.partner_partner_tracking_projection(text,uuid,uuid)'] LOOP
    definition:=pg_get_functiondef(signature::regprocedure);
    IF position('''authorName'',COALESCE(a.patch->>''authorName'',''InsulHub team'')' in definition)>0 THEN CONTINUE; END IF;
    updated:=replace(definition,'''description'',a.patch->>''description'',','''description'',a.patch->>''description'',''authorName'',COALESCE(a.patch->>''authorName'',''InsulHub team''),');
    IF updated=definition THEN RAISE EXCEPTION 'Expected amendment projection not found in %',signature; END IF;
    EXECUTE updated;
  END LOOP;
END $$;

CREATE TABLE public.partner_note_reads (
  company_id uuid NOT NULL,
  job_id uuid NOT NULL,
  user_id text NOT NULL,
  seen_sequence integer NOT NULL CHECK(seen_sequence >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(company_id,job_id,user_id),
  FOREIGN KEY(company_id,job_id) REFERENCES public.partner_jobs(company_id,id) ON DELETE CASCADE,
  FOREIGN KEY(company_id,user_id) REFERENCES public.partner_users(company_id,id) ON DELETE CASCADE
);
ALTER TABLE public.partner_note_reads OWNER TO partner_ops_owner;
ALTER TABLE public.partner_note_reads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.partner_note_reads FROM PUBLIC,partner_portal_runtime,partner_ops_runtime,partner_submission_worker;

CREATE FUNCTION public.partner_note_feed(actor text,target_company uuid,target_job uuid,seen integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE latest integer; viewed integer;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.partner_users u JOIN public.partner_companies c ON c.id=u.company_id
    WHERE u.id=actor AND u.company_id=target_company AND u.principal_type='PARTNER' AND u.disabled_at IS NULL AND c.is_active=true) THEN RETURN NULL; END IF;
  IF target_job IS NULL THEN
    IF seen IS NOT NULL THEN RAISE EXCEPTION 'UPDATE_INVALID'; END IF;
    RETURN jsonb_build_object('jobs',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',j.id,'latestSequence',COALESCE(a.latest,0),'readSequence',COALESCE(r.seen_sequence,0)))
      FROM public.partner_jobs j LEFT JOIN LATERAL (SELECT max(sequence) latest FROM public.partner_job_amendments WHERE company_id=j.company_id AND job_id=j.id) a ON true
      LEFT JOIN public.partner_note_reads r ON r.company_id=j.company_id AND r.job_id=j.id AND r.user_id=actor
      WHERE j.company_id=target_company AND j.deleted_at IS NULL),'[]'::jsonb));
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.partner_jobs WHERE company_id=target_company AND id=target_job AND deleted_at IS NULL) THEN RETURN NULL; END IF;
  SELECT COALESCE(max(sequence),0) INTO latest FROM public.partner_job_amendments WHERE company_id=target_company AND job_id=target_job;
  IF seen IS NOT NULL THEN
    IF seen<0 OR seen>latest THEN RAISE EXCEPTION 'UPDATE_INVALID'; END IF;
    INSERT INTO public.partner_note_reads(company_id,job_id,user_id,seen_sequence) VALUES(target_company,target_job,actor,seen)
      ON CONFLICT(company_id,job_id,user_id) DO UPDATE SET seen_sequence=greatest(partner_note_reads.seen_sequence,EXCLUDED.seen_sequence),updated_at=now();
  END IF;
  SELECT COALESCE((SELECT seen_sequence FROM public.partner_note_reads WHERE company_id=target_company AND job_id=target_job AND user_id=actor),0) INTO viewed;
  RETURN jsonb_build_object('latestSequence',latest,'readSequence',viewed,'updates',COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'sequence',a.sequence,'description',a.patch->>'description','authorName',COALESCE(a.patch->>'authorName','InsulHub team'),'createdAt',a.created_at) ORDER BY a.sequence)
    FROM public.partner_job_amendments a WHERE a.company_id=target_company AND a.job_id=target_job AND a.sequence<=latest),'[]'::jsonb));
END $$;
ALTER FUNCTION public.partner_note_feed(text,uuid,uuid,integer) OWNER TO partner_ops_owner;
REVOKE ALL ON FUNCTION public.partner_note_feed(text,uuid,uuid,integer) FROM PUBLIC,partner_ops_runtime,partner_submission_worker;
GRANT EXECUTE ON FUNCTION public.partner_note_feed(text,uuid,uuid,integer) TO partner_portal_runtime;
COMMIT;
