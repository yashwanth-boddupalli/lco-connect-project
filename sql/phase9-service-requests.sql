-- ============================================
-- LCO CONNECT — Phase 9: Service Requests & Complaint Management Schema
-- Run this in the Supabase SQL Editor AFTER
-- Phase 1, 2, 3, 4, 5, 6, 7, and 8 SQL files.
-- ============================================
-- This file creates:
--   1. service_requests table
--   2. Check constraints for category, priority, status
--   3. Helper function: generate_request_id()
--   4. Triggers: auto-generated request_id, timestamps, and customer update guards
--   5. Trusted DB notification triggers (runs SECURITY DEFINER on insert/update)
--   6. Idempotent RLS policies for Customer, LCO Admin, and Super Admin
--   7. Indexes for performant multi-tenant filtering
-- ============================================
-- SAFE & IDEMPOTENT: Safe to run multiple times.
-- ============================================


-- ══════════════════════════════════════════════
-- 1. SERVICE REQUESTS TABLE
-- ══════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.service_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  request_id TEXT UNIQUE NOT NULL,
  lco_id UUID NOT NULL REFERENCES public.lco_applications(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,

  -- Details
  category TEXT NOT NULL,
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'MEDIUM',
  status TEXT NOT NULL DEFAULT 'OPEN',

  -- Temporary Phase 9 Technician Assignment Structure (No Auth Required)
  assigned_technician_name TEXT,
  assigned_technician_phone TEXT,
  technician_notes TEXT,

  -- Notes & Resolution
  resolution_notes TEXT,
  admin_notes TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ
);

-- Constraints added safely
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'service_requests_category_check'
  ) THEN
    ALTER TABLE public.service_requests
      ADD CONSTRAINT service_requests_category_check
      CHECK (category IN (
        'NO_SIGNAL', 'SLOW_INTERNET', 'NO_INTERNET',
        'BILLING_ISSUE', 'NEW_CONNECTION', 'HARDWARE_FAULT',
        'RELOCATION', 'OTHER'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'service_requests_priority_check'
  ) THEN
    ALTER TABLE public.service_requests
      ADD CONSTRAINT service_requests_priority_check
      CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'service_requests_status_check'
  ) THEN
    ALTER TABLE public.service_requests
      ADD CONSTRAINT service_requests_status_check
      CHECK (status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'CANCELLED'));
  END IF;
END $$;

ALTER TABLE public.service_requests ENABLE ROW LEVEL SECURITY;


-- ══════════════════════════════════════════════
-- 2. REQUEST ID GENERATOR FUNCTION
-- ══════════════════════════════════════════════
-- Format: REQ-2026-0001

CREATE OR REPLACE FUNCTION public.generate_request_id()
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
    CAST(SPLIT_PART(request_id, '-', 3) AS INT)
  ), 0) + 1
  INTO next_seq
  FROM public.service_requests
  WHERE request_id LIKE 'REQ-' || current_year || '-%';

  new_id := 'REQ-' || current_year || '-' || LPAD(next_seq::TEXT, 4, '0');

  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_request_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_request_id() TO authenticated;


-- ══════════════════════════════════════════════
-- 3. TRIGGERS: BEFORE INSERT & BEFORE UPDATE
-- ══════════════════════════════════════════════

-- Auto-generate request_id and sanitize customer inserts
CREATE OR REPLACE FUNCTION public.trg_service_request_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Generate human-readable request_id if empty
  IF NEW.request_id IS NULL OR NEW.request_id = '' THEN
    NEW.request_id := public.generate_request_id();
  END IF;

  -- If inserted by customer, enforce security defaults & customer ownership
  IF auth.uid() IS NOT NULL AND public.get_customer_id() IS NOT NULL AND public.get_lco_id() IS NULL THEN
    NEW.customer_id := public.get_customer_id();
    NEW.lco_id := public.get_customer_lco_id();
    NEW.priority := 'MEDIUM'; -- Customers cannot choose priority
    NEW.status := 'OPEN'; -- Customers must start at OPEN
    NEW.assigned_technician_name := NULL;
    NEW.assigned_technician_phone := NULL;
    NEW.technician_notes := NULL;
    NEW.resolution_notes := NULL;
    NEW.admin_notes := NULL;
    NEW.resolved_at := NULL;
    NEW.closed_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_service_requests_before_insert ON public.service_requests;
