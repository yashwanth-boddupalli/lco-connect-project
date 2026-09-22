-- ============================================
-- LCO CONNECT — Phase 10: Technician Management & Technician Portal Schema
-- Run this in the Supabase SQL Editor AFTER Phase 1 through Phase 9 SQL files.
-- ============================================
-- Features:
--   1. public.technicians table
--   2. Auto ID Generator: generate_technician_id(lco_id)
--   3. Helper Functions: get_technician_id(), get_technician_lco_id()
--   4. RPC Account Activation: link_technician_account()
--   5. Service Request Link: assigned_technician_id FK + auto sync trigger
--   6. Column Guard Trigger for Technician self-service status & notes updates
--   7. Automated Notification Triggers for Assignment, Work Start, Resolution
--   8. Row Level Security (RLS) policies for Technician, LCO Admin, Super Admin
-- ============================================
-- SAFE & IDEMPOTENT: Safe to run multiple times.
-- ============================================

BEGIN;

-- ══════════════════════════════════════════════
-- 1. TECHNICIANS TABLE
-- ══════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.technicians (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lco_id UUID NOT NULL REFERENCES public.lco_applications(id) ON DELETE CASCADE,
  user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  technician_id TEXT NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  invitation_status TEXT NOT NULL DEFAULT 'PENDING',
  invitation_sent_at TIMESTAMPTZ,
  last_invitation_attempt TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Constraints added safely
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'technicians_lco_id_technician_id_key'
  ) THEN
    ALTER TABLE public.technicians
      ADD CONSTRAINT technicians_lco_id_technician_id_key
      UNIQUE (lco_id, technician_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'technicians_status_check'
  ) THEN
    ALTER TABLE public.technicians
      ADD CONSTRAINT technicians_status_check
      CHECK (status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'technicians_invitation_status_check'
  ) THEN
    ALTER TABLE public.technicians
      ADD CONSTRAINT technicians_invitation_status_check
      CHECK (invitation_status IN ('PENDING', 'INVITED', 'ACTIVATED', 'FAILED', 'DISABLED'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_technicians_lco_id ON public.technicians(lco_id);
CREATE INDEX IF NOT EXISTS idx_technicians_user_id ON public.technicians(user_id);
CREATE INDEX IF NOT EXISTS idx_technicians_invitation_status ON public.technicians(invitation_status);

ALTER TABLE public.technicians ENABLE ROW LEVEL SECURITY;


-- ══════════════════════════════════════════════
-- 2. TECHNICIAN ID GENERATOR FUNCTION
-- ══════════════════════════════════════════════
-- Format: TECH-0001 per LCO

CREATE OR REPLACE FUNCTION public.generate_technician_id(
  p_lco_id UUID DEFAULT public.get_lco_id()
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lco_id UUID := COALESCE(p_lco_id, public.get_lco_id());
  v_caller_lco_id UUID := public.get_lco_id();
  v_next_seq INT;
  v_new_id TEXT;
BEGIN
  IF v_lco_id IS NULL THEN
    RAISE EXCEPTION 'LCO ID is required to generate technician ID.';
  END IF;

  -- Security Check: Caller must belong to requested LCO or be Super Admin
  IF v_caller_lco_id IS NOT NULL AND v_caller_lco_id IS DISTINCT FROM v_lco_id AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: Cannot generate technician ID for another LCO.';
  END IF;

  -- Lock lco_applications row to serialize sequence generation per LCO
  PERFORM 1 FROM public.lco_applications WHERE id = v_lco_id FOR UPDATE;

  SELECT COALESCE(MAX(
    CAST(SUBSTRING(technician_id FROM '^TECH-([0-9]+)$') AS INT)
  ), 0) + 1
  INTO v_next_seq
  FROM public.technicians
  WHERE lco_id = v_lco_id;

  v_new_id := 'TECH-' || LPAD(v_next_seq::TEXT, 4, '0');

  RETURN v_new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_technician_id(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_technician_id(UUID) TO authenticated;


-- Trigger to auto-generate technician_id if not supplied
CREATE OR REPLACE FUNCTION public.trg_auto_generate_technician_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_lco_id UUID := public.get_lco_id();
BEGIN
  IF NEW.lco_id IS NULL THEN
    NEW.lco_id := v_caller_lco_id;
  END IF;

  IF NEW.lco_id IS NULL AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unable to determine LCO identity for technician creation.';
  END IF;

  IF v_caller_lco_id IS NOT NULL AND NEW.lco_id IS DISTINCT FROM v_caller_lco_id AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: Cannot create technician for another LCO.';
  END IF;

  IF NEW.technician_id IS NULL OR TRIM(NEW.technician_id) = '' THEN
    NEW.technician_id := public.generate_technician_id(NEW.lco_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_technicians_auto_id ON public.technicians;
CREATE TRIGGER trg_technicians_auto_id
  BEFORE INSERT ON public.technicians
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_auto_generate_technician_id();


-- ══════════════════════════════════════════════
-- 3. RLS HELPER FUNCTIONS
-- ══════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_technician_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.technicians WHERE user_id = auth.uid() AND status = 'ACTIVE' LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_technician_lco_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT lco_id FROM public.technicians WHERE user_id = auth.uid() AND status = 'ACTIVE' LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_technician_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_technician_id() TO authenticated;

REVOKE ALL ON FUNCTION public.get_technician_lco_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_technician_lco_id() TO authenticated;


-- ══════════════════════════════════════════════
-- 4. LINK TECHNICIAN ACCOUNT RPC
-- ══════════════════════════════════════════════

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

  -- Resolve authenticated email from JWT / auth.users
  v_auth_email := COALESCE(
    NULLIF(trim(auth.jwt() ->> 'email'), ''),
    (SELECT email FROM auth.users WHERE id = v_user_id)
  );

  IF v_auth_email IS NULL THEN
    RAISE EXCEPTION 'Unable to verify authenticated email.';
  END IF;

  -- Strict match on technician_id + email
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

  -- Idempotent check
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

  -- Verify user profile role is appropriate to set as TECHNICIAN
  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id;
  IF FOUND AND v_profile.role NOT IN ('USER', 'TECHNICIAN') THEN
    RAISE EXCEPTION 'This account cannot be linked as a technician.';
  END IF;

  -- Link auth user ID to technician record
  UPDATE public.technicians
  SET user_id = v_user_id,
      invitation_status = 'ACTIVATED',
      updated_at = now()
  WHERE id = v_tech.id;

  -- Update profiles table
  UPDATE public.profiles
  SET role = 'TECHNICIAN',
      status = 'ACTIVE'
  WHERE id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unable to activate technician profile.';
  END IF;

  -- Create welcome notification if not present
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
-- 5. SERVICE REQUESTS ALTERATION & SYNC TRIGGER
-- ══════════════════════════════════════════════

ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS assigned_technician_id UUID REFERENCES public.technicians(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_service_requests_assigned_tech_id
  ON public.service_requests(assigned_technician_id);

-- Trigger to sync technician details to legacy text fields automatically
CREATE OR REPLACE FUNCTION public.trg_sync_service_request_technician_details()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tech public.technicians%ROWTYPE;
BEGIN
  IF NEW.assigned_technician_id IS NOT NULL AND (OLD.assigned_technician_id IS NULL OR NEW.assigned_technician_id IS DISTINCT FROM OLD.assigned_technician_id) THEN
    SELECT * INTO v_tech FROM public.technicians WHERE id = NEW.assigned_technician_id;
    IF FOUND THEN
      NEW.assigned_technician_name := v_tech.full_name;
      NEW.assigned_technician_phone := v_tech.phone;
    END IF;
  ELSIF NEW.assigned_technician_id IS NULL AND OLD.assigned_technician_id IS NOT NULL THEN
    NEW.assigned_technician_name := NULL;
    NEW.assigned_technician_phone := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_service_requests_sync_tech_details ON public.service_requests;
CREATE TRIGGER trg_service_requests_sync_tech_details
  BEFORE INSERT OR UPDATE OF assigned_technician_id ON public.service_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sync_service_request_technician_details();


-- ══════════════════════════════════════════════
-- 6. TECHNICIAN COLUMN GUARD TRIGGER
-- ══════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.trg_guard_service_request_technician_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Execute guard ONLY when caller is acting as a Technician (get_technician_id() is NOT NULL and get_lco_id() is NULL)
  IF auth.uid() IS NOT NULL AND public.get_technician_id() IS NOT NULL AND public.get_lco_id() IS NULL THEN
    -- Must be assigned to caller
    IF OLD.assigned_technician_id IS DISTINCT FROM public.get_technician_id() THEN
      RAISE EXCEPTION 'Access denied. You are not assigned to this service request.';
    END IF;

    -- Restrict immutable administrative/customer columns
    IF NEW.lco_id IS DISTINCT FROM OLD.lco_id
      OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
      OR NEW.request_id IS DISTINCT FROM OLD.request_id
      OR NEW.category IS DISTINCT FROM OLD.category
      OR NEW.subject IS DISTINCT FROM OLD.subject
      OR NEW.description IS DISTINCT FROM OLD.description
      OR NEW.priority IS DISTINCT FROM OLD.priority
      OR NEW.assigned_technician_id IS DISTINCT FROM OLD.assigned_technician_id
      OR NEW.admin_notes IS DISTINCT FROM OLD.admin_notes
      OR NEW.closed_at IS DISTINCT FROM OLD.closed_at
    THEN
      RAISE EXCEPTION 'Technicians cannot modify administrative or customer details.';
    END IF;

    -- Allowed status transitions: OPEN -> IN_PROGRESS, IN_PROGRESS -> RESOLVED
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF OLD.status = 'OPEN' AND NEW.status != 'IN_PROGRESS' THEN
        RAISE EXCEPTION 'Open requests can only be transitioned to IN_PROGRESS.';
      ELSIF OLD.status = 'IN_PROGRESS' AND NEW.status != 'RESOLVED' THEN
        RAISE EXCEPTION 'In-progress requests can only be transitioned to RESOLVED.';
      ELSIF OLD.status IN ('RESOLVED', 'CLOSED', 'CANCELLED') THEN
        RAISE EXCEPTION 'Cannot modify requests that are already resolved, closed, or cancelled.';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_service_requests_guard_technician_update ON public.service_requests;
CREATE TRIGGER trg_service_requests_guard_technician_update
  BEFORE UPDATE ON public.service_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_guard_service_request_technician_update();


-- ══════════════════════════════════════════════
-- 7. TECHNICIAN NOTIFICATION TRIGGERS
-- ══════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.trg_notify_technician_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tech_name TEXT;
BEGIN
  -- Notify LCO Admin when Technician starts work
  IF NEW.status = 'IN_PROGRESS' AND OLD.status != 'IN_PROGRESS' THEN
    SELECT full_name INTO v_tech_name FROM public.technicians WHERE id = NEW.assigned_technician_id;

    INSERT INTO public.notifications (lco_id, customer_id, title, message, type)
    VALUES (
      NEW.lco_id,
      NULL,
      'Technician Started Work: ' || NEW.request_id,
      'Technician ' || COALESCE(v_tech_name, 'Assigned') || ' started work on service request ' || NEW.request_id || '.',
      'INFO'
    );
  END IF;

  -- Notify LCO Admin when Technician resolves request
  IF NEW.status = 'RESOLVED' AND OLD.status != 'RESOLVED' THEN
    SELECT full_name INTO v_tech_name FROM public.technicians WHERE id = NEW.assigned_technician_id;

    INSERT INTO public.notifications (lco_id, customer_id, title, message, type)
    VALUES (
      NEW.lco_id,
      NULL,
      'Technician Resolved Request: ' || NEW.request_id,
      'Technician ' || COALESCE(v_tech_name, 'Assigned') || ' marked service request ' || NEW.request_id || ' as RESOLVED.',
      'SUCCESS'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_service_requests_notify_technician_activity ON public.service_requests;
CREATE TRIGGER trg_service_requests_notify_technician_activity
  AFTER UPDATE ON public.service_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_notify_technician_assignment();


-- ══════════════════════════════════════════════
-- 8. ROW LEVEL SECURITY (RLS) POLICIES
-- ══════════════════════════════════════════════

-- ── public.technicians RLS ──

DROP POLICY IF EXISTS "LCO can manage own technicians" ON public.technicians;
CREATE POLICY "LCO can manage own technicians"
  ON public.technicians
  FOR ALL
  TO authenticated
  USING (lco_id = public.get_lco_id())
  WITH CHECK (lco_id = public.get_lco_id());

DROP POLICY IF EXISTS "Technician can view own profile" ON public.technicians;
CREATE POLICY "Technician can view own profile"
  ON public.technicians
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Super admins can manage all technicians" ON public.technicians;
CREATE POLICY "Super admins can manage all technicians"
  ON public.technicians
  FOR ALL
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());


-- ── public.service_requests RLS additions for Technicians ──

DROP POLICY IF EXISTS "Technician can view assigned service requests" ON public.service_requests;
CREATE POLICY "Technician can view assigned service requests"
  ON public.service_requests
  FOR SELECT
  TO authenticated
  USING (
    lco_id = public.get_technician_lco_id()
    AND assigned_technician_id = public.get_technician_id()
  );

DROP POLICY IF EXISTS "Technician can update assigned service requests" ON public.service_requests;
CREATE POLICY "Technician can update assigned service requests"
  ON public.service_requests
  FOR UPDATE
  TO authenticated
  USING (
    lco_id = public.get_technician_lco_id()
    AND assigned_technician_id = public.get_technician_id()
  )
  WITH CHECK (
    lco_id = public.get_technician_lco_id()
    AND assigned_technician_id = public.get_technician_id()
  );

COMMIT;

-- ══════════════════════════════════════════════
-- DONE — Phase 10 Technician Schema & RLS Ready
-- ══════════════════════════════════════════════
