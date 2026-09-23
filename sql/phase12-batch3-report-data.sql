-- ============================================
-- LCO CONNECT — Phase 12 Batch 3A: Secure Report Data Layer
-- Run this in the Supabase SQL Editor AFTER
-- Phase 1 through Phase 12 Batch 1 SQL files.
-- ============================================
-- Features:
--   1. get_lco_customer_report(...)        — Detailed customer report with active subscription data
--   2. get_lco_billing_report(...)         — Detailed billing & invoice report with outstanding balance
--   3. get_lco_payment_report(...)         — Detailed payment collection report with method breakdown
--   4. get_lco_service_request_report(...) — Detailed service request & complaint management report
--   5. get_lco_technician_report(...)      — Detailed technician performance & workload report
-- ============================================
-- SECURITY MODEL:
--   • All 5 RPCs are SECURITY DEFINER with SET search_path = public
--   • Strict LCO_ADMIN tenant isolation via get_lco_id()
--   • Non-LCO callers (SUPER_ADMIN, CUSTOMER, TECHNICIAN, unauthenticated) are REJECTED
--   • No arbitrary p_lco_id parameter accepted
--   • PUBLIC access is REVOKED; EXECUTE granted ONLY to authenticated
--   • No passwords, auth credentials, gateway secrets, or internal tokens exposed
--   • Pure read-only functions — NO business data mutations or structural changes
-- ============================================
-- SAFE & IDEMPOTENT: CREATE OR REPLACE FUNCTION & CREATE INDEX IF NOT EXISTS.
-- Safe to run multiple times.
-- ============================================


-- ══════════════════════════════════════════════
-- 0. PERFORMANCE INDEXES FOR REPORT PAGINATION
-- ══════════════════════════════════════════════
-- Compound indexes for tenant-scoped date filtering and sorting

