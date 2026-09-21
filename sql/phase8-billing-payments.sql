-- ============================================
-- LCO CONNECT — Phase 8: Billing & Payments
-- Run this in the Supabase SQL Editor AFTER
-- all previous Phase SQL files.
-- ============================================
-- This file creates:
--   1. PostgreSQL sequences for bill/payment numbering
--   2. customer_bills table
--   3. customer_payments table
--   4. Number generation functions (concurrency-safe)
--   5. CHECK constraints
--   6. Indexes
--   7. updated_at trigger (reuses existing function)
--   8. RLS policies (tenant + customer isolation)
-- ============================================
-- SAFE & IDEMPOTENT: Safe to run multiple times.
-- ============================================


-- ══════════════════════════════════════════════
-- 1. SEQUENCES FOR BILL & PAYMENT NUMBERING
-- ══════════════════════════════════════════════
-- PostgreSQL sequences are concurrency-safe and
-- guarantee unique numbers even under concurrent
-- requests. No MAX()+1 pattern used.

CREATE SEQUENCE IF NOT EXISTS public.bill_number_seq
  START WITH 1
  INCREMENT BY 1
  NO MAXVALUE
  CACHE 1;

CREATE SEQUENCE IF NOT EXISTS public.payment_number_seq
  START WITH 1
  INCREMENT BY 1
  NO MAXVALUE
  CACHE 1;


-- ══════════════════════════════════════════════
-- 2. BILL NUMBER GENERATION FUNCTION
-- ══════════════════════════════════════════════
-- Generates: BILL-2026-0001, BILL-2026-0002, etc.
-- Year prefix from current date. Sequence ensures
-- uniqueness across all LCOs globally.

CREATE OR REPLACE FUNCTION public.generate_bill_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year TEXT;
  v_seq  BIGINT;
BEGIN
  v_year := EXTRACT(YEAR FROM now())::TEXT;
  v_seq  := nextval('public.bill_number_seq');
  RETURN 'BILL-' || v_year || '-' || LPAD(v_seq::TEXT, 4, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.generate_bill_number() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_bill_number() TO authenticated;


-- ══════════════════════════════════════════════
-- 3. PAYMENT NUMBER GENERATION FUNCTION
-- ══════════════════════════════════════════════
-- Generates: PAY-2026-0001, PAY-2026-0002, etc.

CREATE OR REPLACE FUNCTION public.generate_payment_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year TEXT;
  v_seq  BIGINT;
BEGIN
  v_year := EXTRACT(YEAR FROM now())::TEXT;
  v_seq  := nextval('public.payment_number_seq');
  RETURN 'PAY-' || v_year || '-' || LPAD(v_seq::TEXT, 4, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.generate_payment_number() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_payment_number() TO authenticated;


-- ══════════════════════════════════════════════
-- 4. CUSTOMER_BILLS TABLE
-- ══════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.customer_bills (
  id                   UUID           DEFAULT gen_random_uuid() PRIMARY KEY,
  bill_number          TEXT           UNIQUE NOT NULL,
  lco_id               UUID           NOT NULL REFERENCES public.lco_applications(id) ON DELETE CASCADE,
  customer_id          UUID           NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  subscription_id      UUID           REFERENCES public.customer_subscriptions(id) ON DELETE SET NULL,

  -- Billing details
  plan_name            TEXT           NOT NULL,
  amount               NUMERIC(12,2)  NOT NULL,
  paid_amount          NUMERIC(12,2)  NOT NULL DEFAULT 0,
  billing_period_start DATE           NOT NULL,
  billing_period_end   DATE           NOT NULL,
  due_date             DATE           NOT NULL,
  status               TEXT           NOT NULL DEFAULT 'PENDING',
  notes                TEXT,

  -- Timestamps
  created_at           TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ    NOT NULL DEFAULT now()
);


-- ══════════════════════════════════════════════
-- 5. CUSTOMER_BILLS CONSTRAINTS
-- ══════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customer_bills_amount_check'
  ) THEN
    ALTER TABLE public.customer_bills
      ADD CONSTRAINT customer_bills_amount_check
      CHECK (amount >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customer_bills_paid_amount_check'
  ) THEN
    ALTER TABLE public.customer_bills
      ADD CONSTRAINT customer_bills_paid_amount_check
      CHECK (paid_amount >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customer_bills_paid_lte_amount_check'
  ) THEN
    ALTER TABLE public.customer_bills
      ADD CONSTRAINT customer_bills_paid_lte_amount_check
      CHECK (paid_amount <= amount);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customer_bills_billing_period_check'
  ) THEN
    ALTER TABLE public.customer_bills
      ADD CONSTRAINT customer_bills_billing_period_check
      CHECK (billing_period_start <= billing_period_end);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customer_bills_status_check'
  ) THEN
    ALTER TABLE public.customer_bills
      ADD CONSTRAINT customer_bills_status_check
      CHECK (status IN ('PENDING', 'PAID', 'OVERDUE', 'CANCELLED'));
  END IF;
