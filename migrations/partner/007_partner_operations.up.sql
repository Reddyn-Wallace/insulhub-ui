BEGIN;

-- Operations is intentionally a separate, function-only database boundary.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('partner_ops_owner','partner_ops_runtime')) THEN
    RAISE EXCEPTION 'partner operations role preflight failed: reserved role already exists';
  END IF;
  CREATE ROLE partner_ops_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  CREATE ROLE partner_ops_runtime NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  IF NOT pg_has_role(session_user, 'partner_ops_owner', 'USAGE') THEN EXECUTE format('GRANT partner_ops_owner TO %I WITH INHERIT TRUE, SET TRUE', session_user); END IF;
  REVOKE partner_ops_owner, partner_ops_runtime FROM partner_portal_runtime, partner_submission_worker, partner_submission_owner, partner_artifact_owner;
END $$;

ALTER TABLE public.partner_users ADD COLUMN ops_role text;
UPDATE public.partner_users SET ops_role='ADMIN' WHERE principal_type='INTERNAL';
ALTER TABLE public.partner_users ADD CONSTRAINT partner_users_ops_role CHECK (
  (principal_type='INTERNAL' AND company_id IS NULL AND ops_role IS NOT NULL AND ops_role IN ('ADMIN','OPERATIONS','FINANCE','VIEWER')) OR
  (principal_type='PARTNER' AND ops_role IS NULL)
);