CREATE INDEX IF NOT EXISTS idx_customers_lco_created_at
  ON public.customers(lco_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_customer_bills_lco_created_at
  ON public.customer_bills(lco_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_customer_payments_lco_date
  ON public.customer_payments(lco_id, payment_date DESC);

CREATE INDEX IF NOT EXISTS idx_service_requests_lco_created_at
  ON public.service_requests(lco_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_technicians_lco_created_at
  ON public.technicians(lco_id, created_at DESC);


-- ══════════════════════════════════════════════
-- 1. CUSTOMER REPORT RPC
-- ══════════════════════════════════════════════
-- Returns detailed customer records with pagination and active subscription details.
-- Filters: date range (created_at), search (customer_id, full_name, phone, email),
--          service_status, service_type.

CREATE OR REPLACE FUNCTION public.get_lco_customer_report(
  p_date_from      TIMESTAMPTZ DEFAULT NULL,
  p_date_to        TIMESTAMPTZ DEFAULT NULL,
  p_search         TEXT        DEFAULT NULL,
  p_service_status TEXT        DEFAULT NULL,
  p_service_type   TEXT        DEFAULT NULL,
  p_limit          INT         DEFAULT 50,
  p_offset         INT         DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lco_id         UUID := public.get_lco_id();
  v_limit          INT;
  v_offset         INT;
  v_search_pattern TEXT;
  v_total_records  INT := 0;
  v_data           JSONB;
BEGIN
  -- Security check: Caller must be an authenticated LCO Admin
  IF v_lco_id IS NULL THEN
    RAISE EXCEPTION 'Access denied: Caller is not an authenticated LCO Admin.';
  END IF;

  -- Date range validation
  IF p_date_from IS NOT NULL AND p_date_to IS NOT NULL AND p_date_from > p_date_to THEN
    RAISE EXCEPTION 'p_date_from cannot be greater than p_date_to.';
  END IF;

  -- Clamp pagination parameters
  v_limit  := LEAST(GREATEST(1, COALESCE(p_limit, 50)), 500);
  v_offset := GREATEST(0, COALESCE(p_offset, 0));

  -- Format search pattern
  IF p_search IS NOT NULL AND TRIM(p_search) <> '' THEN
    v_search_pattern := '%' || TRIM(p_search) || '%';
  END IF;

  WITH filtered_customers AS (
    SELECT
      c.id,
      c.customer_id,
      c.full_name,
      c.phone,
      c.email,
      c.address,
      c.city,
      c.state,
      c.pincode,
      c.service_type,
      c.service_status,
      c.plan_name,
      c.connection_date,
      c.created_at,
      c.updated_at,
      (
        SELECT jsonb_build_object(
          'id', cs.id,
          'plan_id', cs.plan_id,
          'start_date', cs.start_date,
          'end_date', cs.end_date,
          'status', cs.status,
          'plan_details', jsonb_build_object(
            'name', sp.name,
            'price', sp.price,
            'speed_mbps', sp.speed_mbps
          )
        )
        FROM public.customer_subscriptions cs
        LEFT JOIN public.service_plans sp ON cs.plan_id = sp.id
        WHERE cs.customer_id = c.id
          AND cs.lco_id = v_lco_id
          AND cs.status = 'ACTIVE'
        ORDER BY cs.created_at DESC
        LIMIT 1
      ) AS active_subscription,
      COUNT(*) OVER() AS total_count
    FROM public.customers c
    WHERE c.lco_id = v_lco_id
      AND (p_date_from IS NULL OR c.created_at >= p_date_from)
      AND (p_date_to   IS NULL OR c.created_at <= p_date_to)
      AND (p_service_status IS NULL OR TRIM(p_service_status) = '' OR UPPER(c.service_status) = UPPER(TRIM(p_service_status)))
      AND (p_service_type   IS NULL OR TRIM(p_service_type) = ''   OR UPPER(c.service_type)   = UPPER(TRIM(p_service_type)))
      AND (
        v_search_pattern IS NULL OR (
          c.customer_id ILIKE v_search_pattern OR
          c.full_name   ILIKE v_search_pattern OR
          c.phone       ILIKE v_search_pattern OR
          c.email       ILIKE v_search_pattern
        )
      )
    ORDER BY c.created_at DESC
    LIMIT v_limit
    OFFSET v_offset
  )
  SELECT
    COALESCE(MAX(total_count), 0),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', fc.id,
          'customer_id', fc.customer_id,
          'full_name', fc.full_name,
          'phone', fc.phone,
          'email', fc.email,
          'address', fc.address,
          'city', fc.city,
          'state', fc.state,
          'pincode', fc.pincode,
          'service_type', fc.service_type,
          'service_status', fc.service_status,
          'plan_name', fc.plan_name,
          'connection_date', fc.connection_date,
          'created_at', fc.created_at,
          'updated_at', fc.updated_at,
          'active_subscription', fc.active_subscription
        )
      ),
      '[]'::jsonb
    )
  INTO v_total_records, v_data
  FROM filtered_customers fc;

  RETURN jsonb_build_object(
    'data', v_data,
    'pagination', jsonb_build_object(
      'total_records', v_total_records,
      'limit', v_limit,
      'offset', v_offset,
      'has_more', (v_offset + v_limit < v_total_records)
    )
  );
END;
$$;


-- ══════════════════════════════════════════════
-- 2. BILLING REPORT RPC
-- ══════════════════════════════════════════════
-- Returns detailed billing rows with derived outstanding balance.
-- Filters: date range (created_at), status (PENDING, PAID, OVERDUE, CANCELLED),
--          search (bill_number, customer_id, full_name, phone).

CREATE OR REPLACE FUNCTION public.get_lco_billing_report(
  p_date_from TIMESTAMPTZ DEFAULT NULL,
  p_date_to   TIMESTAMPTZ DEFAULT NULL,
  p_search    TEXT        DEFAULT NULL,
  p_status    TEXT        DEFAULT NULL,
  p_limit     INT         DEFAULT 50,
  p_offset    INT         DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lco_id         UUID := public.get_lco_id();
  v_limit          INT;
  v_offset         INT;
  v_search_pattern TEXT;
  v_total_records  INT := 0;
  v_data           JSONB;
BEGIN
  -- Security check: Caller must be an authenticated LCO Admin
  IF v_lco_id IS NULL THEN
    RAISE EXCEPTION 'Access denied: Caller is not an authenticated LCO Admin.';
  END IF;

  -- Date range validation
  IF p_date_from IS NOT NULL AND p_date_to IS NOT NULL AND p_date_from > p_date_to THEN
    RAISE EXCEPTION 'p_date_from cannot be greater than p_date_to.';
  END IF;

  -- Clamp pagination parameters
  v_limit  := LEAST(GREATEST(1, COALESCE(p_limit, 50)), 500);
  v_offset := GREATEST(0, COALESCE(p_offset, 0));

  -- Format search pattern
  IF p_search IS NOT NULL AND TRIM(p_search) <> '' THEN
    v_search_pattern := '%' || TRIM(p_search) || '%';
  END IF;

  WITH filtered_bills AS (
    SELECT
      b.id,
      b.bill_number,
      b.customer_id,
      c.customer_id AS customer_custom_id,
      c.full_name AS customer_name,
      c.phone AS customer_phone,
      b.plan_name,
      b.amount,
      b.paid_amount,
      (b.amount - b.paid_amount) AS outstanding_balance,
      b.billing_period_start,
      b.billing_period_end,
      b.due_date,
      b.status,
      b.notes,
      b.created_at,
      COUNT(*) OVER() AS total_count
    FROM public.customer_bills b
    JOIN public.customers c ON b.customer_id = c.id
    WHERE b.lco_id = v_lco_id
      AND (p_date_from IS NULL OR b.created_at >= p_date_from)
      AND (p_date_to   IS NULL OR b.created_at <= p_date_to)
      AND (p_status    IS NULL OR TRIM(p_status) = '' OR UPPER(b.status) = UPPER(TRIM(p_status)))
      AND (
        v_search_pattern IS NULL OR (
          b.bill_number  ILIKE v_search_pattern OR
          c.customer_id  ILIKE v_search_pattern OR
          c.full_name    ILIKE v_search_pattern OR
          c.phone        ILIKE v_search_pattern
        )
      )
    ORDER BY b.created_at DESC
    LIMIT v_limit
    OFFSET v_offset
  )
  SELECT
    COALESCE(MAX(total_count), 0),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', fb.id,
          'bill_number', fb.bill_number,
          'customer_id', fb.customer_id,
          'customer_custom_id', fb.customer_custom_id,
          'customer_name', fb.customer_name,
          'customer_phone', fb.customer_phone,
          'plan_name', fb.plan_name,
          'amount', fb.amount,
          'paid_amount', fb.paid_amount,
          'outstanding_balance', fb.outstanding_balance,
          'billing_period_start', fb.billing_period_start,
          'billing_period_end', fb.billing_period_end,
          'due_date', fb.due_date,
          'status', fb.status,
          'notes', fb.notes,
          'created_at', fb.created_at
        )
      ),
      '[]'::jsonb
    )
  INTO v_total_records, v_data
  FROM filtered_bills fb;

  RETURN jsonb_build_object(
    'data', v_data,
    'pagination', jsonb_build_object(
      'total_records', v_total_records,
      'limit', v_limit,
      'offset', v_offset,
      'has_more', (v_offset + v_limit < v_total_records)
    )
  );