END $$;


-- ══════════════════════════════════════════════
-- 6. CUSTOMER_PAYMENTS TABLE
-- ══════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.customer_payments (
  id                    UUID           DEFAULT gen_random_uuid() PRIMARY KEY,
  payment_number        TEXT           UNIQUE NOT NULL,
  lco_id                UUID           NOT NULL REFERENCES public.lco_applications(id) ON DELETE CASCADE,
  customer_id           UUID           NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  bill_id               UUID           NOT NULL REFERENCES public.customer_bills(id) ON DELETE CASCADE,

  -- Payment details
  amount                NUMERIC(12,2)  NOT NULL,
  payment_method        TEXT           NOT NULL DEFAULT 'CASH',
  payment_date          TIMESTAMPTZ    NOT NULL DEFAULT now(),
  transaction_reference TEXT,
  notes                 TEXT,
  recorded_by           UUID           REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Payment gateway fields (gateway-neutral)
  -- Supports Razorpay, future providers, or manual entry.
  -- No secrets or API keys are stored here.
  gateway               TEXT,
  gateway_order_id      TEXT,
  gateway_payment_id    TEXT,
  gateway_signature     TEXT,

  -- Timestamps
  created_at            TIMESTAMPTZ    NOT NULL DEFAULT now()
);


-- ══════════════════════════════════════════════
-- 7. CUSTOMER_PAYMENTS CONSTRAINTS
-- ══════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customer_payments_amount_check'
  ) THEN
    ALTER TABLE public.customer_payments
      ADD CONSTRAINT customer_payments_amount_check
      CHECK (amount > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customer_payments_payment_method_check'
  ) THEN
    ALTER TABLE public.customer_payments
      ADD CONSTRAINT customer_payments_payment_method_check
      CHECK (payment_method IN ('CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'ONLINE', 'OTHER'));
  END IF;
END $$;


-- ══════════════════════════════════════════════
-- 8. ENABLE ROW LEVEL SECURITY
-- ══════════════════════════════════════════════

ALTER TABLE public.customer_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_payments ENABLE ROW LEVEL SECURITY;


-- ══════════════════════════════════════════════
-- 9. RLS POLICIES — CUSTOMER_BILLS
-- ══════════════════════════════════════════════
-- LCO Admin: full CRUD on own tenant bills.
-- Customer: read-only access to own bills.
-- Super Admin: read-only global access.

-- ── LCO Admin SELECT ──
DROP POLICY IF EXISTS "LCO can view own bills" ON public.customer_bills;
CREATE POLICY "LCO can view own bills"
  ON public.customer_bills
  FOR SELECT
  TO authenticated
  USING (lco_id = public.get_lco_id());

-- ── LCO Admin INSERT ──
-- Cross-tenant guard: customer must belong to the same LCO.
DROP POLICY IF EXISTS "LCO can insert own bills" ON public.customer_bills;
CREATE POLICY "LCO can insert own bills"
  ON public.customer_bills
  FOR INSERT
  TO authenticated
  WITH CHECK (
    lco_id = public.get_lco_id()
    AND EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = customer_bills.customer_id
        AND c.lco_id = public.get_lco_id()
    )
  );

-- ── LCO Admin UPDATE ──
-- Cross-tenant guard on both USING and WITH CHECK.
DROP POLICY IF EXISTS "LCO can update own bills" ON public.customer_bills;
CREATE POLICY "LCO can update own bills"
  ON public.customer_bills
  FOR UPDATE
  TO authenticated
  USING (lco_id = public.get_lco_id())
  WITH CHECK (
    lco_id = public.get_lco_id()
    AND EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = customer_bills.customer_id
        AND c.lco_id = public.get_lco_id()
    )
  );

-- ── Customer SELECT ──
DROP POLICY IF EXISTS "Customer can view own bills" ON public.customer_bills;
CREATE POLICY "Customer can view own bills"
  ON public.customer_bills
  FOR SELECT
  TO authenticated
  USING (customer_id = public.get_customer_id());

