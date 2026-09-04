BEGIN;
DO $$ BEGIN
 IF NOT pg_has_role(current_user,'partner_ops_owner','USAGE') THEN
  EXECUTE format('GRANT partner_ops_owner TO %I WITH INHERIT TRUE, SET TRUE',current_user);
 END IF;
END $$;
GRANT CREATE ON SCHEMA public TO partner_ops_owner;

CREATE OR REPLACE FUNCTION public.partner_ops_access_issue(actor text,target_company uuid,target_user text,target_purpose text,target_hash text)
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
CREATE OR REPLACE FUNCTION public.partner_ops_access_password(actor text,target_company uuid,target_user text,target_password_hash text) RETURNS boolean
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
CREATE OR REPLACE FUNCTION public.partner_ops_partner_user_create(actor text,target_company uuid,target_id text,target_name text,target_email text,target_password_hash text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN PERFORM public.partner_ops_authorize(actor,'ADMIN'); INSERT INTO public.partner_users(id,company_id,principal_type,name,email) VALUES(target_id,target_company,'PARTNER',target_name,target_email); INSERT INTO public.partner_accounts(id,account_id,provider_id,user_id,password) VALUES(public.gen_random_uuid()::text,target_id,'credential',target_id,target_password_hash); INSERT INTO public.partner_audit_events(event_type,actor_user_id,subject_user_id,company_id,metadata) VALUES('OPS_PARTNER_USER_PROVISIONED',actor,target_id,target_company,'{}'::jsonb); RETURN true; END $$;
DROP FUNCTION public.partner_access_manage_invite(text,uuid,text,text,text,text);
DROP FUNCTION public.partner_access_manage_create(text,uuid,text,text,text,text,text);
DROP FUNCTION public.partner_access_manage_user(text,uuid,text,text,boolean);
DROP FUNCTION public.partner_access_manage_users(text,uuid);
DROP FUNCTION public.partner_ops_company_active(text,uuid,integer,boolean);
DROP FUNCTION public.partner_access_authorize_manager(text,uuid);
CREATE OR REPLACE FUNCTION public.partner_ops_company_update_full(actor text,target_company uuid,target_revision integer,target_slug text,target_name text,target_billing text,target_defaults jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN PERFORM public.partner_ops_authorize(actor,'ADMIN'); UPDATE public.partner_companies SET name=target_name,billing_model=target_billing,quote_default_wall_rate_cents=(target_defaults->>'wallRateCents')::bigint,quote_default_ceiling_rate_cents=(target_defaults->>'ceilingRateCents')::bigint,quote_default_deposit_basis_points=(target_defaults->>'depositBasisPoints')::integer,quote_default_consent_fee_cents=(target_defaults->>'consentFeeCents')::bigint,quote_default_extras=COALESCE(target_defaults->'extras','[]'::jsonb),revision=revision+1,quote_defaults_revision=quote_defaults_revision+1,updated_at=now() WHERE id=target_company AND slug=target_slug AND revision=target_revision; IF FOUND THEN INSERT INTO public.partner_audit_events(event_type,actor_user_id,company_id,metadata) VALUES('OPS_COMPANY_UPDATED',actor,target_company,'{}'::jsonb); END IF; RETURN FOUND; END $$;
CREATE OR REPLACE FUNCTION public.partner_ops_partner_user_disable(actor text,target_company uuid,target_user text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN PERFORM public.partner_ops_authorize(actor,'ADMIN'); UPDATE public.partner_users SET disabled_at=now(),updated_at=now() WHERE id=target_user AND company_id=target_company AND principal_type='PARTNER' AND disabled_at IS NULL; IF NOT FOUND THEN RETURN false; END IF; DELETE FROM public.partner_sessions WHERE user_id=target_user; INSERT INTO public.partner_audit_events(event_type,actor_user_id,subject_user_id,company_id,metadata) VALUES('USER_DISABLED',actor,target_user,target_company,'{}'::jsonb),('SESSIONS_REVOKED',actor,target_user,target_company,'{}'::jsonb); RETURN true; END $$;
CREATE OR REPLACE FUNCTION public.partner_ops_access_invite(actor text,target_company uuid,target_name text,target_email text,target_hash text)
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
ALTER TABLE public.partner_users DROP CONSTRAINT partner_users_partner_role_check;
ALTER TABLE public.partner_users DROP COLUMN partner_role;
CREATE OR REPLACE FUNCTION public.partner_ops_legacy_connection_set(actor text,target_company uuid,target_revision integer,target_endpoint text,
  target_ciphertext bytea,target_nonce bytea,target_key_version integer,target_fingerprint text,target_prefix text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM public.partner_ops_authorize(actor,'ADMIN');
  IF target_endpoint<>'https://api.insulhub.nz/graphql' OR octet_length(target_ciphertext) NOT BETWEEN 17 AND 16384
    OR octet_length(target_nonce)<>12 OR target_key_version<=0 OR target_fingerprint!~'^[0-9a-f]{64}$'
    OR target_prefix!~'^[A-Z0-9][A-Z0-9-]{0,39}$' THEN RAISE EXCEPTION 'OPS_INVALID_INPUT'; END IF;
  UPDATE public.partner_companies SET legacy_base_url=target_endpoint,legacy_credential_ciphertext=target_ciphertext,
    legacy_credential_nonce=target_nonce,legacy_credential_key_version=target_key_version,legacy_credential_updated_at=now(),
    submission_adapter_mode='LIVE',submission_contract_version='insulhub-one-shot-v1',legacy_job_prefix=target_prefix,
    revision=revision+1,updated_at=now()
    WHERE id=target_company AND is_active=true AND revision=target_revision;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.partner_audit_events(event_type,actor_user_id,company_id,metadata)
    VALUES('LEGACY_CREDENTIAL_REPLACED',actor,target_company,jsonb_build_object('keyVersion',target_key_version,'contract','insulhub-one-shot-v1'));
  RETURN true;
END $$;
REVOKE CREATE ON SCHEMA public FROM partner_ops_owner;
COMMIT;