END;
$$;


-- ══════════════════════════════════════════════
-- 3. PAYMENT REPORT RPC
-- ══════════════════════════════════════════════
-- Returns detailed payment transactions without exposing secrets.
-- Filters: date range (payment_date), payment_method (CASH, UPI, ONLINE, etc.),
--          search (payment_number, transaction_reference, bill_number, customer_id, full_name).

CREATE OR REPLACE FUNCTION public.get_lco_payment_report(
  p_date_from      TIMESTAMPTZ DEFAULT NULL,
  p_date_to        TIMESTAMPTZ DEFAULT NULL,
  p_search         TEXT        DEFAULT NULL,
  p_payment_method TEXT        DEFAULT NULL,
  p_limit          INT         DEFAULT 50,
  p_offset         INT         DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lco_id         UUID := public.get_lco_id();
  v_limit          INT;
  v_offset         INT;
  v_search_pattern TEXT;
  v_total_records  INT := 0;
  v_data           JSONB;
BEGIN
  -- Security check: Caller must be an authenticated LCO Admin
  IF v_lco_id IS NULL THEN
    RAISE EXCEPTION 'Access denied: Caller is not an authenticated LCO Admin.';
  END IF;

  -- Date range validation
  IF p_date_from IS NOT NULL AND p_date_to IS NOT NULL AND p_date_from > p_date_to THEN
    RAISE EXCEPTION 'p_date_from cannot be greater than p_date_to.';
  END IF;

  -- Clamp pagination parameters
  v_limit  := LEAST(GREATEST(1, COALESCE(p_limit, 50)), 500);
  v_offset := GREATEST(0, COALESCE(p_offset, 0));

  -- Format search pattern
  IF p_search IS NOT NULL AND TRIM(p_search) <> '' THEN
    v_search_pattern := '%' || TRIM(p_search) || '%';
  END IF;

  WITH filtered_payments AS (
    SELECT
      p.id,
      p.payment_number,
      p.customer_id,
      c.customer_id AS customer_custom_id,
      c.full_name AS customer_name,
      p.bill_id,
      b.bill_number,
      p.amount,
      p.payment_method,
      p.payment_date,
      p.transaction_reference,
      p.notes,
      p.created_at,
      COUNT(*) OVER() AS total_count
    FROM public.customer_payments p
    JOIN public.customers c ON p.customer_id = c.id
    LEFT JOIN public.customer_bills b ON p.bill_id = b.id
    WHERE p.lco_id = v_lco_id
      AND (p_date_from IS NULL OR p.payment_date >= p_date_from)
      AND (p_date_to   IS NULL OR p.payment_date <= p_date_to)
      AND (p_payment_method IS NULL OR TRIM(p_payment_method) = '' OR UPPER(p.payment_method) = UPPER(TRIM(p_payment_method)))
      AND (
        v_search_pattern IS NULL OR (
          p.payment_number        ILIKE v_search_pattern OR
          p.transaction_reference ILIKE v_search_pattern OR
          c.customer_id           ILIKE v_search_pattern OR
          c.full_name             ILIKE v_search_pattern OR
          b.bill_number           ILIKE v_search_pattern
        )
      )
    ORDER BY p.payment_date DESC
    LIMIT v_limit
    OFFSET v_offset
  )
  SELECT
    COALESCE(MAX(total_count), 0),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', fp.id,
          'payment_number', fp.payment_number,
          'customer_id', fp.customer_id,
          'customer_custom_id', fp.customer_custom_id,
          'customer_name', fp.customer_name,
          'bill_id', fp.bill_id,
          'bill_number', fp.bill_number,
          'amount', fp.amount,
          'payment_method', fp.payment_method,
          'payment_date', fp.payment_date,
          'transaction_reference', fp.transaction_reference,
          'notes', fp.notes,
          'created_at', fp.created_at
        )
      ),
      '[]'::jsonb
    )
  INTO v_total_records, v_data
  FROM filtered_payments fp;

  RETURN jsonb_build_object(
    'data', v_data,
    'pagination', jsonb_build_object(
      'total_records', v_total_records,
      'limit', v_limit,
      'offset', v_offset,
      'has_more', (v_offset + v_limit < v_total_records)
    )
  );
