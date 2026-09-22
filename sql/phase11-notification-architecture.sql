-- ============================================
-- LCO CONNECT — Phase 11: Notification Recipient Routing Schema
-- Run this in the Supabase SQL Editor AFTER Phase 1 through Phase 10 SQL files.
-- ============================================
-- Features:
--   1. Schema Extensions on public.notifications (technician_id, recipient_role)
--   2. Check constraint for allowed recipient_role values
--   3. Performance indexes for recipient role and technician queries
--   4. Safe, non-destructive data backfill for pre-existing notifications
--   5. Hardened Row Level Security (RLS) policies for LCO_ADMIN, CUSTOMER, TECHNICIAN, SUPER_ADMIN
--   6. Updated RPC functions: link_customer_account(), link_technician_account()
--   7. Updated Phase 9 notification triggers for service requests
--   8. Updated Phase 10 technician assignment and activity triggers
-- ============================================
-- SAFE & IDEMPOTENT: Safe to run multiple times.
-- ============================================

BEGIN;

-- ══════════════════════════════════════════════
-- 1. SCHEMA EXTENSIONS
-- ══════════════════════════════════════════════

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS technician_id UUID REFERENCES public.technicians(id) ON DELETE CASCADE;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS recipient_role TEXT NOT NULL DEFAULT 'LCO_ADMIN';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notifications_recipient_role_check'
  ) THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT notifications_recipient_role_check
      CHECK (recipient_role IN ('LCO_ADMIN', 'CUSTOMER', 'TECHNICIAN', 'SYSTEM_ADMIN'));
  END IF;
END $$;


-- ══════════════════════════════════════════════
-- 2. INDEXES
-- ══════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_role
  ON public.notifications(recipient_role);

CREATE INDEX IF NOT EXISTS idx_notifications_technician_id
  ON public.notifications(technician_id);


-- ══════════════════════════════════════════════
-- 3. SAFE BACKFILL FOR EXISTING NOTIFICATIONS
-- ══════════════════════════════════════════════

-- Rule 1: Customer notifications (customer_id IS NOT NULL -> CUSTOMER)
UPDATE public.notifications
SET recipient_role = 'CUSTOMER'
WHERE customer_id IS NOT NULL
  AND recipient_role IS DISTINCT FROM 'CUSTOMER';

-- Rule 2: Technician welcome notifications (title = 'Welcome to Technician Portal!' -> TECHNICIAN)
DO $$
DECLARE
  rec RECORD;
  v_tech_id UUID;
BEGIN
  FOR rec IN 
    SELECT n.id, n.lco_id, n.message
    FROM public.notifications n
    WHERE n.title = 'Welcome to Technician Portal!'
      AND n.technician_id IS NULL
  LOOP
    SELECT t.id INTO v_tech_id
    FROM public.technicians t
    WHERE t.lco_id = rec.lco_id
      AND rec.message LIKE '%' || t.technician_id || '%'
    LIMIT 1;

    IF v_tech_id IS NOT NULL THEN
      UPDATE public.notifications
      SET recipient_role = 'TECHNICIAN',
          technician_id = v_tech_id
      WHERE id = rec.id;
    ELSE
      RAISE NOTICE 'Notification ID % ("%") could not be safely matched to a technician.', rec.id, rec.message;
    END IF;
  END LOOP;
END $$;

-- Rule 3: Existing LCO-level notifications (customer_id IS NULL AND technician_id IS NULL -> LCO_ADMIN)
UPDATE public.notifications
SET recipient_role = 'LCO_ADMIN'
WHERE customer_id IS NULL
  AND technician_id IS NULL
  AND recipient_role IS DISTINCT FROM 'LCO_ADMIN';


-- ══════════════════════════════════════════════
-- 4. HARDENED ROW LEVEL SECURITY (RLS) POLICIES
-- ══════════════════════════════════════════════

-- ── LCO Admin Policies ──

DROP POLICY IF EXISTS "LCO can view own notifications" ON public.notifications;
CREATE POLICY "LCO can view own notifications"
  ON public.notifications
  FOR SELECT
  TO authenticated
  USING (
    recipient_role = 'LCO_ADMIN'
    AND lco_id = public.get_lco_id()
    AND customer_id IS NULL
    AND technician_id IS NULL
  );

DROP POLICY IF EXISTS "LCO can update own notifications" ON public.notifications;
CREATE POLICY "LCO can update own notifications"
  ON public.notifications
  FOR UPDATE
  TO authenticated
  USING (
    recipient_role = 'LCO_ADMIN'
    AND lco_id = public.get_lco_id()
    AND customer_id IS NULL
    AND technician_id IS NULL
  )
  WITH CHECK (
    recipient_role = 'LCO_ADMIN'
    AND lco_id = public.get_lco_id()
    AND customer_id IS NULL
    AND technician_id IS NULL
  );

-- ── Customer Policies ──

DROP POLICY IF EXISTS "Customer can view own notifications" ON public.notifications;
CREATE POLICY "Customer can view own notifications"
  ON public.notifications
  FOR SELECT
  TO authenticated
  USING (
    recipient_role = 'CUSTOMER'
    AND customer_id = public.get_customer_id()
    AND lco_id = public.get_customer_lco_id()
  );