CREATE TRIGGER trg_service_requests_before_insert
  BEFORE INSERT ON public.service_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_service_request_before_insert();


-- Guard customer self-update & manage timestamps
CREATE OR REPLACE FUNCTION public.trg_guard_service_request_customer_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();

  -- Auto update timestamps based on status transitions
  IF NEW.status = 'RESOLVED' AND OLD.status != 'RESOLVED' THEN
    NEW.resolved_at := COALESCE(NEW.resolved_at, now());
  END IF;

  IF NEW.status IN ('CLOSED', 'CANCELLED') AND OLD.status NOT IN ('CLOSED', 'CANCELLED') THEN
    NEW.closed_at := COALESCE(NEW.closed_at, now());
  END IF;

  -- Restrict Customer role updates
  IF auth.uid() IS NOT NULL AND public.get_customer_id() IS NOT NULL AND public.get_lco_id() IS NULL THEN
    -- Customer must own the request
    IF OLD.customer_id != public.get_customer_id() THEN
      RAISE EXCEPTION 'Access denied. You do not own this service request.';
    END IF;

    -- Enforce immutable columns for customer
    IF NEW.lco_id IS DISTINCT FROM OLD.lco_id
      OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
      OR NEW.request_id IS DISTINCT FROM OLD.request_id
      OR NEW.category IS DISTINCT FROM OLD.category
      OR NEW.subject IS DISTINCT FROM OLD.subject
      OR NEW.description IS DISTINCT FROM OLD.description
      OR NEW.priority IS DISTINCT FROM OLD.priority
      OR NEW.assigned_technician_name IS DISTINCT FROM OLD.assigned_technician_name
      OR NEW.assigned_technician_phone IS DISTINCT FROM OLD.assigned_technician_phone
      OR NEW.technician_notes IS DISTINCT FROM OLD.technician_notes
      OR NEW.resolution_notes IS DISTINCT FROM OLD.resolution_notes
      OR NEW.admin_notes IS DISTINCT FROM OLD.admin_notes
      OR NEW.resolved_at IS DISTINCT FROM OLD.resolved_at
      OR NEW.closed_at IS DISTINCT FROM OLD.closed_at
    THEN
      RAISE EXCEPTION 'Customers cannot modify administrative or assignment fields.';
    END IF;

    -- Status restriction: Customer can ONLY transition OPEN -> CANCELLED
    IF OLD.status != 'OPEN' OR NEW.status != 'CANCELLED' THEN
      RAISE EXCEPTION 'Customers can only cancel open service requests.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_service_requests_guard_update ON public.service_requests;
CREATE TRIGGER trg_service_requests_guard_update
  BEFORE UPDATE ON public.service_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_guard_service_request_customer_update();


-- ══════════════════════════════════════════════
-- 4. TRUSTED AUTOMATED NOTIFICATION TRIGGERS
-- ══════════════════════════════════════════════
-- Runs with SECURITY DEFINER privileges to create system
-- notifications without granting arbitrary insert permissions to clients.

