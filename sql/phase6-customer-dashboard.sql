-- ============================================
-- LCO CONNECT — Phase 6: Customer Accounts & Dashboard Schema
-- Run this in the Supabase SQL Editor AFTER
-- Phase 1, 2, 3, 4, and 5 SQL files.
-- ============================================
-- This file creates/updates:
--   1. Schema modifications (user_id on customers, customer_id on notifications)
--   2. Profiles status check constraint update (adds DISABLED)
--   3. Helper functions: get_customer_id(), get_customer_lco_id()
--   4. RPC function: link_customer_account()
--   5. Idempotent RLS policies for CUSTOMER role
--   6. Indexes for customer queries
-- ============================================
-- SAFE & IDEMPOTENT: Safe to run multiple times.
-- ============================================


-- ══════════════════════════════════════════════
-- 1. SCHEMA EXTENSIONS
-- ══════════════════════════════════════════════

-- Link customer to auth.users account
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Allow customer-specific notifications
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.customers(id) ON DELETE CASCADE;

-- Ensure profiles status constraint supports DISABLED
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_status_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_status_check
  CHECK (status IN ('ACTIVE', 'PENDING', 'REJECTED', 'SUSPENDED', 'DISABLED'));


-- ══════════════════════════════════════════════
-- 2. HELPER FUNCTIONS FOR CUSTOMERS
-- ══════════════════════════════════════════════

-- Returns public.customers.id for the current auth user
CREATE OR REPLACE FUNCTION public.get_customer_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.customers
  WHERE user_id = auth.uid()
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_customer_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_customer_id() TO authenticated;


-- Returns public.customers.lco_id for the current auth user
CREATE OR REPLACE FUNCTION public.get_customer_lco_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT lco_id FROM public.customers
  WHERE user_id = auth.uid()
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_customer_lco_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_customer_lco_id() TO authenticated;


-- ══════════════════════════════════════════════
-- 3. CUSTOMER ACCOUNT LINKING RPC
-- ══════════════════════════════════════════════
-- Called by customer during activation to link their
-- newly created auth user ID to their pre-existing customer record.

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

  -- Find customer record matching Customer ID and Email
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

  -- Link auth user ID to customer record
  UPDATE public.customers
  SET user_id = v_user_id,
      updated_at = now()
  WHERE id = v_customer.id;

  -- Ensure user profile has role = CUSTOMER and status = ACTIVE
  UPDATE public.profiles
  SET role = 'CUSTOMER',
      status = 'ACTIVE'
  WHERE id = v_user_id;

  -- Create welcome notification for customer
  INSERT INTO public.notifications (lco_id, customer_id, title, message, type)
  VALUES (
    v_customer.lco_id,
    v_customer.id,
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


-- ══════════════════════════════════════════════
-- 4. RLS POLICIES FOR CUSTOMER ISOLATION
-- ══════════════════════════════════════════════

-- ── Customers Table ──

DROP POLICY IF EXISTS "Customer can view own customer record" ON public.customers;
CREATE POLICY "Customer can view own customer record"
  ON public.customers
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Customer can update own safe details" ON public.customers;
CREATE POLICY "Customer can update own safe details"
  ON public.customers
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ── LCO Applications Table (Provider info view) ──

DROP POLICY IF EXISTS "Customer can view own LCO provider info" ON public.lco_applications;
CREATE POLICY "Customer can view own LCO provider info"
  ON public.lco_applications
  FOR SELECT
  TO authenticated
  USING (id = public.get_customer_lco_id());

-- ── Service Plans Table ──

DROP POLICY IF EXISTS "Customer can view own LCO active plans" ON public.service_plans;
CREATE POLICY "Customer can view own LCO active plans"
  ON public.service_plans
  FOR SELECT
  TO authenticated
  USING (
    lco_id = public.get_customer_lco_id()
    AND status = 'ACTIVE'
  );

-- ── Customer Subscriptions Table ──

DROP POLICY IF EXISTS "Customer can view own subscriptions" ON public.customer_subscriptions;
CREATE POLICY "Customer can view own subscriptions"
  ON public.customer_subscriptions
  FOR SELECT
  TO authenticated
  USING (customer_id = public.get_customer_id());

-- ── Notifications Table ──

DROP POLICY IF EXISTS "Customer can view own notifications" ON public.notifications;
CREATE POLICY "Customer can view own notifications"
  ON public.notifications
  FOR SELECT
  TO authenticated
  USING (
    customer_id = public.get_customer_id()
    OR (lco_id = public.get_customer_lco_id() AND customer_id IS NULL)
  );

DROP POLICY IF EXISTS "Customer can update own notifications" ON public.notifications;
CREATE POLICY "Customer can update own notifications"
  ON public.notifications
  FOR UPDATE
  TO authenticated
  USING (customer_id = public.get_customer_id())
  WITH CHECK (customer_id = public.get_customer_id());


-- ══════════════════════════════════════════════
-- 5. INDEXES
-- ══════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_customers_user_id
  ON public.customers(user_id);

CREATE INDEX IF NOT EXISTS idx_notifications_customer_id
  ON public.notifications(customer_id);


-- ══════════════════════════════════════════════
-- DONE — Phase 6 Customer Schema Ready
-- ══════════════════════════════════════════════