CREATE TABLE public.partner_job_invoices (
  company_id uuid NOT NULL,
  job_id uuid NOT NULL,
  reference varchar(120) NOT NULL,
  amount_cents bigint NOT NULL,
  sent_at timestamptz NOT NULL,
  revision integer NOT NULL DEFAULT 0,
  created_by_user_id text NOT NULL REFERENCES public.partner_users(id) ON DELETE RESTRICT,
  updated_by_user_id text NOT NULL REFERENCES public.partner_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(company_id,job_id),
  CONSTRAINT partner_invoice_job_fk FOREIGN KEY(company_id,job_id) REFERENCES public.partner_jobs(company_id,id) ON DELETE RESTRICT,
  CONSTRAINT partner_invoice_reference CHECK(reference=btrim(reference) AND reference ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$'),
  CONSTRAINT partner_invoice_amount CHECK(amount_cents>=0 AND amount_cents<=999999999999),
  CONSTRAINT partner_invoice_revision CHECK(revision>=0)
);
ALTER TABLE public.partner_job_settlements ADD CONSTRAINT partner_settlement_ops_max_cents CHECK (
  gross_cents<=999999999999 AND net_due_cents<=999999999999
  AND (manual_commission_cents IS NULL OR manual_commission_cents<=999999999999)
  AND (retained_margin_cents IS NULL OR retained_margin_cents<=999999999999)
);

ALTER TABLE public.partner_job_amendments ADD CONSTRAINT partner_amendment_v1_patch CHECK (
  jsonb_typeof(patch)='object' AND patch ? 'version' AND patch ? 'description'
  AND jsonb_typeof(patch->'version')='number' AND patch->>'version'='1'
  AND patch - ARRAY['version','description','contractDeltaCents']='{}'::jsonb
  AND jsonb_typeof(patch->'description')='string' AND patch->>'description'=btrim(patch->>'description') AND length(patch->>'description') BETWEEN 1 AND 1000
  AND (NOT patch ? 'contractDeltaCents' OR (jsonb_typeof(patch->'contractDeltaCents')='number' AND (patch->>'contractDeltaCents') ~ '^-?[0-9]{1,12}$' AND (patch->>'contractDeltaCents')::bigint BETWEEN -999999999999 AND 999999999999))
);

ALTER TABLE public.partner_audit_events DROP CONSTRAINT partner_audit_event_type;
ALTER TABLE public.partner_audit_events ADD CONSTRAINT partner_audit_event_type CHECK(event_type IN(
 'LOGIN_SUCCEEDED','LOGIN_FAILED','LOGOUT','USER_PROVISIONED','USER_DISABLED','SESSIONS_REVOKED','LEGACY_CREDENTIAL_REPLACED',
 'SUBMISSION_FROZEN','SUBMISSION_CLAIMED','SUBMISSION_PHASE_CHECKPOINTED','SUBMISSION_FINALIZED','SUBMISSION_FAILED_RETRYABLE','SUBMISSION_RECONCILIATION_REQUIRED',
 'SUBMISSION_EXECUTE_DISCARDED','SUBMISSION_NOTIFICATION_CLAIMED','SUBMISSION_NOTIFICATION_RELEASED','SUBMISSION_NOTIFICATION_DELIVERED','SUBMISSION_NOTIFICATION_DEAD',
 'OPS_COMPANY_CREATED','OPS_COMPANY_UPDATED','OPS_PARTNER_USER_PROVISIONED','OPS_FACT_RECORDED','OPS_AMENDMENT_RECORDED','OPS_INVOICE_RECORDED','OPS_SETTLEMENT_RECORDED'));
CREATE OR REPLACE FUNCTION public.partner_ops_audit_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
  IF NEW.event_type LIKE 'OPS_%' AND current_user<>'partner_ops_owner' THEN RAISE EXCEPTION 'OPS_FORBIDDEN'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER partner_ops_audit_guard BEFORE INSERT ON public.partner_audit_events FOR EACH ROW EXECUTE FUNCTION public.partner_ops_audit_guard();

CREATE OR REPLACE FUNCTION public.partner_ops_cancelled(target_company uuid,target_job uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$ SELECT EXISTS(SELECT 1 FROM public.partner_tracking_facts WHERE company_id=target_company AND job_id=target_job AND fact_type='CANCELLED') $$;
CREATE OR REPLACE FUNCTION public.partner_ops_guard_cancelled() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
  IF public.partner_ops_cancelled(NEW.company_id,NEW.job_id) THEN RAISE EXCEPTION 'OPS_CANCELLED'; END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.partner_ops_fact_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
  IF NEW.fact_type='CANCELLED' THEN
    IF public.partner_ops_cancelled(NEW.company_id,NEW.job_id) THEN RAISE EXCEPTION 'OPS_DUPLICATE_FACT'; END IF;
  ELSIF public.partner_ops_cancelled(NEW.company_id,NEW.job_id) THEN RAISE EXCEPTION 'OPS_CANCELLED';
  ELSIF NEW.fact_type IN ('COMMISSION_PAID','REMITTANCE_RECEIVED') AND EXISTS(SELECT 1 FROM public.partner_tracking_facts WHERE company_id=NEW.company_id AND job_id=NEW.job_id AND fact_type=NEW.fact_type) THEN RAISE EXCEPTION 'OPS_DUPLICATE_FACT'; END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.partner_ops_terminal_settlement_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
  IF OLD.settlement_status IN ('PAID','RECEIVED') THEN RAISE EXCEPTION 'OPS_TERMINAL'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER partner_ops_facts_cancelled_guard BEFORE INSERT ON public.partner_tracking_facts FOR EACH ROW EXECUTE FUNCTION public.partner_ops_fact_guard();
CREATE TRIGGER partner_ops_invoice_cancelled_guard BEFORE INSERT OR UPDATE ON public.partner_job_invoices FOR EACH ROW EXECUTE FUNCTION public.partner_ops_guard_cancelled();
CREATE TRIGGER partner_ops_settlement_cancelled_guard BEFORE INSERT OR UPDATE ON public.partner_job_settlements FOR EACH ROW EXECUTE FUNCTION public.partner_ops_guard_cancelled();
CREATE TRIGGER partner_ops_settlement_terminal_guard BEFORE UPDATE ON public.partner_job_settlements FOR EACH ROW EXECUTE FUNCTION public.partner_ops_terminal_settlement_guard();
CREATE OR REPLACE FUNCTION public.partner_ops_invoice_terminal_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN IF EXISTS(SELECT 1 FROM public.partner_job_settlements s WHERE s.company_id=NEW.company_id AND s.job_id=NEW.job_id AND s.settlement_status IN('PAID','RECEIVED')) THEN RAISE EXCEPTION 'OPS_TERMINAL'; END IF; RETURN NEW; END $$;
CREATE TRIGGER partner_ops_invoice_terminal_guard BEFORE INSERT OR UPDATE ON public.partner_job_invoices FOR EACH ROW EXECUTE FUNCTION public.partner_ops_invoice_terminal_guard();

-- All publicly callable functions lock and revalidate the session-derived actor.
CREATE OR REPLACE FUNCTION public.partner_ops_authorize(actor text, required text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
  PERFORM 1 FROM public.partner_users WHERE id=actor AND principal_type='INTERNAL' AND company_id IS NULL AND disabled_at IS NULL
    AND (ops_role='ADMIN' OR (required='VIEWER' AND ops_role IN ('OPERATIONS','FINANCE','VIEWER')) OR (required='OPERATIONS' AND ops_role='OPERATIONS') OR (required='FINANCE' AND ops_role='FINANCE') OR (required='INVOICE' AND ops_role IN ('OPERATIONS','FINANCE'))) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OPS_FORBIDDEN'; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.partner_ops_dashboard(actor text) RETURNS TABLE(job_id uuid,company_id uuid,company_name text,customer_name text,client_reference text,submission_state text,billing_model text,latest_milestone text,settlement_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
  PERFORM public.partner_ops_authorize(actor,'VIEWER');
  RETURN QUERY SELECT j.id,j.company_id,c.name::text,j.customer_name::text,j.client_reference::text,j.submission_state::text,j.billing_model_snapshot::text,
    (SELECT f.fact_type::text FROM public.partner_tracking_facts f WHERE f.company_id=j.company_id AND f.job_id=j.id ORDER BY f.recorded_at DESC,f.id DESC LIMIT 1),s.settlement_status::text
  FROM public.partner_jobs j JOIN public.partner_companies c ON c.id=j.company_id LEFT JOIN public.partner_job_settlements s ON(s.company_id,s.job_id)=(j.company_id,j.id)
  ORDER BY j.updated_at DESC,j.id;
END $$;
CREATE OR REPLACE FUNCTION public.partner_ops_company_list(actor text) RETURNS TABLE(id uuid,slug text,name text,billing_model text,is_active boolean,revision integer,quote_defaults_revision integer,wall_rate_cents bigint,ceiling_rate_cents bigint,deposit_basis_points integer,consent_fee_cents bigint,extras jsonb) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN PERFORM public.partner_ops_authorize(actor,'VIEWER'); RETURN QUERY SELECT c.id,c.slug,c.name,c.billing_model,c.is_active,c.revision,c.quote_defaults_revision,c.quote_default_wall_rate_cents::bigint,c.quote_default_ceiling_rate_cents::bigint,c.quote_default_deposit_basis_points,c.quote_default_consent_fee_cents::bigint,c.quote_default_extras FROM public.partner_companies c ORDER BY c.name,c.id; END $$;
CREATE OR REPLACE FUNCTION public.partner_ops_job_detail(actor text,target_job uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN PERFORM public.partner_ops_authorize(actor,'VIEWER'); RETURN (SELECT jsonb_build_object('id',j.id,'companyId',j.company_id,'clientReference',j.client_reference,'customerName',j.customer_name,'siteAddress',j.site_address,'submissionState',j.submission_state,'billingModel',j.billing_model_snapshot,'revision',j.revision,'milestones',COALESCE((SELECT jsonb_object_agg(f.fact_type,jsonb_strip_nulls(jsonb_build_object('recordedAt',f.recorded_at,'effectiveAt',f.effective_at,'installDate',f.install_date))) FROM (SELECT DISTINCT ON(fact_type) * FROM public.partner_tracking_facts WHERE company_id=j.company_id AND job_id=j.id ORDER BY fact_type,recorded_at DESC,id DESC) f),'{}'::jsonb),'amendments',COALESCE((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('sequence',a.sequence,'description',a.patch->>'description','contractDeltaCents',a.patch->'contractDeltaCents','createdAt',a.created_at)) ORDER BY a.sequence) FROM public.partner_job_amendments a WHERE a.company_id=j.company_id AND a.job_id=j.id),'[]'::jsonb),'invoice',(SELECT jsonb_build_object('reference',i.reference,'amountCents',i.amount_cents,'sentAt',i.sent_at,'revision',i.revision) FROM public.partner_job_invoices i WHERE i.company_id=j.company_id AND i.job_id=j.id),'settlement',(SELECT jsonb_build_object('grossCents',s.gross_cents,'commissionCents',COALESCE(s.manual_commission_cents,s.retained_margin_cents),'netDueCents',s.net_due_cents,'status',s.settlement_status,'settledAt',s.settled_at,'revision',s.revision) FROM public.partner_job_settlements s WHERE s.company_id=j.company_id AND s.job_id=j.id)) FROM public.partner_jobs j WHERE j.id=target_job); END $$;
CREATE OR REPLACE FUNCTION public.partner_ops_partner_user_create(actor text,target_company uuid,target_id text,target_name text,target_email text,target_password_hash text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN PERFORM public.partner_ops_authorize(actor,'ADMIN'); INSERT INTO public.partner_users(id,company_id,principal_type,name,email) VALUES(target_id,target_company,'PARTNER',target_name,target_email); INSERT INTO public.partner_accounts(id,account_id,provider_id,user_id,password) VALUES(public.gen_random_uuid()::text,target_id,'credential',target_id,target_password_hash); INSERT INTO public.partner_audit_events(event_type,actor_user_id,subject_user_id,company_id,metadata) VALUES('OPS_PARTNER_USER_PROVISIONED',actor,target_id,target_company,'{}'::jsonb); RETURN true; END $$;
CREATE OR REPLACE FUNCTION public.partner_ops_partner_user_disable(actor text,target_company uuid,target_user text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN PERFORM public.partner_ops_authorize(actor,'ADMIN'); UPDATE public.partner_users SET disabled_at=now(),updated_at=now() WHERE id=target_user AND company_id=target_company AND principal_type='PARTNER' AND disabled_at IS NULL; IF NOT FOUND THEN RETURN false; END IF; DELETE FROM public.partner_sessions WHERE user_id=target_user; INSERT INTO public.partner_audit_events(event_type,actor_user_id,subject_user_id,company_id,metadata) VALUES('USER_DISABLED',actor,target_user,target_company,'{}'::jsonb),('SESSIONS_REVOKED',actor,target_user,target_company,'{}'::jsonb); RETURN true; END $$;
CREATE OR REPLACE FUNCTION public.partner_ops_fact_append(actor text,target_company uuid,target_job uuid,target_fact text,target_at timestamptz) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE state text; next_recorded timestamptz; BEGIN PERFORM public.partner_ops_authorize(actor,'OPERATIONS'); IF target_fact NOT IN('EBA_COMPLETED','INSTALL_DATE_SET','JOB_COMPLETED','CANCELLED') THEN RAISE EXCEPTION 'OPS_FORBIDDEN'; END IF; SELECT submission_state INTO state FROM public.partner_jobs WHERE company_id=target_company AND id=target_job FOR UPDATE; IF state IS NULL OR state NOT IN('SUBMITTED','RECONCILIATION_REQUIRED') THEN RAISE EXCEPTION 'OPS_JOB_NOT_ACTIONABLE'; END IF; SELECT GREATEST(clock_timestamp(),COALESCE(max(recorded_at)+interval '1 microsecond',clock_timestamp())) INTO next_recorded FROM public.partner_tracking_facts WHERE company_id=target_company AND job_id=target_job; IF EXISTS(SELECT 1 FROM public.partner_tracking_facts WHERE company_id=target_company AND job_id=target_job AND fact_type='CANCELLED') THEN RAISE EXCEPTION 'OPS_JOB_NOT_ACTIONABLE'; END IF; IF target_fact<>'INSTALL_DATE_SET' AND EXISTS(SELECT 1 FROM public.partner_tracking_facts WHERE company_id=target_company AND job_id=target_job AND fact_type=target_fact) THEN RAISE EXCEPTION 'OPS_DUPLICATE_FACT'; END IF; IF target_fact='INSTALL_DATE_SET' THEN INSERT INTO public.partner_tracking_facts(company_id,job_id,fact_type,value_type,source,install_date,recorded_by_user_id,recorded_at) VALUES(target_company,target_job,target_fact,'DATE','LOCAL_INTERNAL',(target_at AT TIME ZONE 'UTC')::date,actor,next_recorded); ELSE INSERT INTO public.partner_tracking_facts(company_id,job_id,fact_type,value_type,value,source,effective_at,recorded_by_user_id,recorded_at) VALUES(target_company,target_job,target_fact,'BOOLEAN','true'::jsonb,'LOCAL_INTERNAL',target_at,actor,next_recorded); END IF; INSERT INTO public.partner_audit_events(event_type,actor_user_id,company_id,job_id,metadata) VALUES('OPS_FACT_RECORDED',actor,target_company,target_job,'{}'::jsonb); RETURN true; END $$;
CREATE OR REPLACE FUNCTION public.partner_ops_amendment_append(actor text,target_company uuid,target_job uuid,target_patch jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE next_sequence integer; job_state text; BEGIN PERFORM public.partner_ops_authorize(actor,'OPERATIONS'); SELECT submission_state INTO job_state FROM public.partner_jobs WHERE company_id=target_company AND id=target_job FOR UPDATE; IF job_state IS NULL OR job_state NOT IN('SUBMITTED','RECONCILIATION_REQUIRED') THEN RAISE EXCEPTION 'OPS_JOB_NOT_ACTIONABLE'; END IF; SELECT COALESCE(max(sequence),0)+1 INTO next_sequence FROM public.partner_job_amendments WHERE company_id=target_company AND job_id=target_job; INSERT INTO public.partner_job_amendments(company_id,job_id,sequence,reason,patch,created_by_user_id) VALUES(target_company,target_job,next_sequence,target_patch->>'description',target_patch,actor); INSERT INTO public.partner_audit_events(event_type,actor_user_id,company_id,job_id,metadata) VALUES('OPS_AMENDMENT_RECORDED',actor,target_company,target_job,'{}'::jsonb); RETURN true; END $$;
CREATE OR REPLACE FUNCTION public.partner_ops_invoice_upsert(actor text,target_company uuid,target_job uuid,target_revision integer,target_reference text,target_amount bigint,target_sent timestamptz) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE next_recorded timestamptz; BEGIN PERFORM public.partner_ops_authorize(actor,'INVOICE'); PERFORM 1 FROM public.partner_jobs WHERE company_id=target_company AND id=target_job FOR UPDATE; IF NOT EXISTS(SELECT 1 FROM public.partner_jobs WHERE company_id=target_company AND id=target_job AND submission_state IN('SUBMITTED','RECONCILIATION_REQUIRED')) OR EXISTS(SELECT 1 FROM public.partner_tracking_facts WHERE company_id=target_company AND job_id=target_job AND fact_type='CANCELLED') THEN RAISE EXCEPTION 'OPS_JOB_NOT_ACTIONABLE'; END IF; SELECT GREATEST(clock_timestamp(),COALESCE(max(recorded_at)+interval '1 microsecond',clock_timestamp())) INTO next_recorded FROM public.partner_tracking_facts WHERE company_id=target_company AND job_id=target_job; IF target_revision<>0 AND NOT EXISTS(SELECT 1 FROM public.partner_job_invoices WHERE company_id=target_company AND job_id=target_job) THEN RAISE EXCEPTION 'OPS_STALE_REVISION'; END IF; IF EXISTS(SELECT 1 FROM public.partner_job_settlements WHERE company_id=target_company AND job_id=target_job AND settlement_status IN('PAID','RECEIVED')) THEN RAISE EXCEPTION 'OPS_TERMINAL'; END IF; INSERT INTO public.partner_job_invoices(company_id,job_id,reference,amount_cents,sent_at,revision,created_by_user_id,updated_by_user_id) VALUES(target_company,target_job,target_reference,target_amount,target_sent,0,actor,actor) ON CONFLICT(company_id,job_id) DO UPDATE SET reference=excluded.reference,amount_cents=excluded.amount_cents,sent_at=excluded.sent_at,revision=public.partner_job_invoices.revision+1,updated_by_user_id=actor,updated_at=now() WHERE public.partner_job_invoices.revision=target_revision; IF NOT FOUND THEN RETURN false; END IF; INSERT INTO public.partner_tracking_facts(company_id,job_id,fact_type,value_type,value,source,effective_at,recorded_by_user_id,recorded_at) VALUES(target_company,target_job,'INVOICE_SENT','BOOLEAN','true'::jsonb,'LOCAL_INTERNAL',target_sent,actor,next_recorded); INSERT INTO public.partner_audit_events(event_type,actor_user_id,company_id,job_id,metadata) VALUES('OPS_INVOICE_RECORDED',actor,target_company,target_job,'{}'::jsonb); RETURN true; END $$;
CREATE OR REPLACE FUNCTION public.partner_ops_settlement_upsert(actor text,target_company uuid,target_job uuid,target_revision integer,target_gross bigint,target_commission bigint,target_status text,target_settled timestamptz) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE model text; invoice_amount bigint; terminal_fact text; next_recorded timestamptz; BEGIN
  PERFORM public.partner_ops_authorize(actor,'FINANCE');
  SELECT j.billing_model_snapshot,i.amount_cents INTO model,invoice_amount FROM public.partner_jobs j JOIN public.partner_job_invoices i ON(i.company_id,i.job_id)=(j.company_id,j.id) WHERE j.company_id=target_company AND j.id=target_job AND j.submission_state IN('SUBMITTED','RECONCILIATION_REQUIRED') FOR UPDATE;
  IF model IS NULL OR invoice_amount IS NULL OR invoice_amount<>target_gross THEN RAISE EXCEPTION 'OPS_INVOICE_REQUIRED'; END IF;
  SELECT GREATEST(clock_timestamp(),COALESCE(max(recorded_at)+interval '1 microsecond',clock_timestamp())) INTO next_recorded FROM public.partner_tracking_facts WHERE company_id=target_company AND job_id=target_job;
  IF EXISTS(SELECT 1 FROM public.partner_tracking_facts WHERE company_id=target_company AND job_id=target_job AND fact_type='CANCELLED') THEN RAISE EXCEPTION 'OPS_JOB_NOT_ACTIONABLE'; END IF;
  IF (model='INSULHUB_BILLED' AND target_status NOT IN('PENDING','PAID')) OR (model='PARTNER_BILLED' AND target_status NOT IN('PENDING','RECEIVED')) THEN RAISE EXCEPTION 'OPS_INVALID_SETTLEMENT'; END IF;
  IF EXISTS(SELECT 1 FROM public.partner_job_settlements WHERE company_id=target_company AND job_id=target_job AND settlement_status IN('PAID','RECEIVED')) THEN RAISE EXCEPTION 'OPS_TERMINAL'; END IF;
  IF target_revision<>0 AND NOT EXISTS(SELECT 1 FROM public.partner_job_settlements WHERE company_id=target_company AND job_id=target_job) THEN RAISE EXCEPTION 'OPS_STALE_REVISION'; END IF;
  INSERT INTO public.partner_job_settlements(company_id,job_id,billing_model_snapshot,gross_cents,manual_commission_cents,retained_margin_cents,net_due_cents,settlement_status,settled_at,revision,created_by_user_id) VALUES(target_company,target_job,model,target_gross,CASE WHEN model='INSULHUB_BILLED' THEN target_commission END,CASE WHEN model='PARTNER_BILLED' THEN target_commission END,CASE WHEN model='INSULHUB_BILLED' THEN target_commission ELSE target_gross-target_commission END,target_status,target_settled,0,actor) ON CONFLICT(company_id,job_id) DO UPDATE SET gross_cents=excluded.gross_cents,manual_commission_cents=excluded.manual_commission_cents,retained_margin_cents=excluded.retained_margin_cents,net_due_cents=excluded.net_due_cents,settlement_status=excluded.settlement_status,settled_at=excluded.settled_at,revision=public.partner_job_settlements.revision+1,updated_at=now() WHERE public.partner_job_settlements.revision=target_revision;
  IF NOT FOUND THEN RETURN false; END IF;
  IF target_status IN('PAID','RECEIVED') THEN terminal_fact:=CASE WHEN target_status='PAID' THEN 'COMMISSION_PAID' ELSE 'REMITTANCE_RECEIVED' END; INSERT INTO public.partner_tracking_facts(company_id,job_id,fact_type,value_type,value,source,effective_at,recorded_by_user_id,recorded_at) VALUES(target_company,target_job,terminal_fact,'BOOLEAN','true'::jsonb,'LOCAL_INTERNAL',target_settled,actor,next_recorded); END IF;
  INSERT INTO public.partner_audit_events(event_type,actor_user_id,company_id,job_id,metadata) VALUES('OPS_SETTLEMENT_RECORDED',actor,target_company,target_job,'{}'::jsonb); RETURN true;
END $$;
CREATE OR REPLACE FUNCTION public.partner_partner_tracking_projection(actor text,target_company uuid,target_job uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
  PERFORM 1 FROM public.partner_users u JOIN public.partner_companies c ON c.id=u.company_id AND c.is_active=true WHERE u.id=actor AND u.company_id=target_company AND u.principal_type='PARTNER' AND u.disabled_at IS NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN (SELECT jsonb_build_object('id',j.id,'clientReference',j.client_reference,'billingModel',j.billing_model_snapshot,'milestones',COALESCE((SELECT jsonb_object_agg(f.fact_type,jsonb_strip_nulls(jsonb_build_object('recordedAt',f.recorded_at,'effectiveAt',f.effective_at,'installDate',f.install_date))) FROM (SELECT DISTINCT ON(fact_type) * FROM public.partner_tracking_facts WHERE company_id=j.company_id AND job_id=j.id ORDER BY fact_type,recorded_at DESC,id DESC) f),'{}'::jsonb),'amendments',COALESCE((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('sequence',a.sequence,'description',a.patch->>'description','contractDeltaCents',a.patch->'contractDeltaCents','createdAt',a.created_at)) ORDER BY a.sequence) FROM public.partner_job_amendments a WHERE a.company_id=j.company_id AND a.job_id=j.id),'[]'::jsonb),'invoice',(SELECT jsonb_build_object('reference',i.reference,'amountCents',i.amount_cents,'sentAt',i.sent_at,'revision',i.revision) FROM public.partner_job_invoices i WHERE i.company_id=j.company_id AND i.job_id=j.id),'settlement',(SELECT jsonb_build_object('grossCents',s.gross_cents,'commissionCents',COALESCE(s.manual_commission_cents,s.retained_margin_cents),'netDueCents',s.net_due_cents,'status',s.settlement_status,'settledAt',s.settled_at,'revision',s.revision) FROM public.partner_job_settlements s WHERE s.company_id=target_company AND s.job_id=target_job)) FROM public.partner_jobs j WHERE j.company_id=target_company AND j.id=target_job);
END $$;
CREATE OR REPLACE FUNCTION public.partner_ops_company_create_full(actor text,target_slug text,target_name text,target_billing text,target_defaults jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE result uuid; BEGIN PERFORM public.partner_ops_authorize(actor,'ADMIN'); INSERT INTO public.partner_companies(slug,name,billing_model,quote_default_wall_rate_cents,quote_default_ceiling_rate_cents,quote_default_deposit_basis_points,quote_default_consent_fee_cents,quote_default_extras) VALUES(target_slug,target_name,target_billing,(target_defaults->>'wallRateCents')::bigint,(target_defaults->>'ceilingRateCents')::bigint,(target_defaults->>'depositBasisPoints')::integer,(target_defaults->>'consentFeeCents')::bigint,COALESCE(target_defaults->'extras','[]'::jsonb)) RETURNING id INTO result; INSERT INTO public.partner_audit_events(event_type,actor_user_id,company_id,metadata) VALUES('OPS_COMPANY_CREATED',actor,result,'{}'::jsonb); RETURN result; END $$;
CREATE OR REPLACE FUNCTION public.partner_ops_company_update_full(actor text,target_company uuid,target_revision integer,target_slug text,target_name text,target_billing text,target_defaults jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN PERFORM public.partner_ops_authorize(actor,'ADMIN'); UPDATE public.partner_companies SET name=target_name,billing_model=target_billing,quote_default_wall_rate_cents=(target_defaults->>'wallRateCents')::bigint,quote_default_ceiling_rate_cents=(target_defaults->>'ceilingRateCents')::bigint,quote_default_deposit_basis_points=(target_defaults->>'depositBasisPoints')::integer,quote_default_consent_fee_cents=(target_defaults->>'consentFeeCents')::bigint,quote_default_extras=COALESCE(target_defaults->'extras','[]'::jsonb),revision=revision+1,quote_defaults_revision=quote_defaults_revision+1,updated_at=now() WHERE id=target_company AND slug=target_slug AND revision=target_revision; IF FOUND THEN INSERT INTO public.partner_audit_events(event_type,actor_user_id,company_id,metadata) VALUES('OPS_COMPANY_UPDATED',actor,target_company,'{}'::jsonb); END IF; RETURN FOUND; END $$;
CREATE OR REPLACE FUNCTION public.partner_ops_partner_user_list(actor text,target_company uuid) RETURNS TABLE(id text,name text,email text,disabled_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN PERFORM public.partner_ops_authorize(actor,'ADMIN'); RETURN QUERY SELECT u.id,u.name,u.email,u.disabled_at FROM public.partner_users u WHERE u.company_id=target_company AND u.principal_type='PARTNER' ORDER BY u.email; END $$;

-- PostgreSQL requires CREATE on the schema while ownership is transferred.
GRANT CREATE ON SCHEMA public TO partner_ops_owner;
ALTER FUNCTION public.partner_ops_cancelled(uuid,uuid) OWNER TO partner_ops_owner;
ALTER FUNCTION public.partner_ops_audit_guard() OWNER TO partner_ops_owner;
ALTER FUNCTION public.partner_ops_guard_cancelled() OWNER TO partner_ops_owner;
ALTER FUNCTION public.partner_ops_fact_guard() OWNER TO partner_ops_owner;
ALTER FUNCTION public.partner_ops_terminal_settlement_guard() OWNER TO partner_ops_owner;
ALTER FUNCTION public.partner_ops_invoice_terminal_guard() OWNER TO partner_ops_owner;
ALTER FUNCTION public.partner_ops_authorize(text,text) OWNER TO partner_ops_owner;
ALTER FUNCTION public.partner_ops_dashboard(text) OWNER TO partner_ops_owner;
ALTER FUNCTION public.partner_ops_company_list(text) OWNER TO partner_ops_owner;
ALTER FUNCTION public.partner_ops_job_detail(text,uuid) OWNER TO partner_ops_owner;
ALTER FUNCTION public.partner_ops_partner_user_create(text,uuid,text,text,text,text) OWNER TO partner_ops_owner;
ALTER FUNCTION public.partner_ops_partner_user_disable(text,uuid,text) OWNER TO partner_ops_owner;
ALTER FUNCTION public.partner_ops_fact_append(text,uuid,uuid,text,timestamptz) OWNER TO partner_ops_owner;
ALTER FUNCTION public.partner_ops_amendment_append(text,uuid,uuid,jsonb) OWNER TO partner_ops_owner;
ALTER FUNCTION public.partner_ops_invoice_upsert(text,uuid,uuid,integer,text,bigint,timestamptz) OWNER TO partner_ops_owner;
ALTER FUNCTION public.partner_ops_settlement_upsert(text,uuid,uuid,integer,bigint,bigint,text,timestamptz) OWNER TO partner_ops_owner;
ALTER FUNCTION public.partner_partner_tracking_projection(text,uuid,uuid) OWNER TO partner_ops_owner;
ALTER FUNCTION public.partner_ops_company_create_full(text,text,text,text,jsonb) OWNER TO partner_ops_owner;
ALTER FUNCTION public.partner_ops_company_update_full(text,uuid,integer,text,text,text,jsonb) OWNER TO partner_ops_owner;
ALTER FUNCTION public.partner_ops_partner_user_list(text,uuid) OWNER TO partner_ops_owner;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM partner_ops_runtime;
REVOKE UPDATE ON public.partner_users FROM partner_portal_runtime;
GRANT UPDATE(name,email,email_verified,image,updated_at) ON public.partner_users TO partner_portal_runtime;
REVOKE ALL ON FUNCTION public.partner_ops_authorize(text,text),public.partner_ops_dashboard(text),public.partner_ops_company_list(text),public.partner_ops_job_detail(text,uuid),public.partner_ops_company_create_full(text,text,text,text,jsonb),public.partner_ops_company_update_full(text,uuid,integer,text,text,text,jsonb),public.partner_ops_partner_user_list(text,uuid),public.partner_ops_partner_user_create(text,uuid,text,text,text,text),public.partner_ops_partner_user_disable(text,uuid,text),public.partner_ops_fact_append(text,uuid,uuid,text,timestamptz),public.partner_ops_amendment_append(text,uuid,uuid,jsonb),public.partner_ops_invoice_upsert(text,uuid,uuid,integer,text,bigint,timestamptz),public.partner_ops_settlement_upsert(text,uuid,uuid,integer,bigint,bigint,text,timestamptz),public.partner_partner_tracking_projection(text,uuid,uuid),public.partner_ops_cancelled(uuid,uuid),public.partner_ops_audit_guard(),public.partner_ops_guard_cancelled(),public.partner_ops_fact_guard(),public.partner_ops_terminal_settlement_guard(),public.partner_ops_invoice_terminal_guard() FROM PUBLIC,partner_portal_runtime,partner_submission_worker;
REVOKE CREATE ON SCHEMA public FROM partner_ops_owner;
GRANT USAGE ON SCHEMA public TO partner_ops_runtime,partner_ops_owner;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.partner_companies,public.partner_users,public.partner_accounts,public.partner_sessions,public.partner_jobs,public.partner_tracking_facts,public.partner_job_amendments,public.partner_job_invoices,public.partner_job_settlements,public.partner_audit_events TO partner_ops_owner;
GRANT EXECUTE ON FUNCTION public.partner_ops_dashboard(text),public.partner_ops_company_list(text),public.partner_ops_job_detail(text,uuid) TO partner_ops_runtime;
GRANT EXECUTE ON FUNCTION public.partner_ops_partner_user_create(text,uuid,text,text,text,text),public.partner_ops_partner_user_disable(text,uuid,text),public.partner_ops_fact_append(text,uuid,uuid,text,timestamptz),public.partner_ops_amendment_append(text,uuid,uuid,jsonb),public.partner_ops_invoice_upsert(text,uuid,uuid,integer,text,bigint,timestamptz),public.partner_ops_settlement_upsert(text,uuid,uuid,integer,bigint,bigint,text,timestamptz) TO partner_ops_runtime;
GRANT EXECUTE ON FUNCTION public.partner_partner_tracking_projection(text,uuid,uuid) TO partner_portal_runtime;
GRANT EXECUTE ON FUNCTION public.partner_ops_company_create_full(text,text,text,text,jsonb),public.partner_ops_company_update_full(text,uuid,integer,text,text,text,jsonb),public.partner_ops_partner_user_list(text,uuid) TO partner_ops_runtime;
COMMIT;
