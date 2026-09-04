BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
DO $$ BEGIN
  IF to_regprocedure('public.digest(bytea,text)') IS NULL THEN
    RAISE EXCEPTION 'partner site-plan migration requires public.digest(bytea,text) from pgcrypto';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION partner_site_plan_document_valid(value jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog
AS $$
DECLARE item jsonb; point jsonb; ids text[] := ARRAY[]::text[]; aggregate_text integer := 0; number_value numeric;
BEGIN
  IF octet_length(value::text)>262144 OR jsonb_typeof(value)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(value))<>5
    OR NOT(value?&ARRAY['schemaVersion','templateVersion','walls','textNotes','showDimensions'])
    OR jsonb_typeof(value->'schemaVersion')<>'number' OR value->'schemaVersion'<>'1'::jsonb
    OR jsonb_typeof(value->'templateVersion')<>'string' OR value->>'templateVersion'<>'site-plan-template-v2'
    OR jsonb_typeof(value->'showDimensions')<>'boolean' OR jsonb_typeof(value->'walls')<>'array'
    OR jsonb_typeof(value->'textNotes')<>'array' OR jsonb_array_length(value->'walls')>500 OR jsonb_array_length(value->'textNotes')>100 THEN RETURN false; END IF;
  FOR item IN SELECT jsonb_array_elements(value->'walls') LOOP
    IF jsonb_typeof(item)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(item)) NOT BETWEEN 4 AND 6
      OR NOT(item?&ARRAY['id','start','end','style']) OR EXISTS(SELECT 1 FROM jsonb_object_keys(item) key WHERE key<>ALL(ARRAY['id','start','end','style','color','lengthOverride']))
      OR jsonb_typeof(item->'id')<>'string' OR item->>'id'!~'^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$' OR item->>'id'=ANY(ids)
      OR jsonb_typeof(item->'style')<>'string' OR item->>'style' NOT IN('solid','dotted')
      OR (item?'color' AND (jsonb_typeof(item->'color')<>'string' OR item->>'color' NOT IN('slate','teal','blue','amber','red')))
      OR jsonb_typeof(item->'start')<>'object' OR jsonb_typeof(item->'end')<>'object' THEN RETURN false; END IF;
    ids:=array_append(ids,item->>'id');
    FOREACH point IN ARRAY ARRAY[item->'start',item->'end'] LOOP
      IF (SELECT count(*) FROM jsonb_object_keys(point))<>2 OR NOT(point?&ARRAY['x','y']) OR jsonb_typeof(point->'x')<>'number' OR jsonb_typeof(point->'y')<>'number'
        OR (point->>'x')::numeric NOT BETWEEN 0 AND 18 OR (point->>'y')::numeric NOT BETWEEN 0 AND 17 THEN RETURN false; END IF;
    END LOOP;
    IF item->'start'=item->'end' THEN RETURN false; END IF;
    IF item?'lengthOverride' AND item->'lengthOverride'<>'null'::jsonb THEN
      IF jsonb_typeof(item->'lengthOverride')<>'number' THEN RETURN false; END IF; number_value:=(item->>'lengthOverride')::numeric;
      IF number_value NOT BETWEEN 0.01 AND 10000 THEN RETURN false; END IF;
    END IF;
  END LOOP;
  ids:=ARRAY[]::text[];
  FOR item IN SELECT jsonb_array_elements(value->'textNotes') LOOP
    IF jsonb_typeof(item)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(item)) NOT BETWEEN 5 AND 7
      OR NOT(item?&ARRAY['id','text','x','y','fontSize']) OR EXISTS(SELECT 1 FROM jsonb_object_keys(item) key WHERE key<>ALL(ARRAY['id','text','x','y','fontSize','boxWidth','boxHeight']))
      OR jsonb_typeof(item->'id')<>'string' OR item->>'id'!~'^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$' OR item->>'id'=ANY(ids)
      OR jsonb_typeof(item->'text')<>'string' OR length(item->>'text')>2000 OR item->>'text'<>normalize(item->>'text',NFC)
      OR EXISTS(SELECT 1 FROM generate_series(1,length(item->>'text')) AS chars(character_index)
        WHERE ascii(substr(item->>'text',character_index,1)) BETWEEN 0 AND 9
           OR ascii(substr(item->>'text',character_index,1)) BETWEEN 11 AND 31
           OR ascii(substr(item->>'text',character_index,1)) BETWEEN 127 AND 159)
      OR jsonb_typeof(item->'x')<>'number' OR jsonb_typeof(item->'y')<>'number' OR jsonb_typeof(item->'fontSize')<>'number'
      OR (item->>'x')::numeric NOT BETWEEN 0 AND 18 OR (item->>'y')::numeric NOT BETWEEN 0 AND 17 OR (item->>'fontSize')::numeric NOT BETWEEN 0.32 AND 0.82 THEN RETURN false; END IF;
    IF item?'boxWidth' AND (jsonb_typeof(item->'boxWidth')<>'number' OR (item->>'boxWidth')::numeric NOT BETWEEN 0.8 AND 10.5) THEN RETURN false; END IF;
    IF item?'boxHeight' AND (jsonb_typeof(item->'boxHeight')<>'number' OR (item->>'boxHeight')::numeric NOT BETWEEN 0.8 AND 17) THEN RETURN false; END IF;
    ids:=array_append(ids,item->>'id'); aggregate_text:=aggregate_text+length(item->>'text');
  END LOOP;
  RETURN aggregate_text<=20000;
EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END;
$$;

CREATE TABLE partner_site_plan_d1_legacy_backup(
  drawing_id uuid PRIMARY KEY REFERENCES partner_site_plan_drawings(id) ON DELETE CASCADE,
  floor_index integer NOT NULL,
  drawing_data_was_empty boolean NOT NULL
);
INSERT INTO partner_site_plan_d1_legacy_backup(drawing_id,floor_index,drawing_data_was_empty)
SELECT id,floor_index,drawing_data='{}'::jsonb FROM partner_site_plan_drawings;

DO $$
DECLARE duplicate_name_groups integer; invalid_order_jobs integer; non_nfc_names integer; oversized_jobs integer;
BEGIN
  SELECT count(*) INTO duplicate_name_groups FROM(
    SELECT 1 FROM partner_site_plan_drawings GROUP BY company_id,job_id,lower(name) HAVING count(*)>1
  ) duplicates;
  SELECT count(*) INTO invalid_order_jobs FROM(
    SELECT 1 FROM partner_site_plan_drawings GROUP BY company_id,job_id
    HAVING min(sort_order)<>0 OR max(sort_order)<>count(*)-1 OR count(DISTINCT sort_order)<>count(*)
  ) invalid_orders;
  SELECT count(*) INTO non_nfc_names FROM partner_site_plan_drawings WHERE name<>normalize(name,NFC);
  SELECT count(*) INTO oversized_jobs FROM(SELECT 1 FROM partner_site_plan_drawings GROUP BY company_id,job_id HAVING count(*)>20) oversized;
  IF duplicate_name_groups>0 OR invalid_order_jobs>0 OR non_nfc_names>0 OR oversized_jobs>0 THEN
    RAISE EXCEPTION 'partner site-plan preflight failed: duplicate_name_groups=%, invalid_order_jobs=%, non_nfc_names=%, oversized_jobs=%',duplicate_name_groups,invalid_order_jobs,non_nfc_names,oversized_jobs;
  END IF;
END $$;

UPDATE partner_site_plan_drawings
SET drawing_data = '{"schemaVersion":1,"templateVersion":"site-plan-template-v2","walls":[],"textNotes":[],"showDimensions":true}'::jsonb
WHERE drawing_data = '{}'::jsonb;

ALTER TABLE partner_site_plan_drawings ALTER COLUMN drawing_data
  SET DEFAULT '{"schemaVersion":1,"templateVersion":"site-plan-template-v2","walls":[],"textNotes":[],"showDimensions":true}'::jsonb;

