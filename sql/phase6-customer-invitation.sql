-- ============================================
-- LCO CONNECT — Phase 6: Customer Activation Email Schema
-- Run this in the Supabase SQL Editor AFTER
-- Phase 6 base SQL file.
-- ============================================
-- This file adds:
--   1. invitation_status, invitation_sent_at, last_invitation_attempt to customers
--   2. Check constraint for invitation_status
--   3. Index for invitation_status
--   4. Updates link_customer_account RPC to set invitation_status = 'ACTIVATED'
-- ============================================
-- SAFE & IDEMPOTENT: Safe to run multiple times.
-- ============================================


-- ══════════════════════════════════════════════
-- 1. ADD INVITATION FIELDS TO CUSTOMERS TABLE
-- ══════════════════════════════════════════════

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS invitation_status TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS invitation_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_invitation_attempt TIMESTAMPTZ;

-- Safe constraint addition
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customers_invitation_status_check'
  ) THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_invitation_status_check
      CHECK (invitation_status IN ('PENDING', 'INVITED', 'ACTIVATED', 'FAILED', 'DISABLED'));
  END IF;
END $$;

-- Index for invitation status
CREATE INDEX IF NOT EXISTS idx_customers_invitation_status
  ON public.customers(invitation_status);


-- ══════════════════════════════════════════════
-- 2. UPDATE RPC FUNCTION: link_customer_account
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
    -- Fallback search by email or customer_id alone if user is logged in via invite token
    SELECT * INTO v_customer
    FROM public.customers
    WHERE UPPER(TRIM(customer_id)) = UPPER(TRIM(p_customer_id))
       OR LOWER(TRIM(email)) = LOWER(TRIM(p_email));
  END IF;

  IF v_customer.id IS NULL THEN
    RAISE EXCEPTION 'Customer record not found. Please verify your Customer ID and Email.';
  END IF;

  IF v_customer.user_id IS NOT NULL AND v_customer.user_id != v_user_id THEN
    RAISE EXCEPTION 'This customer account has already been activated.';
  END IF;

  -- Link auth user ID to customer record & mark ACTIVATED
  UPDATE public.customers
  SET user_id = v_user_id,
      invitation_status = 'ACTIVATED',
      updated_at = now()
  WHERE id = v_customer.id;

  -- Ensure user profile has role = CUSTOMER and status = ACTIVE
  UPDATE public.profiles
  SET role = 'CUSTOMER',
      status = 'ACTIVE'
  WHERE id = v_user_id;

  -- Create welcome notification for customer if not already sent
  IF NOT EXISTS (
    SELECT 1 FROM public.notifications
    WHERE customer_id = v_customer.id AND title = 'Welcome to Customer Portal!'
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
-- DONE — Phase 6 Customer Invitation Schema
-- ══════════════════════════════════════════════