END;
$$;


-- ══════════════════════════════════════════════
-- 4. SERVICE REQUEST REPORT RPC
-- ══════════════════════════════════════════════
-- Returns detailed service requests and resolution details.
-- Filters: date range (created_at), status, category, priority, technician_id,
--          search (request_id, subject, customer_id, customer full_name).

CREATE OR REPLACE FUNCTION public.get_lco_service_request_report(
  p_date_from      TIMESTAMPTZ DEFAULT NULL,
  p_date_to        TIMESTAMPTZ DEFAULT NULL,
  p_search         TEXT        DEFAULT NULL,
  p_status         TEXT        DEFAULT NULL,
  p_category       TEXT        DEFAULT NULL,
  p_priority       TEXT        DEFAULT NULL,
  p_technician_id  UUID        DEFAULT NULL,
  p_limit          INT         DEFAULT 50,
  p_offset         INT         DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lco_id         UUID := public.get_lco_id();
  v_limit          INT;
  v_offset         INT;
  v_search_pattern TEXT;
  v_total_records  INT := 0;
  v_data           JSONB;
BEGIN
  -- Security check: Caller must be an authenticated LCO Admin
  IF v_lco_id IS NULL THEN
    RAISE EXCEPTION 'Access denied: Caller is not an authenticated LCO Admin.';
  END IF;

  -- Date range validation
  IF p_date_from IS NOT NULL AND p_date_to IS NOT NULL AND p_date_from > p_date_to THEN
    RAISE EXCEPTION 'p_date_from cannot be greater than p_date_to.';
  END IF;

  -- Clamp pagination parameters
  v_limit  := LEAST(GREATEST(1, COALESCE(p_limit, 50)), 500);
  v_offset := GREATEST(0, COALESCE(p_offset, 0));

  -- Format search pattern
  IF p_search IS NOT NULL AND TRIM(p_search) <> '' THEN
    v_search_pattern := '%' || TRIM(p_search) || '%';
  END IF;

  WITH filtered_requests AS (
    SELECT
      sr.id,
      sr.request_id,
      sr.customer_id,
      c.customer_id AS customer_custom_id,
      c.full_name AS customer_name,
      sr.category,
      sr.subject,
      sr.description,
      sr.priority,
      sr.status,
      sr.assigned_technician_id,
      COALESCE(t.full_name, sr.assigned_technician_name) AS assigned_technician_name,
      COALESCE(t.phone, sr.assigned_technician_phone) AS assigned_technician_phone,
      sr.resolution_notes,
      sr.admin_notes,
      sr.created_at,
      sr.resolved_at,
      sr.closed_at,
      COUNT(*) OVER() AS total_count
    FROM public.service_requests sr
    JOIN public.customers c ON sr.customer_id = c.id
    LEFT JOIN public.technicians t ON sr.assigned_technician_id = t.id
    WHERE sr.lco_id = v_lco_id
      AND (p_date_from IS NULL OR sr.created_at >= p_date_from)
      AND (p_date_to   IS NULL OR sr.created_at <= p_date_to)
      AND (p_status     IS NULL OR TRIM(p_status) = ''     OR UPPER(sr.status)   = UPPER(TRIM(p_status)))
      AND (p_category   IS NULL OR TRIM(p_category) = ''   OR UPPER(sr.category) = UPPER(TRIM(p_category)))
      AND (p_priority   IS NULL OR TRIM(p_priority) = ''   OR UPPER(sr.priority) = UPPER(TRIM(p_priority)))
      AND (p_technician_id IS NULL OR sr.assigned_technician_id = p_technician_id)
      AND (
        v_search_pattern IS NULL OR (
          sr.request_id ILIKE v_search_pattern OR
          sr.subject    ILIKE v_search_pattern OR
          c.customer_id ILIKE v_search_pattern OR
          c.full_name   ILIKE v_search_pattern
        )
      )
    ORDER BY sr.created_at DESC
    LIMIT v_limit
    OFFSET v_offset
  )
  SELECT
    COALESCE(MAX(total_count), 0),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', fr.id,
          'request_id', fr.request_id,
          'customer_id', fr.customer_id,
          'customer_custom_id', fr.customer_custom_id,
          'customer_name', fr.customer_name,
          'category', fr.category,
          'subject', fr.subject,
          'description', fr.description,
          'priority', fr.priority,
          'status', fr.status,
          'assigned_technician_id', fr.assigned_technician_id,
          'assigned_technician_name', fr.assigned_technician_name,
          'assigned_technician_phone', fr.assigned_technician_phone,
          'resolution_notes', fr.resolution_notes,
          'admin_notes', fr.admin_notes,
          'created_at', fr.created_at,
          'resolved_at', fr.resolved_at,
          'closed_at', fr.closed_at
        )
      ),
      '[]'::jsonb
    )
  INTO v_total_records, v_data
  FROM filtered_requests fr;

  RETURN jsonb_build_object(
    'data', v_data,
    'pagination', jsonb_build_object(
      'total_records', v_total_records,
      'limit', v_limit,
      'offset', v_offset,
      'has_more', (v_offset + v_limit < v_total_records)
    )
  );