DROP INDEX IF EXISTS partner_site_plan_job_idx;
ALTER TABLE partner_site_plan_drawings
  DROP CONSTRAINT IF EXISTS partner_site_plan_floor_nonnegative,
  DROP CONSTRAINT IF EXISTS partner_site_plan_sort_nonnegative,
  DROP CONSTRAINT IF EXISTS partner_site_plan_drawing_object,
  DROP COLUMN floor_index,
  ADD CONSTRAINT partner_site_plan_sort_nonnegative CHECK (sort_order >= 0),
  ADD CONSTRAINT partner_site_plan_name_nfc CHECK (name=normalize(name,NFC)),
  ADD CONSTRAINT partner_site_plan_document_strict CHECK (partner_site_plan_document_valid(drawing_data)),
  ADD CONSTRAINT partner_site_plan_company_job_id_unique UNIQUE (company_id, job_id, id),
  ADD CONSTRAINT partner_site_plan_order_unique UNIQUE (company_id, job_id, sort_order) DEFERRABLE INITIALLY IMMEDIATE;

CREATE UNIQUE INDEX partner_site_plan_name_unique
  ON partner_site_plan_drawings (company_id, job_id, lower(name));
CREATE INDEX partner_site_plan_job_idx
  ON partner_site_plan_drawings (company_id, job_id, sort_order, id);

ALTER TABLE partner_jobs ADD COLUMN floor_plan_revision integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT partner_jobs_floor_plan_revision_nonnegative CHECK (floor_plan_revision >= 0);

CREATE TABLE partner_site_plan_pdf_artifacts (
  company_id uuid NOT NULL,
  job_id uuid NOT NULL,
  drawing_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  render_hash char(64) NOT NULL,
  pdf_bytes bytea NOT NULL,
  byte_size integer NOT NULL,
  drawing_revision integer NOT NULL,
  renderer_version varchar(80) NOT NULL,
  template_version varchar(80) NOT NULL,
  template_sha256 char(64) NOT NULL,
  content_sha256 char(64) NOT NULL,
  file_name varchar(240) NOT NULL,
  generated_by_user_id text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_site_plan_pdf_artifacts_pk PRIMARY KEY (company_id, job_id, drawing_id, id),
  CONSTRAINT partner_site_plan_pdf_artifact_drawing_fk FOREIGN KEY (company_id, job_id, drawing_id)
    REFERENCES partner_site_plan_drawings(company_id, job_id, id) ON DELETE CASCADE,
  CONSTRAINT partner_site_plan_pdf_artifact_job_fk FOREIGN KEY (company_id, job_id)
    REFERENCES partner_jobs(company_id, id) ON DELETE CASCADE,
  CONSTRAINT partner_site_plan_pdf_artifact_user_fk FOREIGN KEY (company_id, generated_by_user_id)
    REFERENCES partner_users(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT partner_site_plan_pdf_artifact_hashes CHECK (render_hash ~ '^[0-9a-f]{64}$' AND template_sha256 ~ '^[0-9a-f]{64}$' AND content_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT partner_site_plan_pdf_artifact_size CHECK (byte_size BETWEEN 1 AND 5242880 AND byte_size = octet_length(pdf_bytes)),
  CONSTRAINT partner_site_plan_pdf_artifact_revision CHECK (drawing_revision >= 0),
  CONSTRAINT partner_site_plan_pdf_artifact_file_name CHECK (file_name = btrim(file_name) AND file_name <> ''),
  CONSTRAINT partner_site_plan_pdf_artifact_identity UNIQUE (company_id, drawing_id, drawing_revision, render_hash)
);
CREATE INDEX partner_site_plan_pdf_artifact_history_idx
  ON partner_site_plan_pdf_artifacts (company_id, drawing_id, generated_at DESC, id DESC);

CREATE TABLE partner_site_plan_rate_limits (
  scope_key text NOT NULL,
  action varchar(20) NOT NULL,
  window_seconds integer NOT NULL,
  window_started_at timestamptz NOT NULL,
  attempt_count integer NOT NULL,
  PRIMARY KEY (scope_key, action, window_seconds),
  CONSTRAINT partner_site_plan_rate_limit_action CHECK (action IN ('GENERATE','DOWNLOAD')),
  CONSTRAINT partner_site_plan_rate_limit_values CHECK (window_seconds > 0 AND attempt_count > 0)
);

ALTER TABLE partner_site_plan_drawings
  ADD COLUMN current_pdf_artifact_id uuid,
  ADD CONSTRAINT partner_site_plan_current_pdf_artifact_fk
    FOREIGN KEY (company_id, job_id, id, current_pdf_artifact_id)
    REFERENCES partner_site_plan_pdf_artifacts(company_id, job_id, drawing_id, id)
    DEFERRABLE INITIALLY IMMEDIATE;

CREATE OR REPLACE FUNCTION partner_site_plan_max_twenty()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM 1 FROM public.partner_jobs WHERE company_id = NEW.company_id AND id = NEW.job_id FOR UPDATE;
  IF (SELECT count(*) FROM public.partner_site_plan_drawings WHERE company_id = NEW.company_id AND job_id = NEW.job_id AND id <> NEW.id) >= 20 THEN
    RAISE EXCEPTION 'site plan floor limit exceeded';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER partner_site_plan_max_twenty_before_write
  BEFORE INSERT OR UPDATE OF company_id, job_id ON partner_site_plan_drawings
  FOR EACH ROW EXECUTE FUNCTION partner_site_plan_max_twenty();

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'partner_artifact_owner') THEN CREATE ROLE partner_artifact_owner NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'partner_portal_runtime') THEN CREATE ROLE partner_portal_runtime NOLOGIN NOINHERIT; END IF;
  ALTER ROLE partner_artifact_owner NOLOGIN NOINHERIT;
  ALTER ROLE partner_portal_runtime NOLOGIN NOINHERIT;
  IF NOT pg_has_role(session_user,'partner_artifact_owner','USAGE') THEN EXECUTE format('GRANT partner_artifact_owner TO %I WITH INHERIT TRUE, SET TRUE',session_user); END IF;
  GRANT CREATE ON SCHEMA public TO partner_artifact_owner;
  REVOKE partner_artifact_owner FROM partner_portal_runtime;
