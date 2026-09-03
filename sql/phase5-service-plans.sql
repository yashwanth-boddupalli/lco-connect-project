-- ============================================
-- LCO CONNECT — Phase 5: Service Plans & Subscriptions
-- Run this in the Supabase SQL Editor AFTER
-- Phase 1, 2, 3, and 4 SQL files.
-- ============================================
-- This file creates:
--   1. service_plans table
--   2. customer_subscriptions table
--   3. Helper function / trigger for updated_at
--   4. Idempotent RLS policies (non-recursive)
--   5. Performance indexes
-- ============================================
-- SAFE & IDEMPOTENT: Safe to run multiple times.
-- ============================================


-- ══════════════════════════════════════════════
-- 1. SERVICE PLANS TABLE
-- ══════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.service_plans (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lco_id UUID NOT NULL REFERENCES public.lco_applications(id) ON DELETE CASCADE,

  -- General plan information
  name TEXT NOT NULL,
  description TEXT,
  service_type TEXT NOT NULL DEFAULT 'Broadband',
  price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  duration INT NOT NULL DEFAULT 1,
  duration_unit TEXT NOT NULL DEFAULT 'MONTHS',

  -- Broadband specific fields
  speed_mbps INT,
  data_limit_gb INT, -- NULL means Unlimited

  -- Cable TV specific fields
  package_type TEXT, -- e.g., 'Base Pack', 'Add-on', 'Bouquet', 'A-la-carte'
  channel_count INT,

  -- Status
  status TEXT NOT NULL DEFAULT 'ACTIVE',

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Constraints added safely
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'service_plans_service_type_check'
  ) THEN
    ALTER TABLE public.service_plans
      ADD CONSTRAINT service_plans_service_type_check
      CHECK (service_type IN ('Broadband', 'Cable TV', 'Both', 'Other'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'service_plans_duration_unit_check'
  ) THEN
    ALTER TABLE public.service_plans
      ADD CONSTRAINT service_plans_duration_unit_check
      CHECK (duration_unit IN ('DAYS', 'MONTHS', 'YEARS'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'service_plans_status_check'
  ) THEN
    ALTER TABLE public.service_plans
      ADD CONSTRAINT service_plans_status_check
      CHECK (status IN ('ACTIVE', 'INACTIVE'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'service_plans_price_check'
  ) THEN
    ALTER TABLE public.service_plans
      ADD CONSTRAINT service_plans_price_check
      CHECK (price >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'service_plans_duration_check'
  ) THEN
    ALTER TABLE public.service_plans
      ADD CONSTRAINT service_plans_duration_check
      CHECK (duration > 0);
  END IF;
END $$;

ALTER TABLE public.service_plans ENABLE ROW LEVEL SECURITY;


-- ══════════════════════════════════════════════
-- 2. CUSTOMER SUBSCRIPTIONS TABLE
-- ══════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.customer_subscriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lco_id UUID NOT NULL REFERENCES public.lco_applications(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  plan_id UUID REFERENCES public.service_plans(id) ON DELETE SET NULL,

  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Constraints added safely
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customer_subscriptions_status_check'
  ) THEN
    ALTER TABLE public.customer_subscriptions
      ADD CONSTRAINT customer_subscriptions_status_check
      CHECK (status IN ('ACTIVE', 'EXPIRED', 'CANCELLED', 'PENDING'));
  END IF;
END $$;

ALTER TABLE public.customer_subscriptions ENABLE ROW LEVEL SECURITY;


-- ══════════════════════════════════════════════
-- 3. RLS POLICIES (Idempotent & Tenant Isolated)
-- ══════════════════════════════════════════════
-- Uses get_lco_id() to enforce that an LCO
-- can only read/write their own plans & subscriptions.

-- ── Service Plans ──

DROP POLICY IF EXISTS "LCO can view own service plans" ON public.service_plans;
CREATE POLICY "LCO can view own service plans"
  ON public.service_plans
  FOR SELECT
  TO authenticated
  USING (lco_id = public.get_lco_id());

DROP POLICY IF EXISTS "LCO can insert own service plans" ON public.service_plans;
CREATE POLICY "LCO can insert own service plans"
  ON public.service_plans
  FOR INSERT
  TO authenticated
  WITH CHECK (lco_id = public.get_lco_id());

DROP POLICY IF EXISTS "LCO can update own service plans" ON public.service_plans;
CREATE POLICY "LCO can update own service plans"
  ON public.service_plans
  FOR UPDATE
  TO authenticated
  USING (lco_id = public.get_lco_id())
  WITH CHECK (lco_id = public.get_lco_id());

DROP POLICY IF EXISTS "Super admins can view all service plans" ON public.service_plans;
CREATE POLICY "Super admins can view all service plans"
  ON public.service_plans
  FOR SELECT
  TO authenticated
  USING (public.is_super_admin());

-- ── Customer Subscriptions ──

DROP POLICY IF EXISTS "LCO can view own subscriptions" ON public.customer_subscriptions;
CREATE POLICY "LCO can view own subscriptions"
  ON public.customer_subscriptions
  FOR SELECT
  TO authenticated
  USING (lco_id = public.get_lco_id());

DROP POLICY IF EXISTS "LCO can insert own subscriptions" ON public.customer_subscriptions;
CREATE POLICY "LCO can insert own subscriptions"
  ON public.customer_subscriptions
  FOR INSERT
  TO authenticated
  WITH CHECK (lco_id = public.get_lco_id());

DROP POLICY IF EXISTS "LCO can update own subscriptions" ON public.customer_subscriptions;
CREATE POLICY "LCO can update own subscriptions"
  ON public.customer_subscriptions
  FOR UPDATE
  TO authenticated
  USING (lco_id = public.get_lco_id())
  WITH CHECK (lco_id = public.get_lco_id());

DROP POLICY IF EXISTS "Super admins can view all subscriptions" ON public.customer_subscriptions;
CREATE POLICY "Super admins can view all subscriptions"
  ON public.customer_subscriptions
  FOR SELECT
  TO authenticated
  USING (public.is_super_admin());


-- ══════════════════════════════════════════════
-- 4. INDEXES
-- ══════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_service_plans_lco_id
  ON public.service_plans(lco_id);

CREATE INDEX IF NOT EXISTS idx_service_plans_service_type
  ON public.service_plans(service_type);

CREATE INDEX IF NOT EXISTS idx_service_plans_status
  ON public.service_plans(status);

CREATE INDEX IF NOT EXISTS idx_customer_subscriptions_lco_id
  ON public.customer_subscriptions(lco_id);

CREATE INDEX IF NOT EXISTS idx_customer_subscriptions_customer_id
  ON public.customer_subscriptions(customer_id);

CREATE INDEX IF NOT EXISTS idx_customer_subscriptions_plan_id
  ON public.customer_subscriptions(plan_id);

CREATE INDEX IF NOT EXISTS idx_customer_subscriptions_status
  ON public.customer_subscriptions(status);


-- ══════════════════════════════════════════════
-- 5. TRIGGERS (Auto update updated_at)
-- ══════════════════════════════════════════════

DROP TRIGGER IF EXISTS service_plans_updated_at ON public.service_plans;
CREATE TRIGGER service_plans_updated_at
  BEFORE UPDATE ON public.service_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS customer_subscriptions_updated_at ON public.customer_subscriptions;
CREATE TRIGGER customer_subscriptions_updated_at
  BEFORE UPDATE ON public.customer_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();


-- ══════════════════════════════════════════════
-- DONE — Phase 5 Schema Ready
-- ══════════════════════════════════════════════
