-- ============================================
-- LCO CONNECT — Phase 4: LCO Dashboard Schema
-- Run this in the Supabase SQL Editor AFTER
-- Phase 1, 2, and 3 SQL files.
-- ============================================
-- This file creates:
--   1. Helper function: get_lco_id()
--   2. customers table
--   3. Customer ID generation function
--   4. notifications table
--   5. RLS policies (non-recursive, idempotent)
--   6. Indexes
--   7. Triggers
--   8. Welcome notification seed
-- ============================================
-- SAFE & IDEMPOTENT: No DROP TABLE, no RLS disable,
-- safe to run multiple times.
-- ============================================


-- ══════════════════════════════════════════════
-- 1. HELPER FUNCTION: get_lco_id()
-- ══════════════════════════════════════════════
-- Returns the lco_applications.id for the
-- currently authenticated user. Used by RLS
-- policies to avoid recursive queries.
-- SECURITY DEFINER bypasses RLS on the
-- lco_applications table itself.

CREATE OR REPLACE FUNCTION public.get_lco_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.lco_applications
  WHERE user_id = auth.uid()
  AND status = 'APPROVED'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_lco_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_lco_id() TO authenticated;


-- ══════════════════════════════════════════════
-- 2. CUSTOMERS TABLE
-- ══════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.customers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id TEXT UNIQUE NOT NULL,
  lco_id UUID NOT NULL REFERENCES public.lco_applications(id) ON DELETE CASCADE,

  -- Personal information
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  pincode TEXT,

  -- Service information
  service_type TEXT NOT NULL DEFAULT 'Broadband',
  plan_name TEXT,
  service_status TEXT NOT NULL DEFAULT 'ACTIVE',
  connection_date DATE,

  -- Notes
  notes TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Constraints added safely
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customers_service_type_check'
  ) THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_service_type_check
      CHECK (service_type IN ('Cable TV', 'Broadband', 'Both', 'Other'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customers_service_status_check'
  ) THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_service_status_check
      CHECK (service_status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'DISCONNECTED'));
  END IF;
END $$;

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;


-- ══════════════════════════════════════════════
-- 3. CUSTOMER ID GENERATION
-- ══════════════════════════════════════════════
-- Generates IDs like: CUST-2026-0001

CREATE OR REPLACE FUNCTION public.generate_customer_id()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_year TEXT;
  next_seq INT;
  new_id TEXT;
BEGIN
  current_year := EXTRACT(YEAR FROM now())::TEXT;

  SELECT COALESCE(MAX(
    CAST(SPLIT_PART(customer_id, '-', 3) AS INT)
  ), 0) + 1
  INTO next_seq
  FROM public.customers
  WHERE customer_id LIKE 'CUST-' || current_year || '-%';

  new_id := 'CUST-' || current_year || '-' || LPAD(next_seq::TEXT, 4, '0');

  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_customer_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_customer_id() TO authenticated;


-- ══════════════════════════════════════════════
-- 4. NOTIFICATIONS TABLE
-- ══════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lco_id UUID NOT NULL REFERENCES public.lco_applications(id) ON DELETE CASCADE,

  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'INFO',
  is_read BOOLEAN NOT NULL DEFAULT false,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Constraints added safely
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notifications_type_check'
  ) THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT notifications_type_check
      CHECK (type IN ('INFO', 'WARNING', 'SUCCESS', 'SYSTEM'));
  END IF;
END $$;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;


-- ══════════════════════════════════════════════
-- 5. RLS POLICIES (Idempotent)
-- ══════════════════════════════════════════════
-- Uses get_lco_id() to avoid recursive RLS.
-- Each LCO can only access their own data.

-- ── Customers ──

DROP POLICY IF EXISTS "LCO can view own customers" ON public.customers;
CREATE POLICY "LCO can view own customers"
  ON public.customers
  FOR SELECT
  TO authenticated
  USING (lco_id = public.get_lco_id());

DROP POLICY IF EXISTS "LCO can insert own customers" ON public.customers;
CREATE POLICY "LCO can insert own customers"
  ON public.customers
  FOR INSERT
  TO authenticated
  WITH CHECK (lco_id = public.get_lco_id());

DROP POLICY IF EXISTS "LCO can update own customers" ON public.customers;
CREATE POLICY "LCO can update own customers"
  ON public.customers
  FOR UPDATE
  TO authenticated
  USING (lco_id = public.get_lco_id())
  WITH CHECK (lco_id = public.get_lco_id());

DROP POLICY IF EXISTS "Super admins can view all customers" ON public.customers;
CREATE POLICY "Super admins can view all customers"
  ON public.customers
  FOR SELECT
  TO authenticated
  USING (public.is_super_admin());

-- ── Notifications ──

DROP POLICY IF EXISTS "LCO can view own notifications" ON public.notifications;
CREATE POLICY "LCO can view own notifications"
  ON public.notifications
  FOR SELECT
  TO authenticated
  USING (lco_id = public.get_lco_id());

DROP POLICY IF EXISTS "LCO can update own notifications" ON public.notifications;
CREATE POLICY "LCO can update own notifications"
  ON public.notifications
  FOR UPDATE
  TO authenticated
  USING (lco_id = public.get_lco_id())
  WITH CHECK (lco_id = public.get_lco_id());

DROP POLICY IF EXISTS "Super admins can manage notifications" ON public.notifications;
CREATE POLICY "Super admins can manage notifications"
  ON public.notifications
  FOR ALL
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());


-- ══════════════════════════════════════════════
-- 6. INDEXES
-- ══════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_customers_lco_id
  ON public.customers(lco_id);

CREATE INDEX IF NOT EXISTS idx_customers_customer_id
  ON public.customers(customer_id);

CREATE INDEX IF NOT EXISTS idx_customers_service_status
  ON public.customers(service_status);

CREATE INDEX IF NOT EXISTS idx_notifications_lco_id
  ON public.notifications(lco_id);

CREATE INDEX IF NOT EXISTS idx_notifications_is_read
  ON public.notifications(is_read);


-- ══════════════════════════════════════════════
-- 7. AUTO-UPDATE updated_at FOR CUSTOMERS
-- ══════════════════════════════════════════════

DROP TRIGGER IF EXISTS customers_updated_at ON public.customers;
CREATE TRIGGER customers_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();


-- ══════════════════════════════════════════════
-- 8. WELCOME NOTIFICATION (seed)
-- ══════════════════════════════════════════════

INSERT INTO public.notifications (lco_id, title, message, type)
SELECT
  la.id,
  'Welcome to LCO Connect!',
  'Your LCO account has been approved. You can now start managing your customers and services from this dashboard.',
  'SUCCESS'
FROM public.lco_applications la
WHERE la.status = 'APPROVED'
AND NOT EXISTS (
  SELECT 1 FROM public.notifications n
  WHERE n.lco_id = la.id
  AND n.title = 'Welcome to LCO Connect!'
);


-- ══════════════════════════════════════════════
-- DONE — Phase 4 Schema Ready
-- ══════════════════════════════════════════════