-- ── Super Admin SELECT ──
DROP POLICY IF EXISTS "Super admins can view all bills" ON public.customer_bills;
CREATE POLICY "Super admins can view all bills"
  ON public.customer_bills
  FOR SELECT
  TO authenticated
  USING (public.is_super_admin());


-- ══════════════════════════════════════════════
-- 10. RLS POLICIES — CUSTOMER_PAYMENTS
-- ══════════════════════════════════════════════
-- LCO Admin: SELECT + INSERT on own tenant payments.
-- Customer: read-only access to own payment receipts.
-- Super Admin: read-only global access.
-- Note: LCO Admin cannot UPDATE or DELETE payments
-- (financial audit trail should be immutable).

-- ── LCO Admin SELECT ──
DROP POLICY IF EXISTS "LCO can view own payments" ON public.customer_payments;
CREATE POLICY "LCO can view own payments"
  ON public.customer_payments
  FOR SELECT
  TO authenticated
  USING (lco_id = public.get_lco_id());

-- ── LCO Admin INSERT ──
-- Cross-tenant guard: bill must belong to the same LCO.
DROP POLICY IF EXISTS "LCO can insert own payments" ON public.customer_payments;
CREATE POLICY "LCO can insert own payments"
  ON public.customer_payments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    lco_id = public.get_lco_id()
    AND EXISTS (
      SELECT 1 FROM public.customer_bills b
      WHERE b.id = customer_payments.bill_id
        AND b.lco_id = public.get_lco_id()
    )
  );

-- ── Customer SELECT ──
DROP POLICY IF EXISTS "Customer can view own payments" ON public.customer_payments;
CREATE POLICY "Customer can view own payments"
  ON public.customer_payments
  FOR SELECT
  TO authenticated
  USING (customer_id = public.get_customer_id());

-- ── Super Admin SELECT ──
DROP POLICY IF EXISTS "Super admins can view all payments" ON public.customer_payments;
CREATE POLICY "Super admins can view all payments"
  ON public.customer_payments
  FOR SELECT
  TO authenticated
  USING (public.is_super_admin());


-- ══════════════════════════════════════════════
-- 11. INDEXES — CUSTOMER_BILLS
-- ══════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_customer_bills_lco_id
  ON public.customer_bills(lco_id);

CREATE INDEX IF NOT EXISTS idx_customer_bills_customer_id
  ON public.customer_bills(customer_id);

CREATE INDEX IF NOT EXISTS idx_customer_bills_subscription_id
  ON public.customer_bills(subscription_id);

CREATE INDEX IF NOT EXISTS idx_customer_bills_status
  ON public.customer_bills(status);

CREATE INDEX IF NOT EXISTS idx_customer_bills_due_date
  ON public.customer_bills(due_date);

-- bill_number already has a UNIQUE constraint (implicit unique index)


-- ══════════════════════════════════════════════
-- 12. INDEXES — CUSTOMER_PAYMENTS
-- ══════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_customer_payments_lco_id
  ON public.customer_payments(lco_id);

CREATE INDEX IF NOT EXISTS idx_customer_payments_customer_id
  ON public.customer_payments(customer_id);

CREATE INDEX IF NOT EXISTS idx_customer_payments_bill_id
  ON public.customer_payments(bill_id);

CREATE INDEX IF NOT EXISTS idx_customer_payments_payment_date
  ON public.customer_payments(payment_date);

-- payment_number already has a UNIQUE constraint (implicit unique index)

-- Gateway lookup indexes (for webhook reconciliation)
CREATE INDEX IF NOT EXISTS idx_customer_payments_gateway_order_id
  ON public.customer_payments(gateway_order_id)
  WHERE gateway_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customer_payments_gateway_payment_id
  ON public.customer_payments(gateway_payment_id)
  WHERE gateway_payment_id IS NOT NULL;


-- ══════════════════════════════════════════════
-- 13. UPDATED_AT TRIGGER — CUSTOMER_BILLS
-- ══════════════════════════════════════════════
-- Reuses the existing public.update_updated_at()
-- function defined in Phase 1 (lco-registration.sql).
-- customer_payments intentionally has NO updated_at
-- column — payment records are append-only for
-- financial audit integrity.

DROP TRIGGER IF EXISTS customer_bills_updated_at ON public.customer_bills;
CREATE TRIGGER customer_bills_updated_at
  BEFORE UPDATE ON public.customer_bills
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();


-- ══════════════════════════════════════════════
-- DONE — Phase 8 Billing & Payments Schema Ready
-- ══════════════════════════════════════════════
