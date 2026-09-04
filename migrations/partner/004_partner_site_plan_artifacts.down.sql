BEGIN;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='partner_artifact_owner') AND NOT pg_has_role(session_user,'partner_artifact_owner','MEMBER') THEN EXECUTE format('GRANT partner_artifact_owner TO %I WITH INHERIT TRUE, SET TRUE',session_user); END IF;
END $$;
REVOKE SELECT ON partner_companies,partner_tracking_facts FROM partner_portal_runtime;
REVOKE SELECT,UPDATE ON partner_users FROM partner_portal_runtime;
REVOKE SELECT,INSERT,UPDATE,DELETE ON partner_sessions,partner_accounts,partner_verifications,partner_auth_rate_limits FROM partner_portal_runtime;
REVOKE SELECT,INSERT,UPDATE,DELETE ON partner_jobs FROM partner_portal_runtime;
REVOKE SELECT ON partner_site_plan_drawings FROM partner_portal_runtime;
REVOKE INSERT(company_id,job_id,name,sort_order,drawing_data,created_by_user_id) ON partner_site_plan_drawings FROM partner_portal_runtime;
REVOKE UPDATE(name,sort_order,drawing_data,revision,updated_at) ON partner_site_plan_drawings FROM partner_portal_runtime;
REVOKE DELETE,TRUNCATE ON partner_site_plan_drawings FROM partner_portal_runtime;
REVOKE SELECT ON partner_site_plan_pdf_artifacts FROM partner_portal_runtime;
REVOKE SELECT,INSERT,UPDATE ON partner_site_plan_rate_limits FROM partner_portal_runtime;
REVOKE SELECT,INSERT ON partner_audit_events FROM partner_portal_runtime;
REVOKE SELECT ON partner_companies,partner_jobs,partner_site_plan_drawings,partner_site_plan_pdf_artifacts FROM partner_artifact_owner;
REVOKE INSERT,DELETE ON partner_site_plan_pdf_artifacts FROM partner_artifact_owner;
REVOKE UPDATE(sort_order,current_pdf_artifact_id),DELETE ON partner_site_plan_drawings FROM partner_artifact_owner;
REVOKE UPDATE(floor_plan_revision,updated_at) ON partner_jobs FROM partner_artifact_owner;
REVOKE EXECUTE ON FUNCTION public.digest(bytea,text) FROM partner_artifact_owner;
REVOKE USAGE ON SCHEMA public FROM partner_artifact_owner,partner_portal_runtime;
DROP TRIGGER IF EXISTS partner_pdf_artifact_immutable ON partner_site_plan_pdf_artifacts;
DROP TRIGGER IF EXISTS partner_site_plan_max_twenty_before_write ON partner_site_plan_drawings;
DROP FUNCTION IF EXISTS partner_publish_site_plan_pdf_artifact(uuid,uuid,uuid,uuid,text,bytea,integer,text,text,text,text,text,text,integer,integer,uuid);
DROP FUNCTION IF EXISTS partner_purge_draft_site_plan_drawing(uuid,uuid,uuid,integer);
DROP FUNCTION IF EXISTS partner_prune_site_plan_pdf_artifacts(uuid);
DROP FUNCTION IF EXISTS partner_reject_pdf_artifact_change();
DROP FUNCTION IF EXISTS partner_site_plan_max_twenty();
ALTER TABLE partner_site_plan_drawings DROP CONSTRAINT IF EXISTS partner_site_plan_current_pdf_artifact_fk;
ALTER TABLE partner_site_plan_drawings DROP COLUMN IF EXISTS current_pdf_artifact_id;
DROP TABLE IF EXISTS partner_site_plan_pdf_artifacts;
DROP TABLE IF EXISTS partner_site_plan_rate_limits;
ALTER TABLE partner_jobs DROP CONSTRAINT IF EXISTS partner_jobs_floor_plan_revision_nonnegative;
ALTER TABLE partner_jobs DROP COLUMN IF EXISTS floor_plan_revision;
DROP INDEX IF EXISTS partner_site_plan_name_unique;
DROP INDEX IF EXISTS partner_site_plan_job_idx;
ALTER TABLE partner_site_plan_drawings
  DROP CONSTRAINT IF EXISTS partner_site_plan_order_unique,
  DROP CONSTRAINT IF EXISTS partner_site_plan_company_job_id_unique,
  DROP CONSTRAINT IF EXISTS partner_site_plan_name_nfc,
  DROP CONSTRAINT IF EXISTS partner_site_plan_document_strict,
  ADD COLUMN floor_index integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT partner_site_plan_floor_nonnegative CHECK (floor_index >= 0),
  ADD CONSTRAINT partner_site_plan_drawing_object CHECK (jsonb_typeof(drawing_data) = 'object');
ALTER TABLE partner_site_plan_drawings ALTER COLUMN drawing_data SET DEFAULT '{}'::jsonb;
UPDATE partner_site_plan_drawings d SET floor_index=b.floor_index,
  drawing_data=CASE WHEN b.drawing_data_was_empty THEN '{}'::jsonb ELSE d.drawing_data END
FROM partner_site_plan_d1_legacy_backup b WHERE d.id=b.drawing_id;
DROP TABLE IF EXISTS partner_site_plan_d1_legacy_backup;
CREATE INDEX partner_site_plan_job_idx ON partner_site_plan_drawings (company_id, job_id, floor_index, sort_order, updated_at DESC);
DROP FUNCTION IF EXISTS partner_site_plan_document_valid(jsonb);
DO $$ BEGIN
  IF session_user<>'partner_artifact_owner' AND pg_has_role(session_user,'partner_artifact_owner','MEMBER') THEN EXECUTE format('REVOKE partner_artifact_owner FROM %I',session_user); END IF;
END $$;
COMMIT;