DROP POLICY IF EXISTS "Customer can update own notifications" ON public.notifications;
CREATE POLICY "Customer can update own notifications"
  ON public.notifications
  FOR UPDATE
  TO authenticated
  USING (
    recipient_role = 'CUSTOMER'
    AND customer_id = public.get_customer_id()
    AND lco_id = public.get_customer_lco_id()
  )
  WITH CHECK (
    recipient_role = 'CUSTOMER'
    AND customer_id = public.get_customer_id()
    AND lco_id = public.get_customer_lco_id()
  );

-- ── Technician Policies ──

DROP POLICY IF EXISTS "Technician can view own notifications" ON public.notifications;
CREATE POLICY "Technician can view own notifications"
  ON public.notifications
  FOR SELECT
  TO authenticated
  USING (
    recipient_role = 'TECHNICIAN'
    AND technician_id = public.get_technician_id()
    AND lco_id = public.get_technician_lco_id()
  );

DROP POLICY IF EXISTS "Technician can update own notifications" ON public.notifications;
CREATE POLICY "Technician can update own notifications"
  ON public.notifications
  FOR UPDATE
  TO authenticated
  USING (
    recipient_role = 'TECHNICIAN'
    AND technician_id = public.get_technician_id()
    AND lco_id = public.get_technician_lco_id()
  )
  WITH CHECK (
    recipient_role = 'TECHNICIAN'
    AND technician_id = public.get_technician_id()
    AND lco_id = public.get_technician_lco_id()
  );

-- ── Super Admin Policy ──

DROP POLICY IF EXISTS "Super admins can manage notifications" ON public.notifications;
CREATE POLICY "Super admins can manage notifications"
  ON public.notifications
  FOR ALL
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());


-- ══════════════════════════════════════════════
-- 5. UPDATED ACCOUNT ACTIVATION RPCs
-- ══════════════════════════════════════════════

