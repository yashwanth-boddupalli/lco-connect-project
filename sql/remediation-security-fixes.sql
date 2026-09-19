-- ============================================
-- LCO CONNECT — Remediation: Security Fixes
-- Run ONCE in Supabase SQL Editor AFTER all
-- Phase 1–6 and fix-multitenant-customer-id SQL.
-- ============================================
-- Addresses confirmed audit findings:
--   • link_customer_account hardening
--   • handle_new_user metadata trust
--   • customer_subscriptions tenant isolation
--   • customer self-update column guard
--   • customer notification visibility + INSERT
--   • stale Phase 1 policy cleanup (idempotent)
--   • generate_application_id lockdown
-- ============================================


-- ══════════════════════════════════════════════
-- 1. HARDEN handle_new_user() — only LCO_ADMIN from metadata
-- ══════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  requested_role TEXT := COALESCE(NEW.raw_user_meta_data->>'role', 'USER');
  profile_role TEXT;
BEGIN
  -- Only the LCO registration flow may request LCO_ADMIN via metadata.
  -- CUSTOMER / TECHNICIAN / SUPER_ADMIN must never come from client metadata.
  profile_role := CASE
    WHEN requested_role = 'LCO_ADMIN' THEN 'LCO_ADMIN'
    ELSE 'USER'
  END;

  INSERT INTO public.profiles (id, email, role, status)
  VALUES (
    NEW.id,
    NEW.email,
    profile_role,
    CASE WHEN profile_role = 'LCO_ADMIN' THEN 'PENDING' ELSE 'ACTIVE' END
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;


-- ══════════════════════════════════════════════
-- 2. HARDEN link_customer_account()
-- ══════════════════════════════════════════════

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
  v_auth_email TEXT;
  v_customer public.customers%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF coalesce(trim(p_customer_id), '') = '' OR coalesce(trim(p_email), '') = '' THEN
    RAISE EXCEPTION 'Customer ID and email are required.';
  END IF;

  -- Resolve authenticated email from JWT / auth.users
  v_auth_email := COALESCE(
    NULLIF(trim(auth.jwt() ->> 'email'), ''),
    (SELECT email FROM auth.users WHERE id = v_user_id)
  );

  IF v_auth_email IS NULL THEN
    RAISE EXCEPTION 'Unable to verify authenticated email.';
  END IF;

  -- Strict AND match on human customer_id + registered email (no OR fallback)
  SELECT * INTO v_customer
  FROM public.customers
  WHERE UPPER(TRIM(customer_id)) = UPPER(TRIM(p_customer_id))
    AND LOWER(TRIM(email)) = LOWER(TRIM(p_email));

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer record not found. Please verify your Customer ID and Email.';
  END IF;

  -- Authenticated user must own the registered email on the customer row
  IF LOWER(TRIM(v_auth_email)) <> LOWER(TRIM(v_customer.email)) THEN
    RAISE EXCEPTION 'Authenticated email does not match the registered customer email.';
  END IF;

  IF LOWER(TRIM(p_email)) <> LOWER(TRIM(v_customer.email)) THEN
    RAISE EXCEPTION 'Email does not match the customer record.';
  END IF;

  -- Idempotent: same user re-completing activation
  IF v_customer.invitation_status = 'ACTIVATED'
     AND v_customer.user_id IS NOT DISTINCT FROM v_user_id THEN
    UPDATE public.profiles
    SET role = 'CUSTOMER', status = 'ACTIVE'
    WHERE id = v_user_id
      AND role IN ('USER', 'CUSTOMER');

    RETURN jsonb_build_object(
      'success', true,
      'customer_id', v_customer.customer_id,
      'full_name', v_customer.full_name,
      'already_activated', true
    );
  END IF;

  IF v_customer.invitation_status = 'DISABLED' THEN
    RAISE EXCEPTION 'This customer account has been disabled.';
  END IF;

  IF v_customer.user_id IS NOT NULL AND v_customer.user_id <> v_user_id THEN
    RAISE EXCEPTION 'This customer account has already been activated.';
  END IF;

  IF v_customer.invitation_status = 'ACTIVATED' THEN
    RAISE EXCEPTION 'This customer account has already been activated.';
  END IF;

  -- Must have received an invitation email (server-side invite flow)
  IF v_customer.invitation_status NOT IN ('INVITED', 'FAILED') THEN
    RAISE EXCEPTION 'Customer invitation required before activation.';
  END IF;

  -- Do not overwrite privileged roles
  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id;
  IF FOUND AND v_profile.role NOT IN ('USER', 'CUSTOMER') THEN
    RAISE EXCEPTION 'This account cannot be linked as a customer.';
  END IF;

  -- Link auth user; preserve lco_id and customer_id (tenant ownership unchanged)
  UPDATE public.customers
  SET user_id = v_user_id,
      invitation_status = 'ACTIVATED',
      updated_at = now()
  WHERE id = v_customer.id;

  UPDATE public.profiles
  SET role = 'CUSTOMER',
      status = 'ACTIVE'
  WHERE id = v_user_id
    AND role IN ('USER', 'CUSTOMER');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unable to activate customer profile.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.notifications
    WHERE customer_id = v_customer.id
      AND title = 'Welcome to Customer Portal!'
  ) THEN
    INSERT INTO public.notifications (lco_id, customer_id, title, message, type)
    VALUES (
      v_customer.lco_id,
      v_customer.id,
      'Welcome to Customer Portal!',
      'Your customer account has been activated. You can now view your subscription, service plans, and account details.',
      'SUCCESS'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'customer_id', v_customer.customer_id,
    'full_name', v_customer.full_name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.link_customer_account(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_customer_account(TEXT, TEXT) TO authenticated;


-- ══════════════════════════════════════════════
-- 3. CUSTOMER SELF-UPDATE COLUMN GUARD (trigger)
-- ══════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.trg_guard_customer_self_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only restrict customer self-service updates (not LCO admin updates)
  IF OLD.user_id = auth.uid() AND public.get_lco_id() IS NULL THEN
    IF NEW.lco_id IS DISTINCT FROM OLD.lco_id
      OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
      OR NEW.user_id IS DISTINCT FROM OLD.user_id
      OR NEW.full_name IS DISTINCT FROM OLD.full_name
      OR NEW.service_type IS DISTINCT FROM OLD.service_type
      OR NEW.plan_name IS DISTINCT FROM OLD.plan_name
      OR NEW.service_status IS DISTINCT FROM OLD.service_status
      OR NEW.connection_date IS DISTINCT FROM OLD.connection_date
      OR NEW.notes IS DISTINCT FROM OLD.notes
      OR NEW.invitation_status IS DISTINCT FROM OLD.invitation_status
      OR NEW.invitation_sent_at IS DISTINCT FROM OLD.invitation_sent_at
      OR NEW.last_invitation_attempt IS DISTINCT FROM OLD.last_invitation_attempt
    THEN
      RAISE EXCEPTION 'You can only update your contact information.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customers_guard_self_update ON public.customers;
CREATE TRIGGER trg_customers_guard_self_update
  BEFORE UPDATE ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_guard_customer_self_update();


-- ══════════════════════════════════════════════
-- 4. CUSTOMER SUBSCRIPTIONS — tenant isolation
-- ══════════════════════════════════════════════

DROP POLICY IF EXISTS "LCO can insert own subscriptions" ON public.customer_subscriptions;
CREATE POLICY "LCO can insert own subscriptions"
  ON public.customer_subscriptions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    lco_id = public.get_lco_id()
    AND EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = customer_id
        AND c.lco_id = public.get_lco_id()
    )
  );

