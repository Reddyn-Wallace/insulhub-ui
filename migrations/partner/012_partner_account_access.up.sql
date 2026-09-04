BEGIN;
-- Temporarily provide the non-superuser migrator's new function owner with CREATE.
-- SET LOCAL state is transaction-bound; preserve pre-existing role membership.
DO $$ BEGIN
  PERFORM set_config('partner_access.added_owner_membership',
    CASE WHEN pg_has_role(current_user,'partner_ops_owner','USAGE') THEN 'false' ELSE 'true' END, true);
  IF NOT pg_has_role(current_user,'partner_ops_owner','USAGE') THEN
    EXECUTE format('GRANT partner_ops_owner TO %I WITH INHERIT TRUE, SET TRUE',current_user);
  END IF;
  GRANT CREATE ON SCHEMA public TO partner_ops_owner;
END $$;
ALTER TABLE public.partner_users ADD COLUMN invitation_pending boolean NOT NULL DEFAULT false,
  ADD COLUMN password_version integer NOT NULL DEFAULT 0 CHECK(password_version>=0);
ALTER TABLE public.partner_sessions ADD COLUMN password_version integer NOT NULL DEFAULT 0 CHECK(password_version>=0);
CREATE TABLE public.partner_account_links (
  user_id text PRIMARY KEY,
  company_id uuid NOT NULL,
  token_hash varchar(64) NOT NULL UNIQUE CHECK(length(token_hash)=64),
  purpose text NOT NULL CHECK(purpose IN('INVITE','RESET')),
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  delivery_state text NOT NULL DEFAULT 'CREATED' CHECK(delivery_state IN('CREATED','ACCEPTED','UNCONFIRMED')),
  FOREIGN KEY(company_id,user_id) REFERENCES public.partner_users(company_id,id) ON DELETE CASCADE,
  CHECK(expires_at>issued_at)
);
CREATE TABLE public.partner_access_rate_limits (
  key_hash varchar(64) PRIMARY KEY CHECK(length(key_hash)=64),
  window_start timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 1 CHECK(attempts>0)
);
ALTER TABLE public.partner_audit_events DROP CONSTRAINT partner_audit_event_type;
ALTER TABLE public.partner_audit_events ADD CONSTRAINT partner_audit_event_type CHECK(event_type IN('ACCOUNT_LINK_ISSUED','ACCOUNT_EMAIL_ACCEPTED','ACCOUNT_EMAIL_UNCONFIRMED','ACCOUNT_PASSWORD_CHANGED','DRAFT_DELETED',
 'LOGIN_SUCCEEDED','LOGIN_FAILED','LOGOUT','USER_PROVISIONED','USER_DISABLED','SESSIONS_REVOKED','LEGACY_CREDENTIAL_REPLACED',
 'SUBMISSION_FROZEN','SUBMISSION_CLAIMED','SUBMISSION_PHASE_CHECKPOINTED','SUBMISSION_FINALIZED','SUBMISSION_FAILED_RETRYABLE','SUBMISSION_RECONCILIATION_REQUIRED',
 'SUBMISSION_EXECUTE_DISCARDED','SUBMISSION_NOTIFICATION_CLAIMED','SUBMISSION_NOTIFICATION_RELEASED','SUBMISSION_NOTIFICATION_DELIVERED','SUBMISSION_NOTIFICATION_DEAD',
 'OPS_COMPANY_CREATED','OPS_COMPANY_UPDATED','OPS_PARTNER_USER_PROVISIONED','OPS_FACT_RECORDED','OPS_AMENDMENT_RECORDED','OPS_INVOICE_RECORDED','OPS_SETTLEMENT_RECORDED'));
