-- ============================================
-- LCO CONNECT — Phase 13 Batch 13C-1 Migration
-- Centralized Audit Trail Architecture & Security Oversight Foundation
-- ============================================
-- Run this in the Supabase SQL Editor AFTER Phase 1 through Phase 13B SQL files.
-- Safe and idempotent: Can be executed multiple times.
-- ============================================

BEGIN;

-- ══════════════════════════════════════════════
-- 1. CENTRALIZED AUDIT LOGS TABLE
-- ══════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_id UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_role TEXT NOT NULL DEFAULT 'SYSTEM',
  actor_email TEXT NULL,
  lco_id UUID NULL REFERENCES public.lco_applications(id) ON DELETE SET NULL,

  action TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'INFO',

  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,

  description TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Constraints added safely
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audit_logs_category_check'
  ) THEN
    ALTER TABLE public.audit_logs
      ADD CONSTRAINT audit_logs_category_check
      CHECK (category IN (
        'GOVERNANCE', 'SECURITY', 'USER_MGMT', 'BILLING', 'SERVICE_REQUEST', 'TECHNICIAN', 'SYSTEM'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audit_logs_severity_check'
  ) THEN
    ALTER TABLE public.audit_logs
      ADD CONSTRAINT audit_logs_severity_check
      CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL'));
  END IF;
END $$;

-- ══════════════════════════════════════════════
-- 2. INDEXES
-- ══════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id ON public.audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_lco_id ON public.audit_logs(lco_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_category ON public.audit_logs(category);
CREATE INDEX IF NOT EXISTS idx_audit_logs_severity ON public.audit_logs(severity);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON public.audit_logs(entity_type, entity_id);

-- ══════════════════════════════════════════════
-- 3. ROW LEVEL SECURITY (RLS) POLICIES
-- ══════════════════════════════════════════════
-- Audit records are immutable: No INSERT, UPDATE, or DELETE policies for normal users.
-- Only Super Admins can SELECT audit records via policy or SECURITY DEFINER RPC.

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins can read audit logs" ON public.audit_logs;
CREATE POLICY "Super admins can read audit logs"
  ON public.audit_logs
  FOR SELECT
  TO authenticated
  USING (public.is_super_admin());


-- ══════════════════════════════════════════════
-- 4. SECURE INTERNAL AUDIT WRITE FUNCTION
-- ══════════════════════════════════════════════
-- Internal helper for appending audit events in server-side transaction context.
-- STRICT SECURITY DESIGN:
-- 1. EXECUTE permission is REVOKED from PUBLIC, authenticated, and anon.
-- 2. CANNOT be called directly via RPC/API by any standard application user.
-- 3. Actor identity is ALWAYS derived strictly from auth.uid() (never caller-supplied).

DROP FUNCTION IF EXISTS public.write_audit_log(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, UUID, UUID);
DROP FUNCTION IF EXISTS public.write_audit_log(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, UUID);

CREATE OR REPLACE FUNCTION public.write_audit_log(
  p_action TEXT,
  p_category TEXT,
  p_severity TEXT,
  p_entity_type TEXT,
  p_entity_id TEXT,
  p_description TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_lco_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_actor_role TEXT := 'SYSTEM';
  v_actor_email TEXT := NULL;
  v_audit_id UUID;
BEGIN
  -- Strict Security Rule: Actor identity is ALWAYS auth.uid() if present, never caller-supplied
  v_actor_id := auth.uid();

  IF v_actor_id IS NOT NULL THEN
    SELECT COALESCE(role, 'SYSTEM'), email
    INTO v_actor_role, v_actor_email
    FROM public.profiles
    WHERE id = v_actor_id;

    IF v_actor_email IS NULL THEN
      SELECT email INTO v_actor_email
      FROM auth.users
      WHERE id = v_actor_id;
    END IF;
  END IF;

  INSERT INTO public.audit_logs (
    actor_id,
    actor_role,
    actor_email,
    lco_id,
    action,
    category,
    severity,
    entity_type,
    entity_id,
    description,
    metadata
  ) VALUES (
    v_actor_id,
    COALESCE(v_actor_role, 'SYSTEM'),
    v_actor_email,
    p_lco_id,
    p_action,
    p_category,
    COALESCE(p_severity, 'INFO'),
    p_entity_type,
    p_entity_id,
    p_description,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_audit_id;

  RETURN v_audit_id;
END;
$$;

-- REVOKE direct EXECUTE from ALL client roles (PUBLIC, authenticated, anon).
-- Only owner-privileged SECURITY DEFINER RPCs can execute this function internally.
REVOKE ALL ON FUNCTION public.write_audit_log(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.write_audit_log(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, UUID) FROM authenticated;
REVOKE ALL ON FUNCTION public.write_audit_log(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, UUID) FROM anon;


-- ══════════════════════════════════════════════
-- 5. INSTRUMENT EXISTING PRIVILEGED RPCs
-- ══════════════════════════════════════════════

-- 5A. Instrument review_lco_application (Governance)
CREATE OR REPLACE FUNCTION public.review_lco_application(
  p_application_id UUID,
  p_decision TEXT,
  p_review_notes TEXT DEFAULT NULL,
  p_rejection_reason TEXT DEFAULT NULL
)
RETURNS TABLE (id UUID, application_id TEXT, status TEXT, user_id UUID, email TEXT, business_name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  app_row public.lco_applications%ROWTYPE;
  normalized_decision TEXT := upper(trim(p_decision));
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only a Super Admin can review LCO applications';
  END IF;

  IF normalized_decision NOT IN ('APPROVED', 'REJECTED') THEN
    RAISE EXCEPTION 'Decision must be APPROVED or REJECTED';
  END IF;

  IF normalized_decision = 'REJECTED' AND coalesce(trim(p_rejection_reason), '') = '' THEN
    RAISE EXCEPTION 'A rejection reason is required';
  END IF;

  SELECT * INTO app_row FROM public.lco_applications
  WHERE lco_applications.id = p_application_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Application not found'; END IF;

  IF app_row.status NOT IN ('PENDING', 'UNDER_REVIEW') THEN
    RAISE EXCEPTION 'Only pending applications can be reviewed';
  END IF;

  UPDATE public.lco_applications SET
    status = normalized_decision,
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    review_notes = NULLIF(trim(p_review_notes), ''),
    rejection_reason = CASE WHEN normalized_decision = 'REJECTED' THEN NULLIF(trim(p_rejection_reason), '') END,
    notification_status = 'PENDING'
  WHERE lco_applications.id = p_application_id;

  IF app_row.user_id IS NOT NULL THEN
    UPDATE public.profiles SET
      role = 'LCO_ADMIN',
      status = CASE WHEN normalized_decision = 'APPROVED' THEN 'ACTIVE' ELSE 'REJECTED' END
    WHERE profiles.id = app_row.user_id;

    IF NOT FOUND THEN RAISE EXCEPTION 'Linked profile not found'; END IF;
  END IF;

  INSERT INTO public.application_reviews
    (application_id, reviewer_id, decision, rejection_reason, notes)
  VALUES (
    p_application_id, auth.uid(), normalized_decision,
    CASE WHEN normalized_decision = 'REJECTED' THEN NULLIF(trim(p_rejection_reason), '') END,
    NULLIF(trim(p_review_notes), '')
  );

  -- Write Audit Log (Internal call within owner-privileged transaction)
  PERFORM public.write_audit_log(
    p_action => CASE WHEN normalized_decision = 'APPROVED' THEN 'GOVERNANCE_LCO_APPROVED' ELSE 'GOVERNANCE_LCO_REJECTED' END,
    p_category => 'GOVERNANCE',
    p_severity => CASE WHEN normalized_decision = 'APPROVED' THEN 'INFO' ELSE 'WARNING' END,
    p_entity_type => 'lco_applications',
    p_entity_id => app_row.application_id,
    p_description => 'Super Admin ' || CASE WHEN normalized_decision = 'APPROVED' THEN 'approved' ELSE 'rejected' END || ' LCO application ' || app_row.application_id || ' (' || app_row.business_name || ')',
    p_metadata => jsonb_build_object(
      'application_id', app_row.application_id,
      'business_name', app_row.business_name,
      'decision', normalized_decision,
      'rejection_reason', p_rejection_reason,
      'review_notes', p_review_notes
    ),
    p_lco_id => app_row.id
  );

  RETURN QUERY SELECT a.id, a.application_id, a.status, a.user_id, a.email, a.business_name
    FROM public.lco_applications a WHERE a.id = p_application_id;
END;
$$;

REVOKE ALL ON FUNCTION public.review_lco_application(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_lco_application(UUID, TEXT, TEXT, TEXT) TO authenticated;


-- 5B. Instrument manage_lco_status (Security / Governance)
CREATE OR REPLACE FUNCTION public.manage_lco_status(
  p_application_id UUID,
  p_new_status TEXT,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app public.lco_applications%ROWTYPE;
  v_target_profile public.profiles%ROWTYPE;
  v_normalized_status TEXT;
  v_clean_reason TEXT;
  v_old_status TEXT;
  v_result JSONB;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: Only a Super Admin can manage LCO account status';
  END IF;

  v_normalized_status := upper(trim(COALESCE(p_new_status, '')));
  v_clean_reason := trim(COALESCE(p_reason, ''));

  IF v_normalized_status NOT IN ('ACTIVE', 'SUSPENDED') THEN
    RAISE EXCEPTION 'Invalid status transition target: %. Status must be ACTIVE or SUSPENDED', p_new_status;
  END IF;

  IF v_clean_reason = '' THEN
    RAISE EXCEPTION 'A valid reason is required for account status management';
  END IF;

  SELECT * INTO v_app
  FROM public.lco_applications
  WHERE id = p_application_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'LCO application not found for ID: %', p_application_id;
  END IF;

  IF v_app.status <> 'APPROVED' THEN
    RAISE EXCEPTION 'Account status can only be managed for APPROVED LCO applications (Current status: %)', v_app.status;
  END IF;

  IF v_app.user_id IS NULL THEN
    RAISE EXCEPTION 'LCO application does not have a linked user account profile';
  END IF;

  SELECT * INTO v_target_profile
  FROM public.profiles
  WHERE id = v_app.user_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Linked user profile not found for user_id: %', v_app.user_id;
  END IF;

  IF v_target_profile.role <> 'LCO_ADMIN' THEN
    RAISE EXCEPTION 'Target user profile is not an LCO_ADMIN (Role: %)', v_target_profile.role;
  END IF;

  v_old_status := COALESCE(v_target_profile.status, 'ACTIVE');

  IF v_old_status = v_normalized_status THEN
    RAISE EXCEPTION 'LCO account is already in status: %', v_normalized_status;
  END IF;

  UPDATE public.profiles
  SET 
    status = v_normalized_status,
    updated_at = now()
  WHERE id = v_app.user_id;

  -- Write Audit Log (Internal call within owner-privileged transaction)
  PERFORM public.write_audit_log(
    p_action => CASE WHEN v_normalized_status = 'SUSPENDED' THEN 'SECURITY_LCO_SUSPENDED' ELSE 'SECURITY_LCO_REACTIVATED' END,
    p_category => 'SECURITY',
    p_severity => CASE WHEN v_normalized_status = 'SUSPENDED' THEN 'WARNING' ELSE 'INFO' END,
    p_entity_type => 'lco_applications',
    p_entity_id => v_app.application_id,
    p_description => 'Super Admin ' || CASE WHEN v_normalized_status = 'SUSPENDED' THEN 'suspended' ELSE 'reactivated' END || ' LCO account for ' || v_app.business_name,
    p_metadata => jsonb_build_object(
      'application_id', v_app.application_id,
      'business_name', v_app.business_name,
      'old_status', v_old_status,
      'new_status', v_normalized_status,
      'reason', v_clean_reason
    ),
    p_lco_id => v_app.id
  );

  v_result := jsonb_build_object(
    'success', true,
    'application_id', v_app.id,
    'user_id', v_app.user_id,
    'business_name', v_app.business_name,
    'old_status', v_old_status,
    'new_status', v_normalized_status,
    'reason', v_clean_reason,
    'updated_at', now()
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.manage_lco_status(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manage_lco_status(UUID, TEXT, TEXT) TO authenticated;


-- 5C. Instrument link_technician_account (Technician Management)
CREATE OR REPLACE FUNCTION public.link_technician_account(
  p_technician_id TEXT,
  p_email TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_auth_email TEXT;
  v_tech public.technicians%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF coalesce(trim(p_technician_id), '') = '' OR coalesce(trim(p_email), '') = '' THEN
    RAISE EXCEPTION 'Technician ID and email are required.';
  END IF;

  v_auth_email := COALESCE(
    NULLIF(trim(auth.jwt() ->> 'email'), ''),
    (SELECT email FROM auth.users WHERE id = v_user_id)
  );

  IF v_auth_email IS NULL THEN
    RAISE EXCEPTION 'Unable to verify authenticated email.';
  END IF;

  SELECT * INTO v_tech
  FROM public.technicians
  WHERE UPPER(TRIM(technician_id)) = UPPER(TRIM(p_technician_id))
    AND LOWER(TRIM(email)) = LOWER(TRIM(p_email));

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Technician record not found. Please verify your Technician ID and Email.';
  END IF;

  IF LOWER(TRIM(v_auth_email)) <> LOWER(TRIM(v_tech.email)) THEN
    RAISE EXCEPTION 'Authenticated email does not match the registered technician email.';
  END IF;

  IF v_tech.invitation_status = 'ACTIVATED' AND v_tech.user_id IS NOT DISTINCT FROM v_user_id THEN
    UPDATE public.profiles
    SET role = 'TECHNICIAN', status = 'ACTIVE'
    WHERE id = v_user_id;

    RETURN jsonb_build_object(
      'success', true,
      'technician_id', v_tech.technician_id,
      'full_name', v_tech.full_name,
      'already_activated', true
    );
  END IF;

  IF v_tech.invitation_status = 'DISABLED' THEN
    RAISE EXCEPTION 'This technician account has been disabled.';
  END IF;

  IF v_tech.user_id IS NOT NULL AND v_tech.user_id <> v_user_id THEN
    RAISE EXCEPTION 'This technician account has already been activated.';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id;
  IF FOUND AND v_profile.role NOT IN ('USER', 'TECHNICIAN') THEN
    RAISE EXCEPTION 'This account cannot be linked as a technician.';
  END IF;

  UPDATE public.technicians
  SET user_id = v_user_id,
      invitation_status = 'ACTIVATED',
      updated_at = now()
  WHERE id = v_tech.id;

  UPDATE public.profiles
  SET role = 'TECHNICIAN',
      status = 'ACTIVE'
  WHERE id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unable to activate technician profile.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.notifications
    WHERE title = 'Welcome to Technician Portal!'
      AND message LIKE '%' || v_tech.technician_id || '%'
  ) THEN
    INSERT INTO public.notifications (lco_id, customer_id, title, message, type)
    VALUES (
      v_tech.lco_id,
      NULL,
      'Welcome to Technician Portal!',
      'Your technician account (' || v_tech.technician_id || ') has been activated. You can now view and manage your assigned service requests.',
      'SUCCESS'
    );
  END IF;

  -- Write Audit Log (Internal call within owner-privileged transaction)
  PERFORM public.write_audit_log(
    p_action => 'TECHNICIAN_ACCOUNT_ACTIVATED',
    p_category => 'TECHNICIAN',
    p_severity => 'INFO',
    p_entity_type => 'technicians',
    p_entity_id => v_tech.technician_id,
    p_description => 'Technician account activated for ' || v_tech.full_name || ' (' || v_tech.technician_id || ')',
    p_metadata => jsonb_build_object(
      'technician_id', v_tech.technician_id,
      'full_name', v_tech.full_name,
      'email', v_tech.email
    ),
    p_lco_id => v_tech.lco_id
  );

  RETURN jsonb_build_object(
    'success', true,
    'technician_id', v_tech.technician_id,
    'full_name', v_tech.full_name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.link_technician_account(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_technician_account(TEXT, TEXT) TO authenticated;


-- ══════════════════════════════════════════════
-- 6. SUPER ADMIN READ-ONLY AUDIT LOGS RPC
-- ══════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_super_admin_audit_logs(
  p_search TEXT DEFAULT NULL,
  p_category TEXT DEFAULT 'ALL',
  p_severity TEXT DEFAULT 'ALL',
  p_actor_role TEXT DEFAULT 'ALL',
  p_lco_id UUID DEFAULT NULL,
  p_date_from TIMESTAMPTZ DEFAULT NULL,
  p_date_to TIMESTAMPTZ DEFAULT NULL,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INT;
  v_offset INT;
  v_search TEXT;
  v_category TEXT;
  v_severity TEXT;
  v_actor_role TEXT;
  v_total_records INT;
  v_data JSONB;
  v_result JSONB;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: Caller is not a Super Admin';
  END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_offset := GREATEST(COALESCE(p_offset, 0), 0);
  v_search := NULLIF(trim(p_search), '');
  v_category := NULLIF(trim(upper(p_category)), '');
  v_severity := NULLIF(trim(upper(p_severity)), '');
  v_actor_role := NULLIF(trim(upper(p_actor_role)), '');

  SELECT COUNT(*) INTO v_total_records
  FROM public.audit_logs a
  WHERE (v_category IS NULL OR v_category = 'ALL' OR a.category = v_category)
    AND (v_severity IS NULL OR v_severity = 'ALL' OR a.severity = v_severity)
    AND (v_actor_role IS NULL OR v_actor_role = 'ALL' OR a.actor_role = v_actor_role)
    AND (p_lco_id IS NULL OR a.lco_id = p_lco_id)
    AND (p_date_from IS NULL OR a.created_at >= p_date_from)
    AND (p_date_to IS NULL OR a.created_at <= p_date_to)
    AND (
      v_search IS NULL
      OR a.action ILIKE '%' || v_search || '%'
      OR a.description ILIKE '%' || v_search || '%'
      OR a.actor_email ILIKE '%' || v_search || '%'
      OR a.entity_id ILIKE '%' || v_search || '%'
    );

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', a.id,
      'created_at', a.created_at,
      'category', a.category,
      'severity', a.severity,
      'action', a.action,
      'actor_id', a.actor_id,
      'actor_email', a.actor_email,
      'actor_role', a.actor_role,
      'lco_id', a.lco_id,
      'lco_business_name', l.business_name,
      'entity_type', a.entity_type,
      'entity_id', a.entity_id,
      'description', a.description,
      'metadata', a.metadata
    )
  ), '[]'::jsonb) INTO v_data
  FROM (
    SELECT a.*
    FROM public.audit_logs a
    WHERE (v_category IS NULL OR v_category = 'ALL' OR a.category = v_category)
      AND (v_severity IS NULL OR v_severity = 'ALL' OR a.severity = v_severity)
      AND (v_actor_role IS NULL OR v_actor_role = 'ALL' OR a.actor_role = v_actor_role)
      AND (p_lco_id IS NULL OR a.lco_id = p_lco_id)
      AND (p_date_from IS NULL OR a.created_at >= p_date_from)
      AND (p_date_to IS NULL OR a.created_at <= p_date_to)
      AND (
        v_search IS NULL
        OR a.action ILIKE '%' || v_search || '%'
        OR a.description ILIKE '%' || v_search || '%'
        OR a.actor_email ILIKE '%' || v_search || '%'
        OR a.entity_id ILIKE '%' || v_search || '%'
      )
    ORDER BY a.created_at DESC
    LIMIT v_limit OFFSET v_offset
  ) a
  LEFT JOIN public.lco_applications l ON a.lco_id = l.id;

  v_result := jsonb_build_object(
    'data', v_data,
    'pagination', jsonb_build_object(
      'total_records', v_total_records,
      'limit', v_limit,
      'offset', v_offset,
      'has_more', (v_offset + v_limit) < v_total_records
    )
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_super_admin_audit_logs(TEXT, TEXT, TEXT, TEXT, UUID, TIMESTAMPTZ, TIMESTAMPTZ, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_super_admin_audit_logs(TEXT, TEXT, TEXT, TEXT, UUID, TIMESTAMPTZ, TIMESTAMPTZ, INT, INT) TO authenticated;


-- ══════════════════════════════════════════════
-- 7. SUPER ADMIN SECURITY METRICS RPC
-- ══════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_super_admin_security_metrics()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: Caller is not a Super Admin';
  END IF;

  SELECT jsonb_build_object(
    'total_audit_events', (SELECT COALESCE(COUNT(*), 0) FROM public.audit_logs),
    'events_last_24h', (SELECT COALESCE(COUNT(*), 0) FROM public.audit_logs WHERE created_at >= now() - INTERVAL '24 hours'),
    'events_last_7d', (SELECT COALESCE(COUNT(*), 0) FROM public.audit_logs WHERE created_at >= now() - INTERVAL '7 days'),
    'events_last_30d', (SELECT COALESCE(COUNT(*), 0) FROM public.audit_logs WHERE created_at >= now() - INTERVAL '30 days'),
    'critical_events', (SELECT COALESCE(COUNT(*), 0) FROM public.audit_logs WHERE severity = 'CRITICAL'),
    'warning_events', (SELECT COALESCE(COUNT(*), 0) FROM public.audit_logs WHERE severity = 'WARNING'),
    'governance_events', (SELECT COALESCE(COUNT(*), 0) FROM public.audit_logs WHERE category = 'GOVERNANCE'),
    'security_events', (SELECT COALESCE(COUNT(*), 0) FROM public.audit_logs WHERE category = 'SECURITY'),
    'user_mgmt_events', (SELECT COALESCE(COUNT(*), 0) FROM public.audit_logs WHERE category = 'USER_MGMT'),
    'recent_privileged_operations', (
      SELECT COALESCE(COUNT(*), 0)
      FROM public.audit_logs
      WHERE category IN ('GOVERNANCE', 'SECURITY') AND created_at >= now() - INTERVAL '30 days'
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_super_admin_security_metrics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_super_admin_security_metrics() TO authenticated;

COMMIT;

-- ============================================
-- DONE — Phase 13 Batch 13C-1 Audit Migration Ready
-- ============================================