DROP POLICY IF EXISTS "LCO can update own subscriptions" ON public.customer_subscriptions;
CREATE POLICY "LCO can update own subscriptions"
  ON public.customer_subscriptions
  FOR UPDATE
  TO authenticated
  USING (lco_id = public.get_lco_id())
  WITH CHECK (
    lco_id = public.get_lco_id()
    AND EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = customer_id
        AND c.lco_id = public.get_lco_id()
    )
  );


-- ══════════════════════════════════════════════
-- 5. NOTIFICATIONS — customer visibility + plan requests
-- ══════════════════════════════════════════════

DROP POLICY IF EXISTS "Customer can view own notifications" ON public.notifications;
CREATE POLICY "Customer can view own notifications"
  ON public.notifications
  FOR SELECT
  TO authenticated
  USING (customer_id = public.get_customer_id());

DROP POLICY IF EXISTS "Customer can insert plan request notifications" ON public.notifications;
CREATE POLICY "Customer can insert plan request notifications"
  ON public.notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (
    customer_id = public.get_customer_id()
    AND lco_id = public.get_customer_lco_id()
    AND type IN ('INFO', 'WARNING', 'SUCCESS', 'SYSTEM')
  );


-- ══════════════════════════════════════════════
-- 6. LOCK DOWN generate_application_id()
-- ══════════════════════════════════════════════

REVOKE ALL ON FUNCTION public.generate_application_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_application_id() TO authenticated;


-- ══════════════════════════════════════════════
-- 7. IDEMPOTENT CLEANUP — Phase 1 permissive policies (if still present)
-- ══════════════════════════════════════════════

DROP POLICY IF EXISTS "Allow anonymous inserts on lco_applications" ON public.lco_applications;
DROP POLICY IF EXISTS "Allow anonymous reads on lco_applications by application_id" ON public.lco_applications;
DROP POLICY IF EXISTS "Allow authenticated full access on lco_applications" ON public.lco_applications;
DROP POLICY IF EXISTS "Allow anonymous inserts on verification_documents" ON public.verification_documents;
DROP POLICY IF EXISTS "Allow anonymous reads on verification_documents" ON public.verification_documents;
DROP POLICY IF EXISTS "Allow authenticated full access on verification_documents" ON public.verification_documents;
DROP POLICY IF EXISTS "Allow anonymous uploads to verification-documents" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated reads on verification-documents" ON storage.objects;


-- ══════════════════════════════════════════════
-- DONE — Remediation Security Fixes
-- ══════════════════════════════════════════════