-- Request Created Notification Trigger
CREATE OR REPLACE FUNCTION public.trg_notify_service_request_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cust_name TEXT;
BEGIN
  -- Fetch customer name for the LCO notification message
  SELECT full_name INTO v_cust_name
  FROM public.customers
  WHERE id = NEW.customer_id;

  -- 1. Notify LCO Admin
  INSERT INTO public.notifications (lco_id, customer_id, title, message, type)
  VALUES (
    NEW.lco_id,
    NULL, -- Broadcast to LCO dashboard
    'New Service Request: ' || NEW.request_id,
    'Customer ' || COALESCE(v_cust_name, 'User') || ' submitted a new ' || NEW.category || ' request: "' || NEW.subject || '".',
    'INFO'
  );

  -- 2. Confirmation to Customer
  INSERT INTO public.notifications (lco_id, customer_id, title, message, type)
  VALUES (
    NEW.lco_id,
    NEW.customer_id,
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


-- Request Status / Resolution Update Notification Trigger
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

    INSERT INTO public.notifications (lco_id, customer_id, title, message, type)
    VALUES (
      NEW.lco_id,
      NULL,
      'Service Request Cancelled: ' || NEW.request_id,
      'Customer ' || COALESCE(v_cust_name, 'User') || ' cancelled service request ' || NEW.request_id || '.',
      'WARNING'
    );
  END IF;

  -- Case B: Status or Resolution Note updated by LCO -> Notify Customer
  IF (NEW.status IS DISTINCT FROM OLD.status AND NEW.status != 'CANCELLED')
     OR (NEW.resolution_notes IS DISTINCT FROM OLD.resolution_notes AND NEW.resolution_notes IS NOT NULL)
  THEN
    IF NEW.status = 'RESOLVED' THEN
      INSERT INTO public.notifications (lco_id, customer_id, title, message, type)
      VALUES (
        NEW.lco_id,
        NEW.customer_id,
        'Service Request Resolved: ' || NEW.request_id,
        'Your request ' || NEW.request_id || ' has been RESOLVED. ' || COALESCE('Resolution: ' || NEW.resolution_notes, ''),
        'SUCCESS'
      );
    ELSE
      INSERT INTO public.notifications (lco_id, customer_id, title, message, type)
      VALUES (
        NEW.lco_id,
        NEW.customer_id,
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
-- 5. RLS POLICIES FOR TENANT ISOLATION
-- ══════════════════════════════════════════════

-- ── Customer Policies ──

DROP POLICY IF EXISTS "Customer can view own service requests" ON public.service_requests;
CREATE POLICY "Customer can view own service requests"
  ON public.service_requests
  FOR SELECT
  TO authenticated
  USING (customer_id = public.get_customer_id());

DROP POLICY IF EXISTS "Customer can create service requests" ON public.service_requests;
CREATE POLICY "Customer can create service requests"
  ON public.service_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    customer_id = public.get_customer_id()
    AND lco_id = public.get_customer_lco_id()
  );

DROP POLICY IF EXISTS "Customer can cancel own open service requests" ON public.service_requests;
CREATE POLICY "Customer can cancel own open service requests"
  ON public.service_requests
  FOR UPDATE
  TO authenticated
  USING (customer_id = public.get_customer_id())
  WITH CHECK (customer_id = public.get_customer_id());


-- ── LCO Admin Policies ──

DROP POLICY IF EXISTS "LCO can view own service requests" ON public.service_requests;
CREATE POLICY "LCO can view own service requests"
  ON public.service_requests
  FOR SELECT
  TO authenticated
  USING (lco_id = public.get_lco_id());

DROP POLICY IF EXISTS "LCO can insert own service requests" ON public.service_requests;
CREATE POLICY "LCO can insert own service requests"
  ON public.service_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (lco_id = public.get_lco_id());

DROP POLICY IF EXISTS "LCO can update own service requests" ON public.service_requests;
CREATE POLICY "LCO can update own service requests"
  ON public.service_requests
  FOR UPDATE
  TO authenticated
  USING (lco_id = public.get_lco_id())
  WITH CHECK (lco_id = public.get_lco_id());


-- ── Super Admin Policies ──

DROP POLICY IF EXISTS "Super admins can manage all service requests" ON public.service_requests;
CREATE POLICY "Super admins can manage all service requests"
  ON public.service_requests
  FOR ALL
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());


-- ══════════════════════════════════════════════
-- 6. INDEXES FOR MULTI-TENANT & FILTER PERFORMANCE
-- ══════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_service_requests_lco_id
  ON public.service_requests(lco_id);

CREATE INDEX IF NOT EXISTS idx_service_requests_customer_id
  ON public.service_requests(customer_id);

CREATE INDEX IF NOT EXISTS idx_service_requests_status
  ON public.service_requests(status);

CREATE INDEX IF NOT EXISTS idx_service_requests_priority
  ON public.service_requests(priority);

CREATE INDEX IF NOT EXISTS idx_service_requests_category
  ON public.service_requests(category);

CREATE INDEX IF NOT EXISTS idx_service_requests_created_at
  ON public.service_requests(created_at DESC);


-- ══════════════════════════════════════════════
-- DONE — Phase 9 Service Requests Schema Ready
-- ══════════════════════════════════════════════