END $$;

CREATE OR REPLACE FUNCTION partner_reject_pdf_artifact_change()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF current_user <> 'partner_artifact_owner' THEN RAISE EXCEPTION 'PDF artifacts are immutable'; END IF;
  RETURN OLD;
END;
$$;
ALTER FUNCTION partner_reject_pdf_artifact_change() OWNER TO partner_artifact_owner;
CREATE TRIGGER partner_pdf_artifact_immutable
  BEFORE UPDATE OR DELETE ON partner_site_plan_pdf_artifacts
  FOR EACH ROW EXECUTE FUNCTION partner_reject_pdf_artifact_change();

CREATE OR REPLACE FUNCTION partner_prune_site_plan_pdf_artifacts(target_company uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE deleted_count integer := 0; quota_bytes bigint;
BEGIN
  PERFORM 1 FROM public.partner_companies WHERE id=target_company FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(target_company::text, 914));
  PERFORM id FROM public.partner_jobs WHERE company_id=target_company ORDER BY id FOR UPDATE;
  PERFORM id FROM public.partner_site_plan_drawings WHERE company_id=target_company ORDER BY job_id,id FOR UPDATE;
  PERFORM id FROM public.partner_site_plan_pdf_artifacts WHERE company_id=target_company ORDER BY job_id,drawing_id,id FOR UPDATE;
  WITH ranked AS (
    SELECT a.company_id, a.job_id, a.drawing_id, a.id,
      row_number() OVER (PARTITION BY a.company_id, a.drawing_id ORDER BY a.generated_at DESC, a.id DESC) AS history_rank
    FROM public.partner_site_plan_pdf_artifacts a
    JOIN public.partner_site_plan_drawings d ON (d.company_id,d.job_id,d.id)=(a.company_id,a.job_id,a.drawing_id)
    WHERE a.company_id = target_company AND a.id IS DISTINCT FROM d.current_pdf_artifact_id
  ), removed AS (
    DELETE FROM public.partner_site_plan_pdf_artifacts a USING ranked r
    WHERE (a.company_id,a.job_id,a.drawing_id,a.id)=(r.company_id,r.job_id,r.drawing_id,r.id) AND r.history_rank > 2 RETURNING 1
  ) SELECT count(*) INTO deleted_count FROM removed;
  SELECT COALESCE(sum(byte_size),0) INTO quota_bytes FROM public.partner_site_plan_pdf_artifacts WHERE company_id=target_company;
  IF quota_bytes > 1073741824 THEN
    WITH candidates AS (
      SELECT a.company_id,a.job_id,a.drawing_id,a.id,a.byte_size,
        sum(a.byte_size) OVER (ORDER BY a.generated_at,a.id) AS running_bytes
      FROM public.partner_site_plan_pdf_artifacts a
      JOIN public.partner_site_plan_drawings d ON (d.company_id,d.job_id,d.id)=(a.company_id,a.job_id,a.drawing_id)
      WHERE a.company_id=target_company AND a.id IS DISTINCT FROM d.current_pdf_artifact_id
    ), removed AS (
      DELETE FROM public.partner_site_plan_pdf_artifacts a USING candidates c
      WHERE (a.company_id,a.job_id,a.drawing_id,a.id)=(c.company_id,c.job_id,c.drawing_id,c.id)
        AND c.running_bytes - c.byte_size < quota_bytes - 1073741824 RETURNING 1
    ) SELECT deleted_count + count(*) INTO deleted_count FROM removed;
  END IF;
  IF (SELECT COALESCE(sum(byte_size),0) FROM public.partner_site_plan_pdf_artifacts WHERE company_id=target_company) > 1073741824 THEN
    RAISE EXCEPTION 'site plan PDF company quota exceeded';
  END IF;
  RETURN deleted_count;