CREATE FUNCTION public.partner_access_rate_limit(target_key text,target_limit integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE attempts_count integer;
BEGIN
  IF target_key !~ '^[0-9a-f]{64}$' OR target_limit NOT BETWEEN 1 AND 30 THEN RETURN false; END IF;
  DELETE FROM public.partner_access_rate_limits WHERE window_start<now()-interval '1 day';
  INSERT INTO public.partner_access_rate_limits(key_hash) VALUES(target_key)
    ON CONFLICT(key_hash) DO UPDATE SET
      attempts=CASE WHEN partner_access_rate_limits.window_start<now()-interval '15 minutes' THEN 1 ELSE partner_access_rate_limits.attempts+1 END,
      window_start=CASE WHEN partner_access_rate_limits.window_start<now()-interval '15 minutes' THEN now() ELSE partner_access_rate_limits.window_start END
    RETURNING attempts INTO attempts_count;
  RETURN attempts_count<=target_limit;
END $$;
CREATE FUNCTION public.partner_access_store_link(target_user text,target_company uuid,target_hash text,target_purpose text,actor text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF target_hash !~ '^[0-9a-f]{64}$' OR target_purpose NOT IN('INVITE','RESET') THEN RAISE EXCEPTION 'ACCESS_INVALID'; END IF;
  IF EXISTS(SELECT 1 FROM public.partner_account_links WHERE user_id=target_user AND issued_at>now()-interval '60 seconds') THEN RETURN false; END IF;
  INSERT INTO public.partner_account_links(user_id,company_id,token_hash,purpose,expires_at)
    VALUES(target_user,target_company,target_hash,target_purpose,now()+CASE WHEN target_purpose='INVITE' THEN interval '48 hours' ELSE interval '1 hour' END)
    ON CONFLICT(user_id) DO UPDATE SET token_hash=EXCLUDED.token_hash,purpose=EXCLUDED.purpose,issued_at=now(),expires_at=EXCLUDED.expires_at,delivery_state='CREATED';
  INSERT INTO public.partner_audit_events(event_type,actor_user_id,subject_user_id,company_id,metadata)
    VALUES('ACCOUNT_LINK_ISSUED',actor,target_user,target_company,jsonb_build_object('reason',target_purpose));
  RETURN true;
END $$;
CREATE FUNCTION public.partner_ops_access_invite(actor text,target_company uuid,target_name text,target_email text,target_hash text)
RETURNS TABLE(user_id text,email text,name text,company_name text,purpose text,issued boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u public.partner_users; company_name_value text; was_issued boolean;
BEGIN
  PERFORM public.partner_ops_authorize(actor,'ADMIN');
  SELECT c.name INTO company_name_value FROM public.partner_companies c WHERE c.id=target_company AND c.is_active=true FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF length(btrim(target_name)) NOT BETWEEN 1 AND 160 OR length(target_email)>320 OR target_email<>lower(target_email) OR target_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' THEN RAISE EXCEPTION 'ACCESS_INVALID'; END IF;
  SELECT * INTO u FROM public.partner_users p WHERE p.email=target_email FOR UPDATE;
  IF FOUND THEN
    IF u.company_id IS DISTINCT FROM target_company OR u.principal_type<>'PARTNER' OR u.disabled_at IS NOT NULL OR NOT u.invitation_pending OR u.name<>btrim(target_name) THEN RAISE EXCEPTION 'ACCESS_EXISTS'; END IF;
  ELSE
    INSERT INTO public.partner_users(id,company_id,principal_type,name,email,email_verified,invitation_pending)
      VALUES(public.gen_random_uuid()::text,target_company,'PARTNER',btrim(target_name),target_email,false,true) RETURNING * INTO u;
    INSERT INTO public.partner_audit_events(event_type,actor_user_id,subject_user_id,company_id,metadata)
      VALUES('OPS_PARTNER_USER_PROVISIONED',actor,u.id,target_company,'{}'::jsonb);
  END IF;
  was_issued:=public.partner_access_store_link(u.id,target_company,target_hash,'INVITE',actor);
  RETURN QUERY SELECT u.id,u.email,u.name,company_name_value,'INVITE'::text,was_issued;
END $$;
CREATE FUNCTION public.partner_ops_access_issue(actor text,target_company uuid,target_user text,target_purpose text,target_hash text)
RETURNS TABLE(user_id text,email text,name text,company_name text,purpose text,issued boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u public.partner_users; company_name_value text; was_issued boolean;
BEGIN
  PERFORM public.partner_ops_authorize(actor,'ADMIN');
  SELECT c.name INTO company_name_value FROM public.partner_companies c WHERE c.id=target_company AND c.is_active=true FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO u FROM public.partner_users p WHERE p.id=target_user AND p.company_id=target_company AND p.principal_type='PARTNER' AND p.disabled_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF target_purpose NOT IN('INVITE','RESET') OR (target_purpose='INVITE' AND NOT u.invitation_pending) THEN RAISE EXCEPTION 'ACCESS_INVALID'; END IF;
  was_issued:=public.partner_access_store_link(u.id,target_company,target_hash,target_purpose,actor);
  RETURN QUERY SELECT u.id,u.email,u.name,company_name_value,target_purpose,was_issued;
END $$;
CREATE FUNCTION public.partner_access_request_reset(target_email text,target_hash text)
RETURNS TABLE(user_id text,email text,name text,company_name text,purpose text,issued boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u public.partner_users; company_id_value uuid; company_name_value text; was_issued boolean; kind text;
BEGIN
  SELECT p.company_id INTO company_id_value FROM public.partner_users p WHERE p.email=target_email AND p.principal_type='PARTNER';
  IF NOT FOUND THEN RETURN; END IF;
  SELECT c.name INTO company_name_value FROM public.partner_companies c WHERE c.id=company_id_value AND c.is_active=true FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO u FROM public.partner_users p WHERE p.email=target_email AND p.company_id=company_id_value AND p.principal_type='PARTNER' AND p.disabled_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  kind:=CASE WHEN u.invitation_pending THEN 'INVITE' ELSE 'RESET' END;
  was_issued:=public.partner_access_store_link(u.id,company_id_value,target_hash,kind,NULL);
  RETURN QUERY SELECT u.id,u.email,u.name,company_name_value,kind,was_issued;
END $$;
CREATE FUNCTION public.partner_access_apply_password(target_user text,target_company uuid,target_password_hash text,actor text,verified boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF target_password_hash !~ '^[0-9a-f]{32}:[0-9a-f]{128}$' THEN RAISE EXCEPTION 'ACCESS_INVALID'; END IF;
  INSERT INTO public.partner_accounts(id,account_id,provider_id,user_id,password)
    VALUES(public.gen_random_uuid()::text,target_user,'credential',target_user,target_password_hash)
    ON CONFLICT(provider_id,account_id) DO UPDATE SET password=EXCLUDED.password,updated_at=now();
  UPDATE public.partner_users SET invitation_pending=false,password_version=password_version+1,
    email_verified=CASE WHEN verified THEN true ELSE email_verified END,updated_at=now() WHERE id=target_user;
  DELETE FROM public.partner_account_links WHERE user_id=target_user;
  DELETE FROM public.partner_sessions WHERE user_id=target_user;
  INSERT INTO public.partner_audit_events(event_type,actor_user_id,subject_user_id,company_id,metadata)
    VALUES('ACCOUNT_PASSWORD_CHANGED',actor,target_user,target_company,jsonb_build_object('reason',CASE WHEN verified THEN 'LINK' ELSE 'STAFF_OVERRIDE' END));
  INSERT INTO public.partner_audit_events(event_type,actor_user_id,subject_user_id,company_id,metadata)
    VALUES('SESSIONS_REVOKED',actor,target_user,target_company,'{"reason":"password_changed"}'::jsonb);
END $$;
CREATE FUNCTION public.partner_ops_access_password(actor text,target_company uuid,target_user text,target_password_hash text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM public.partner_ops_authorize(actor,'ADMIN');
  PERFORM c.id FROM public.partner_companies c WHERE c.id=target_company AND c.is_active=true FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM p.id FROM public.partner_users p WHERE p.id=target_user AND p.company_id=target_company AND p.principal_type='PARTNER' AND p.disabled_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM public.partner_access_apply_password(target_user,target_company,target_password_hash,actor,false);
  RETURN true;
END $$;
CREATE FUNCTION public.partner_access_complete(target_hash text,target_password_hash text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE link public.partner_account_links;
BEGIN
  SELECT * INTO link FROM public.partner_account_links l WHERE l.token_hash=target_hash;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM c.id FROM public.partner_companies c WHERE c.id=link.company_id AND c.is_active=true FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM p.id FROM public.partner_users p WHERE p.id=link.user_id AND p.company_id=link.company_id AND p.principal_type='PARTNER' AND p.disabled_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO link FROM public.partner_account_links l WHERE l.token_hash=target_hash AND l.expires_at>now() FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM public.partner_access_apply_password(link.user_id,link.company_id,target_password_hash,NULL,true);
  RETURN true;
END $$;
CREATE FUNCTION public.partner_access_email_result(target_hash text,accepted boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE link public.partner_account_links;
BEGIN
  UPDATE public.partner_account_links SET delivery_state=CASE WHEN accepted THEN 'ACCEPTED' ELSE 'UNCONFIRMED' END
    WHERE token_hash=target_hash RETURNING * INTO link;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.partner_audit_events(event_type,subject_user_id,company_id,metadata)
    VALUES(CASE WHEN accepted THEN 'ACCOUNT_EMAIL_ACCEPTED' ELSE 'ACCOUNT_EMAIL_UNCONFIRMED' END,link.user_id,link.company_id,'{}'::jsonb);
  RETURN true;
END $$;
CREATE FUNCTION public.partner_ops_access_users(actor text,target_company uuid)
RETURNS TABLE(id text,invitation_pending boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM public.partner_ops_authorize(actor,'ADMIN');
  RETURN QUERY SELECT u.id,u.invitation_pending FROM public.partner_users u WHERE u.company_id=target_company AND u.principal_type='PARTNER';
END $$;
CREATE FUNCTION public.partner_access_session_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u public.partner_users;
BEGIN
  SELECT * INTO u FROM public.partner_users WHERE id=NEW.user_id FOR SHARE;
  IF NOT FOUND OR u.disabled_at IS NOT NULL OR u.invitation_pending OR u.password_version<>NEW.password_version THEN RAISE EXCEPTION 'ACCESS_SESSION_INVALID'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER partner_access_session_guard BEFORE INSERT ON public.partner_sessions FOR EACH ROW EXECUTE FUNCTION public.partner_access_session_guard();
CREATE FUNCTION public.partner_access_disable_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.disabled_at IS NOT NULL THEN DELETE FROM public.partner_account_links WHERE user_id=NEW.id; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER partner_access_disable_guard AFTER UPDATE OF disabled_at ON public.partner_users FOR EACH ROW EXECUTE FUNCTION public.partner_access_disable_guard();
GRANT SELECT,INSERT,UPDATE,DELETE ON public.partner_account_links,public.partner_access_rate_limits TO partner_ops_owner;
REVOKE ALL ON public.partner_account_links,public.partner_access_rate_limits FROM PUBLIC,partner_portal_runtime,partner_ops_runtime;
GRANT SELECT(invitation_pending,password_version) ON public.partner_users TO partner_portal_runtime;
GRANT SELECT,INSERT,UPDATE ON public.partner_sessions TO partner_portal_runtime;
ALTER FUNCTION public.partner_ops_access_invite(text,uuid,text,text,text) OWNER TO partner_ops_owner;
REVOKE ALL ON FUNCTION public.partner_ops_access_invite(text,uuid,text,text,text) FROM PUBLIC,partner_portal_runtime,partner_ops_runtime;
ALTER FUNCTION public.partner_ops_access_issue(text,uuid,text,text,text) OWNER TO partner_ops_owner;
REVOKE ALL ON FUNCTION public.partner_ops_access_issue(text,uuid,text,text,text) FROM PUBLIC,partner_portal_runtime,partner_ops_runtime;
ALTER FUNCTION public.partner_ops_access_password(text,uuid,text,text) OWNER TO partner_ops_owner;
REVOKE ALL ON FUNCTION public.partner_ops_access_password(text,uuid,text,text) FROM PUBLIC,partner_portal_runtime,partner_ops_runtime;
ALTER FUNCTION public.partner_ops_access_users(text,uuid) OWNER TO partner_ops_owner;
REVOKE ALL ON FUNCTION public.partner_ops_access_users(text,uuid) FROM PUBLIC,partner_portal_runtime,partner_ops_runtime;
ALTER FUNCTION public.partner_access_rate_limit(text,integer) OWNER TO partner_ops_owner;
REVOKE ALL ON FUNCTION public.partner_access_rate_limit(text,integer) FROM PUBLIC,partner_portal_runtime,partner_ops_runtime;
ALTER FUNCTION public.partner_access_request_reset(text,text) OWNER TO partner_ops_owner;
REVOKE ALL ON FUNCTION public.partner_access_request_reset(text,text) FROM PUBLIC,partner_portal_runtime,partner_ops_runtime;
ALTER FUNCTION public.partner_access_complete(text,text) OWNER TO partner_ops_owner;
REVOKE ALL ON FUNCTION public.partner_access_complete(text,text) FROM PUBLIC,partner_portal_runtime,partner_ops_runtime;
ALTER FUNCTION public.partner_access_email_result(text,boolean) OWNER TO partner_ops_owner;
REVOKE ALL ON FUNCTION public.partner_access_email_result(text,boolean) FROM PUBLIC,partner_portal_runtime,partner_ops_runtime;
ALTER FUNCTION public.partner_access_store_link(text,uuid,text,text,text) OWNER TO partner_ops_owner;
REVOKE ALL ON FUNCTION public.partner_access_store_link(text,uuid,text,text,text) FROM PUBLIC,partner_portal_runtime,partner_ops_runtime;
ALTER FUNCTION public.partner_access_apply_password(text,uuid,text,text,boolean) OWNER TO partner_ops_owner;
REVOKE ALL ON FUNCTION public.partner_access_apply_password(text,uuid,text,text,boolean) FROM PUBLIC,partner_portal_runtime,partner_ops_runtime;
ALTER FUNCTION public.partner_access_session_guard() OWNER TO partner_ops_owner;
REVOKE ALL ON FUNCTION public.partner_access_session_guard() FROM PUBLIC,partner_portal_runtime,partner_ops_runtime;
ALTER FUNCTION public.partner_access_disable_guard() OWNER TO partner_ops_owner;
REVOKE ALL ON FUNCTION public.partner_access_disable_guard() FROM PUBLIC,partner_portal_runtime,partner_ops_runtime;
GRANT EXECUTE ON FUNCTION public.partner_ops_access_invite(text,uuid,text,text,text) TO partner_ops_runtime;
GRANT EXECUTE ON FUNCTION public.partner_ops_access_issue(text,uuid,text,text,text) TO partner_ops_runtime;
GRANT EXECUTE ON FUNCTION public.partner_ops_access_password(text,uuid,text,text) TO partner_ops_runtime;
GRANT EXECUTE ON FUNCTION public.partner_ops_access_users(text,uuid) TO partner_ops_runtime;
GRANT EXECUTE ON FUNCTION public.partner_access_rate_limit(text,integer) TO partner_portal_runtime;
GRANT EXECUTE ON FUNCTION public.partner_access_request_reset(text,text) TO partner_portal_runtime;
GRANT EXECUTE ON FUNCTION public.partner_access_complete(text,text) TO partner_portal_runtime;
GRANT EXECUTE ON FUNCTION public.partner_access_email_result(text,boolean) TO partner_portal_runtime;
GRANT EXECUTE ON FUNCTION public.partner_access_rate_limit(text,integer),public.partner_access_email_result(text,boolean) TO partner_ops_runtime;
REVOKE CREATE ON SCHEMA public FROM partner_ops_owner;
DO $$ BEGIN
  IF current_setting('partner_access.added_owner_membership',true)='true' THEN
    EXECUTE format('REVOKE partner_ops_owner FROM %I',current_user);
  END IF;
END $$;
COMMIT;