END;
$$;


-- ══════════════════════════════════════════════
-- 5. TECHNICIAN REPORT RPC
-- ══════════════════════════════════════════════
-- Returns detailed technician profile records with current workload counters.
-- Filters: status (ACTIVE, INACTIVE, SUSPENDED), invitation_status,
--          search (technician_id, full_name, phone, email).

CREATE OR REPLACE FUNCTION public.get_lco_technician_report(
  p_search            TEXT DEFAULT NULL,
  p_status            TEXT DEFAULT NULL,
  p_invitation_status TEXT DEFAULT NULL,
  p_limit             INT  DEFAULT 50,
  p_offset            INT  DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lco_id         UUID := public.get_lco_id();
  v_limit          INT;
  v_offset         INT;
  v_search_pattern TEXT;
  v_total_records  INT := 0;
  v_data           JSONB;
BEGIN
  -- Security check: Caller must be an authenticated LCO Admin
  IF v_lco_id IS NULL THEN
    RAISE EXCEPTION 'Access denied: Caller is not an authenticated LCO Admin.';
  END IF;

  -- Clamp pagination parameters
  v_limit  := LEAST(GREATEST(1, COALESCE(p_limit, 50)), 500);
  v_offset := GREATEST(0, COALESCE(p_offset, 0));

  -- Format search pattern
  IF p_search IS NOT NULL AND TRIM(p_search) <> '' THEN
    v_search_pattern := '%' || TRIM(p_search) || '%';
  END IF;

  WITH filtered_techs AS (
    SELECT
      t.id,
      t.technician_id,
      t.full_name,
      t.phone,
      t.email,
      t.status,
      t.invitation_status,
      t.invitation_sent_at,
      t.created_at,
      (
        SELECT COUNT(*)
        FROM public.service_requests sr
        WHERE sr.assigned_technician_id = t.id
          AND sr.lco_id = v_lco_id
          AND sr.status = 'OPEN'
      )::INT AS assigned_request_count,
      (
        SELECT COUNT(*)
        FROM public.service_requests sr
        WHERE sr.assigned_technician_id = t.id
          AND sr.lco_id = v_lco_id
          AND sr.status = 'IN_PROGRESS'
      )::INT AS in_progress_request_count,
      (
        SELECT COUNT(*)
        FROM public.service_requests sr
        WHERE sr.assigned_technician_id = t.id
          AND sr.lco_id = v_lco_id
          AND sr.status = 'RESOLVED'
      )::INT AS resolved_request_count,
      COUNT(*) OVER() AS total_count
    FROM public.technicians t
    WHERE t.lco_id = v_lco_id
      AND (p_status            IS NULL OR TRIM(p_status) = ''            OR UPPER(t.status)            = UPPER(TRIM(p_status)))
      AND (p_invitation_status IS NULL OR TRIM(p_invitation_status) = '' OR UPPER(t.invitation_status) = UPPER(TRIM(p_invitation_status)))
      AND (
        v_search_pattern IS NULL OR (
          t.technician_id ILIKE v_search_pattern OR
          t.full_name     ILIKE v_search_pattern OR
          t.phone         ILIKE v_search_pattern OR
          t.email         ILIKE v_search_pattern
        )
      )
    ORDER BY t.created_at DESC
    LIMIT v_limit
    OFFSET v_offset
  )
  SELECT
    COALESCE(MAX(total_count), 0),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', ft.id,
          'technician_id', ft.technician_id,
          'full_name', ft.full_name,
          'phone', ft.phone,
          'email', ft.email,
          'status', ft.status,
          'invitation_status', ft.invitation_status,
          'invitation_sent_at', ft.invitation_sent_at,
          'created_at', ft.created_at,
          'assigned_request_count', ft.assigned_request_count,
          'in_progress_request_count', ft.in_progress_request_count,
          'resolved_request_count', ft.resolved_request_count
        )
      ),
      '[]'::jsonb
    )
  INTO v_total_records, v_data
  FROM filtered_techs ft;

  RETURN jsonb_build_object(
    'data', v_data,
    'pagination', jsonb_build_object(
      'total_records', v_total_records,
      'limit', v_limit,
      'offset', v_offset,
      'has_more', (v_offset + v_limit < v_total_records)
    )
  );