-- Customer Account Activation RPC
CREATE OR REPLACE FUNCTION public.link_customer_account(
  p_customer_id TEXT,
  p_email TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_customer public.customers%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT * INTO v_customer
  FROM public.customers
  WHERE UPPER(TRIM(customer_id)) = UPPER(TRIM(p_customer_id))
    AND LOWER(TRIM(email)) = LOWER(TRIM(p_email));

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer record not found. Please verify your Customer ID and Email.';
  END IF;

  IF v_customer.user_id IS NOT NULL AND v_customer.user_id != v_user_id THEN
    RAISE EXCEPTION 'This customer account has already been activated.';
  END IF;

  UPDATE public.customers
  SET user_id = v_user_id,
      updated_at = now()
  WHERE id = v_customer.id;

  UPDATE public.profiles
  SET role = 'CUSTOMER',
      status = 'ACTIVE'
  WHERE id = v_user_id;

  -- Create explicit customer-directed welcome notification
  INSERT INTO public.notifications (lco_id, customer_id, technician_id, recipient_role, title, message, type)
  VALUES (
    v_customer.lco_id,
    v_customer.id,
    NULL,
    'CUSTOMER',
    'Welcome to Customer Portal!',
    'Your customer account has been activated. You can now view your subscription, service plans, and account details.',
    'SUCCESS'
  );

  RETURN jsonb_build_object(
    'success', true,
    'customer_id', v_customer.customer_id,
    'full_name', v_customer.full_name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.link_customer_account(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_customer_account(TEXT, TEXT) TO authenticated;


-- Technician Account Activation RPC
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

  -- Create explicit technician-directed welcome notification
  IF NOT EXISTS (
    SELECT 1 FROM public.notifications
    WHERE recipient_role = 'TECHNICIAN'
      AND technician_id = v_tech.id
      AND title = 'Welcome to Technician Portal!'
  ) THEN
    INSERT INTO public.notifications (lco_id, customer_id, technician_id, recipient_role, title, message, type)
    VALUES (
      v_tech.lco_id,
      NULL,
      v_tech.id,
      'TECHNICIAN',
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
-- 6. PHASE 9 SERVICE REQUEST NOTIFICATION TRIGGERS
-- ══════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.trg_notify_service_request_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cust_name TEXT;
BEGIN
  SELECT full_name INTO v_cust_name
  FROM public.customers
  WHERE id = NEW.customer_id;

  -- 1. Notify LCO Admin
  INSERT INTO public.notifications (lco_id, customer_id, technician_id, recipient_role, title, message, type)
  VALUES (
    NEW.lco_id,
    NULL,
    NULL,
    'LCO_ADMIN',
    'New Service Request: ' || NEW.request_id,
    'Customer ' || COALESCE(v_cust_name, 'User') || ' submitted a new ' || NEW.category || ' request: "' || NEW.subject || '".',
    'INFO'
  );

  -- 2. Confirmation to Customer
  INSERT INTO public.notifications (lco_id, customer_id, technician_id, recipient_role, title, message, type)
  VALUES (
    NEW.lco_id,
    NEW.customer_id,
    NULL,
    'CUSTOMER',
    'Service Request Submitted',
    'Your service request ' || NEW.request_id || ' (' || NEW.subject || ') has been received and logged as OPEN.',
    'SUCCESS'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_service_requests_after_insert_notify ON public.service_requests;
CREATE TRIGGER trg_service_requests_after_insert_notify
  AFTER INSERT ON public.service_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_notify_service_request_created();


CREATE OR REPLACE FUNCTION public.trg_notify_service_request_updated()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cust_name TEXT;
BEGIN
  -- Case A: Customer cancelled the request -> Notify LCO Admin
  IF NEW.status = 'CANCELLED' AND OLD.status != 'CANCELLED' THEN
    SELECT full_name INTO v_cust_name FROM public.customers WHERE id = NEW.customer_id;

    INSERT INTO public.notifications (lco_id, customer_id, technician_id, recipient_role, title, message, type)
    VALUES (
      NEW.lco_id,
      NULL,
      NULL,
      'LCO_ADMIN',
      'Service Request Cancelled: ' || NEW.request_id,
      'Customer ' || COALESCE(v_cust_name, 'User') || ' cancelled service request ' || NEW.request_id || '.',
      'WARNING'
    );
  END IF;

  -- Case B: Status or Resolution Note updated by LCO/Tech -> Notify Customer
  IF (NEW.status IS DISTINCT FROM OLD.status AND NEW.status != 'CANCELLED')
     OR (NEW.resolution_notes IS DISTINCT FROM OLD.resolution_notes AND NEW.resolution_notes IS NOT NULL)
  THEN
    IF NEW.status = 'RESOLVED' THEN
      INSERT INTO public.notifications (lco_id, customer_id, technician_id, recipient_role, title, message, type)
      VALUES (
        NEW.lco_id,
        NEW.customer_id,
        NULL,
        'CUSTOMER',
        'Service Request Resolved: ' || NEW.request_id,
        'Your request ' || NEW.request_id || ' has been RESOLVED. ' || COALESCE('Resolution: ' || NEW.resolution_notes, ''),
        'SUCCESS'
      );
    ELSE
      INSERT INTO public.notifications (lco_id, customer_id, technician_id, recipient_role, title, message, type)
      VALUES (
        NEW.lco_id,
        NEW.customer_id,
        NULL,
        'CUSTOMER',
        'Service Request Status Updated',
        'Your service request ' || NEW.request_id || ' status changed to ' || NEW.status || '.' ||
        CASE WHEN NEW.assigned_technician_name IS NOT NULL THEN ' Assigned Technician: ' || NEW.assigned_technician_name ELSE '' END,
        'INFO'
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_service_requests_after_update_notify ON public.service_requests;
CREATE TRIGGER trg_service_requests_after_update_notify
  AFTER UPDATE ON public.service_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_notify_service_request_updated();


-- ══════════════════════════════════════════════
-- 7. TECHNICIAN ASSIGNMENT & ACTIVITY NOTIFICATION TRIGGERS
-- ══════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.trg_notify_technician_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tech_name TEXT;
BEGIN
  -- 1. Technician Assignment / Reassignment Notification
  IF NEW.assigned_technician_id IS NOT NULL AND (OLD.assigned_technician_id IS NULL OR NEW.assigned_technician_id IS DISTINCT FROM OLD.assigned_technician_id) THEN
    INSERT INTO public.notifications (lco_id, customer_id, technician_id, recipient_role, title, message, type)
    VALUES (
      NEW.lco_id,
      NULL,
      NEW.assigned_technician_id,
      'TECHNICIAN',
      'New Service Request Assigned',
      'You have been assigned to service request ' || NEW.request_id || ' (' || NEW.category || '): "' || NEW.subject || '".',
      'INFO'
    );
  END IF;

  -- 2. Notify LCO Admin when Technician starts work
  IF NEW.status = 'IN_PROGRESS' AND OLD.status != 'IN_PROGRESS' THEN
    SELECT full_name INTO v_tech_name FROM public.technicians WHERE id = NEW.assigned_technician_id;

    INSERT INTO public.notifications (lco_id, customer_id, technician_id, recipient_role, title, message, type)
    VALUES (
      NEW.lco_id,
      NULL,
      NULL,
      'LCO_ADMIN',
      'Technician Started Work: ' || NEW.request_id,
      'Technician ' || COALESCE(v_tech_name, 'Assigned') || ' started work on service request ' || NEW.request_id || '.',
      'INFO'
    );
  END IF;

  -- 3. Notify LCO Admin when Technician resolves request
  IF NEW.status = 'RESOLVED' AND OLD.status != 'RESOLVED' THEN
    SELECT full_name INTO v_tech_name FROM public.technicians WHERE id = NEW.assigned_technician_id;

    INSERT INTO public.notifications (lco_id, customer_id, technician_id, recipient_role, title, message, type)
    VALUES (
      NEW.lco_id,
      NULL,
      NULL,
      'LCO_ADMIN',
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
  EXECUTE FUNCTION public.trg_notify_technician_activity();

COMMIT;

-- ══════════════════════════════════════════════
-- DONE — Phase 11 Notification Architecture Schema Ready
-- ══════════════════════════════════════════════