END;
$$;
ALTER FUNCTION partner_prune_site_plan_pdf_artifacts(uuid) OWNER TO partner_artifact_owner;
REVOKE ALL ON FUNCTION partner_prune_site_plan_pdf_artifacts(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION partner_publish_site_plan_pdf_artifact(
  target_company uuid,target_job uuid,target_drawing uuid,target_id uuid,target_render_hash text,target_pdf bytea,
  target_drawing_revision integer,target_renderer text,target_template text,target_template_sha text,target_content_sha text,
  target_file_name text,target_user text,expected_job_revision integer,expected_floor_plan_revision integer,expected_current_artifact uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE artifact_id uuid; stored_sha text; stored_size integer;
BEGIN
  PERFORM 1 FROM public.partner_companies WHERE id=target_company FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM 1 FROM public.partner_jobs WHERE company_id=target_company AND id=target_job AND submission_state='DRAFT'
    AND revision=expected_job_revision AND floor_plan_revision=expected_floor_plan_revision FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM 1 FROM public.partner_site_plan_drawings WHERE company_id=target_company AND job_id=target_job AND id=target_drawing
    AND revision=target_drawing_revision AND current_pdf_artifact_id IS NOT DISTINCT FROM expected_current_artifact FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM id FROM public.partner_site_plan_pdf_artifacts WHERE company_id=target_company AND job_id=target_job AND drawing_id=target_drawing ORDER BY id FOR UPDATE;
  PERFORM pg_advisory_xact_lock(hashtextextended(target_company::text,914));
  IF octet_length(target_pdf) NOT BETWEEN 1 AND 5242880 OR encode(public.digest(target_pdf,'sha256'),'hex')<>target_content_sha THEN
    RAISE EXCEPTION 'PDF artifact content verification failed';
  END IF;
  SELECT id,content_sha256,byte_size INTO artifact_id,stored_sha,stored_size FROM public.partner_site_plan_pdf_artifacts
    WHERE company_id=target_company AND drawing_id=target_drawing AND drawing_revision=target_drawing_revision AND render_hash=target_render_hash;
  IF artifact_id IS NOT NULL THEN
    IF stored_sha<>target_content_sha OR stored_size<>octet_length(target_pdf) THEN RAISE EXCEPTION 'existing PDF artifact verification failed'; END IF;
  ELSE
    artifact_id:=target_id;
    INSERT INTO public.partner_site_plan_pdf_artifacts(company_id,job_id,drawing_id,id,render_hash,pdf_bytes,byte_size,drawing_revision,renderer_version,template_version,template_sha256,content_sha256,file_name,generated_by_user_id)
    VALUES(target_company,target_job,target_drawing,artifact_id,target_render_hash,target_pdf,octet_length(target_pdf),target_drawing_revision,target_renderer,target_template,target_template_sha,target_content_sha,target_file_name,target_user);
  END IF;
  UPDATE public.partner_site_plan_drawings SET current_pdf_artifact_id=artifact_id WHERE company_id=target_company AND job_id=target_job AND id=target_drawing;
  PERFORM public.partner_prune_site_plan_pdf_artifacts(target_company);
  RETURN artifact_id;
END; $$;
ALTER FUNCTION partner_publish_site_plan_pdf_artifact(uuid,uuid,uuid,uuid,text,bytea,integer,text,text,text,text,text,text,integer,integer,uuid) OWNER TO partner_artifact_owner;
REVOKE ALL ON FUNCTION partner_publish_site_plan_pdf_artifact(uuid,uuid,uuid,uuid,text,bytea,integer,text,text,text,text,text,text,integer,integer,uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION partner_purge_draft_site_plan_drawing(target_company uuid,target_job uuid,target_drawing uuid,expected_floor_plan_revision integer)
RETURNS TABLE(collection_revision integer,drawing_ids uuid[]) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE drawing_count integer;minimum_order integer;maximum_order integer;distinct_orders integer;
BEGIN
  PERFORM 1 FROM public.partner_companies WHERE id=target_company FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM 1 FROM public.partner_jobs WHERE company_id=target_company AND id=target_job AND submission_state='DRAFT' AND floor_plan_revision=expected_floor_plan_revision FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SET CONSTRAINTS public.partner_site_plan_order_unique DEFERRED;
  PERFORM id FROM public.partner_site_plan_drawings WHERE company_id=target_company AND job_id=target_job ORDER BY id FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM public.partner_site_plan_drawings WHERE company_id=target_company AND job_id=target_job AND id=target_drawing) THEN RETURN; END IF;
  PERFORM id FROM public.partner_site_plan_pdf_artifacts WHERE company_id=target_company AND job_id=target_job AND drawing_id=target_drawing ORDER BY id FOR UPDATE;
  -- FK cascades execute as the table owner; delete explicitly as the artifact owner.
  UPDATE public.partner_site_plan_drawings SET current_pdf_artifact_id=NULL
    WHERE company_id=target_company AND job_id=target_job AND id=target_drawing;
  DELETE FROM public.partner_site_plan_pdf_artifacts WHERE company_id=target_company AND job_id=target_job AND drawing_id=target_drawing;
  DELETE FROM public.partner_site_plan_drawings WHERE company_id=target_company AND job_id=target_job AND id=target_drawing;
  WITH ordered AS(
    SELECT id,(row_number() OVER(ORDER BY sort_order,id)-1)::integer AS new_order
    FROM public.partner_site_plan_drawings WHERE company_id=target_company AND job_id=target_job
  ) UPDATE public.partner_site_plan_drawings d SET sort_order=o.new_order
    FROM ordered o WHERE d.company_id=target_company AND d.job_id=target_job AND d.id=o.id;
  UPDATE public.partner_jobs SET floor_plan_revision=floor_plan_revision+1,updated_at=now()
    WHERE company_id=target_company AND id=target_job RETURNING floor_plan_revision INTO collection_revision;
  SELECT count(*)::integer,COALESCE(min(sort_order),0),COALESCE(max(sort_order),-1),count(DISTINCT sort_order)::integer
    INTO drawing_count,minimum_order,maximum_order,distinct_orders
    FROM public.partner_site_plan_drawings WHERE company_id=target_company AND job_id=target_job;
  IF minimum_order<>0 OR maximum_order<>drawing_count-1 OR distinct_orders<>drawing_count THEN
    RAISE EXCEPTION 'site plan floor order compaction failed';
  END IF;
  SELECT COALESCE(array_agg(id ORDER BY sort_order,id),ARRAY[]::uuid[]) INTO drawing_ids
    FROM public.partner_site_plan_drawings WHERE company_id=target_company AND job_id=target_job;
  RETURN NEXT;
END; $$;
ALTER FUNCTION partner_purge_draft_site_plan_drawing(uuid,uuid,uuid,integer) OWNER TO partner_artifact_owner;
REVOKE ALL ON FUNCTION partner_purge_draft_site_plan_drawing(uuid,uuid,uuid,integer) FROM PUBLIC;

GRANT USAGE ON SCHEMA public TO partner_artifact_owner,partner_portal_runtime;
GRANT SELECT ON partner_companies,partner_jobs,partner_site_plan_drawings,partner_site_plan_pdf_artifacts TO partner_artifact_owner;
GRANT INSERT,DELETE ON partner_site_plan_pdf_artifacts TO partner_artifact_owner;
-- SELECT FOR UPDATE requires UPDATE on a column, even when no values change.
GRANT UPDATE(id) ON partner_companies,partner_site_plan_pdf_artifacts TO partner_artifact_owner;
GRANT UPDATE(sort_order,current_pdf_artifact_id),DELETE ON partner_site_plan_drawings TO partner_artifact_owner;
GRANT UPDATE(floor_plan_revision,updated_at) ON partner_jobs TO partner_artifact_owner;
GRANT EXECUTE ON FUNCTION public.digest(bytea,text) TO partner_artifact_owner;
GRANT EXECUTE ON FUNCTION partner_prune_site_plan_pdf_artifacts(uuid) TO partner_portal_runtime;
GRANT EXECUTE ON FUNCTION partner_publish_site_plan_pdf_artifact(uuid,uuid,uuid,uuid,text,bytea,integer,text,text,text,text,text,text,integer,integer,uuid) TO partner_portal_runtime;
GRANT EXECUTE ON FUNCTION partner_purge_draft_site_plan_drawing(uuid,uuid,uuid,integer) TO partner_portal_runtime;

GRANT SELECT ON partner_companies,partner_tracking_facts TO partner_portal_runtime;
GRANT SELECT,UPDATE ON partner_users TO partner_portal_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON partner_sessions,partner_accounts,partner_verifications,partner_auth_rate_limits TO partner_portal_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON partner_jobs TO partner_portal_runtime;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON partner_site_plan_drawings FROM partner_portal_runtime;
REVOKE INSERT(id,current_pdf_artifact_id,submitted_snapshot_data,submitted_snapshot_at,submitted_pdf_storage_key,submitted_pdf_outbox_event_id,revision,created_at,updated_at),
  UPDATE(id,company_id,job_id,created_by_user_id,current_pdf_artifact_id,submitted_snapshot_data,submitted_snapshot_at,submitted_pdf_storage_key,submitted_pdf_outbox_event_id,created_at)
  ON partner_site_plan_drawings FROM partner_portal_runtime;
GRANT SELECT ON partner_site_plan_drawings TO partner_portal_runtime;
GRANT INSERT(company_id,job_id,name,sort_order,drawing_data,created_by_user_id) ON partner_site_plan_drawings TO partner_portal_runtime;
GRANT UPDATE(name,sort_order,drawing_data,revision,updated_at) ON partner_site_plan_drawings TO partner_portal_runtime;
GRANT SELECT ON partner_site_plan_pdf_artifacts TO partner_portal_runtime;
GRANT SELECT,INSERT,UPDATE ON partner_site_plan_rate_limits TO partner_portal_runtime;
GRANT SELECT,INSERT ON partner_audit_events TO partner_portal_runtime;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON partner_site_plan_pdf_artifacts FROM partner_portal_runtime;
REVOKE DELETE,TRUNCATE ON partner_site_plan_drawings FROM partner_portal_runtime;

DO $$ BEGIN
  IF session_user<>'partner_artifact_owner' AND pg_has_role(session_user,'partner_artifact_owner','MEMBER') THEN EXECUTE format('REVOKE partner_artifact_owner FROM %I',session_user); END IF;
END $$;

REVOKE CREATE ON SCHEMA public FROM partner_artifact_owner;
COMMIT;