END;
$$;


-- ══════════════════════════════════════════════
-- 6. PERMISSIONS & ROLE SECURITY
-- ══════════════════════════════════════════════

REVOKE ALL ON FUNCTION public.get_lco_customer_report(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_lco_customer_report(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, INT, INT) TO authenticated;

REVOKE ALL ON FUNCTION public.get_lco_billing_report(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_lco_billing_report(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, INT, INT) TO authenticated;

REVOKE ALL ON FUNCTION public.get_lco_payment_report(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_lco_payment_report(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, INT, INT) TO authenticated;

REVOKE ALL ON FUNCTION public.get_lco_service_request_report(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, UUID, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_lco_service_request_report(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, UUID, INT, INT) TO authenticated;

REVOKE ALL ON FUNCTION public.get_lco_technician_report(TEXT, TEXT, TEXT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_lco_technician_report(TEXT, TEXT, TEXT, INT, INT) TO authenticated;


-- ══════════════════════════════════════════════
-- 7. VERIFICATION COMMENTS & SIGNATURE MATRIX
-- ══════════════════════════════════════════════
-- 1. SELECT public.get_lco_customer_report(NULL, NULL, NULL, NULL, NULL, 10, 0);
-- 2. SELECT public.get_lco_billing_report(NULL, NULL, NULL, NULL, 10, 0);
-- 3. SELECT public.get_lco_payment_report(NULL, NULL, NULL, NULL, 10, 0);
-- 4. SELECT public.get_lco_service_request_report(NULL, NULL, NULL, NULL, NULL, NULL, NULL, 10, 0);
-- 5. SELECT public.get_lco_technician_report(NULL, NULL, NULL, 10, 0);
