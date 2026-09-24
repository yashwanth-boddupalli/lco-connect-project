-- ============================================
-- LCO CONNECT — Phase 12 Batch 1: Analytics Foundation
-- Run this in the Supabase SQL Editor AFTER
-- all Phase 1 through Phase 11 SQL files.
-- ============================================
-- This file creates:
--   1. get_lco_analytics_overview(TIMESTAMPTZ, TIMESTAMPTZ) — Customer, Billing, SR, Technician summary
--   2. get_lco_payment_analytics(TIMESTAMPTZ, TIMESTAMPTZ)  — Payment totals, method breakdown, trends
--   3. get_lco_service_request_analytics(TIMESTAMPTZ, TIMESTAMPTZ) — Status/category/priority breakdown, trends
--   4. get_lco_technician_analytics()                       — Technician counts and per-technician workload
-- ============================================
-- SECURITY MODEL:
--   • All functions are SECURITY DEFINER with SET search_path = public
--   • Strict LCO_ADMIN tenant isolation via get_lco_id()
--   • Non-LCO callers (SUPER_ADMIN, CUSTOMER, TECHNICIAN, USER) are REJECTED
--   • Super Admin platform-wide analytics deferred to Phase 13
--   • No new tables created — all analytics computed from live production data
--   • No existing tables, columns, RLS policies, or functions are modified
-- ============================================
-- EXISTING TABLES CONSUMED (read-only):
--   • customers          — service_status, created_at, lco_id
--   • customer_bills     — amount, paid_amount, status, due_date, created_at, lco_id
--   • customer_payments  — amount, payment_method, payment_date, lco_id
--   • service_requests   — status, category, priority, assigned_technician_id, created_at, lco_id
--   • technicians        — status, lco_id
-- ============================================
-- EXISTING HELPER FUNCTIONS REUSED:
--   • get_lco_id()       — returns lco_applications.id for current LCO_ADMIN
--   • is_super_admin()   — NOT called by these RPCs (Phase 13 scope)
-- ============================================
-- SAFE & IDEMPOTENT: CREATE OR REPLACE. Safe to run multiple times.
-- ============================================


-- ══════════════════════════════════════════════
-- 1. ANALYTICS OVERVIEW RPC
-- ══════════════════════════════════════════════
-- Returns a single JSONB object with:
--   • customers:  total, active, inactive, suspended, disconnected, new_in_range
--   • billing:    total_bills, total_billed_amount, total_paid_amount,
--                 total_pending_amount, total_overdue_amount, bills_by_status
--   • service_requests: total, by_status
--   • technicians: total, active
--
-- Date range (p_date_from / p_date_to) filters:
--   • customers.created_at     for new_in_range
--   • customer_bills.created_at for billing metrics
--   Passing NULL for either parameter means unbounded on that side.

CREATE OR REPLACE FUNCTION public.get_lco_analytics_overview(
  p_date_from TIMESTAMPTZ DEFAULT NULL,
  p_date_to   TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lco_id UUID := public.get_lco_id();
  v_result JSONB;

  -- Customer metrics
  v_cust_total       BIGINT;
  v_cust_active      BIGINT;
  v_cust_inactive    BIGINT;
  v_cust_suspended   BIGINT;
  v_cust_disconnected BIGINT;
  v_cust_new         BIGINT;

  -- Billing metrics
  v_bill_total       BIGINT;
  v_bill_amount      NUMERIC(14,2);
  v_bill_paid        NUMERIC(14,2);
  v_bill_pending_amt NUMERIC(14,2);
  v_bill_overdue_amt NUMERIC(14,2);
  v_bills_by_status  JSONB;

  -- Service request metrics (summary only)
  v_sr_total         BIGINT;
  v_sr_by_status     JSONB;

  -- Technician metrics (summary only)
  v_tech_total       BIGINT;
  v_tech_active      BIGINT;
BEGIN
  -- ── Authorization: LCO_ADMIN only ──
  IF v_lco_id IS NULL THEN
    RAISE EXCEPTION 'Access denied. Analytics are available only for authenticated LCO administrators.';
  END IF;

  -- ── Customer Metrics ──
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE service_status = 'ACTIVE'),
    COUNT(*) FILTER (WHERE service_status = 'INACTIVE'),
    COUNT(*) FILTER (WHERE service_status = 'SUSPENDED'),
    COUNT(*) FILTER (WHERE service_status = 'DISCONNECTED')
  INTO v_cust_total, v_cust_active, v_cust_inactive, v_cust_suspended, v_cust_disconnected
  FROM public.customers
  WHERE lco_id = v_lco_id;

  -- New customers within date range
  SELECT COUNT(*)
  INTO v_cust_new
  FROM public.customers
  WHERE lco_id = v_lco_id
    AND (p_date_from IS NULL OR created_at >= p_date_from)
    AND (p_date_to   IS NULL OR created_at <= p_date_to);

  -- ── Billing Metrics ──
  SELECT
    COUNT(*),
    COALESCE(SUM(amount), 0.00),
    COALESCE(SUM(paid_amount), 0.00),
    COALESCE(SUM(CASE WHEN status = 'PENDING' THEN (amount - paid_amount) ELSE 0 END), 0.00),
    COALESCE(SUM(CASE WHEN status = 'OVERDUE' THEN (amount - paid_amount) ELSE 0 END), 0.00)
  INTO v_bill_total, v_bill_amount, v_bill_paid, v_bill_pending_amt, v_bill_overdue_amt
  FROM public.customer_bills
  WHERE lco_id = v_lco_id
    AND (p_date_from IS NULL OR created_at >= p_date_from)
    AND (p_date_to   IS NULL OR created_at <= p_date_to);

  -- Bills grouped by status
  SELECT COALESCE(jsonb_object_agg(status, cnt), '{}'::jsonb)
  INTO v_bills_by_status
  FROM (
    SELECT status, COUNT(*) AS cnt
    FROM public.customer_bills
    WHERE lco_id = v_lco_id
      AND (p_date_from IS NULL OR created_at >= p_date_from)
      AND (p_date_to   IS NULL OR created_at <= p_date_to)
    GROUP BY status
  ) sub;

  -- ── Service Request Summary ──
  SELECT COUNT(*)
  INTO v_sr_total
  FROM public.service_requests
  WHERE lco_id = v_lco_id
    AND (p_date_from IS NULL OR created_at >= p_date_from)
    AND (p_date_to   IS NULL OR created_at <= p_date_to);

  SELECT COALESCE(jsonb_object_agg(status, cnt), '{}'::jsonb)
  INTO v_sr_by_status
  FROM (
    SELECT status, COUNT(*) AS cnt
    FROM public.service_requests
    WHERE lco_id = v_lco_id
      AND (p_date_from IS NULL OR created_at >= p_date_from)
      AND (p_date_to   IS NULL OR created_at <= p_date_to)
    GROUP BY status
  ) sub;

  -- ── Technician Summary ──
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'ACTIVE')
  INTO v_tech_total, v_tech_active
  FROM public.technicians
  WHERE lco_id = v_lco_id;

  -- ── Assemble Result ──
  v_result := jsonb_build_object(
    'customers', jsonb_build_object(
      'total',        COALESCE(v_cust_total, 0),
      'active',       COALESCE(v_cust_active, 0),
      'inactive',     COALESCE(v_cust_inactive, 0),
      'suspended',    COALESCE(v_cust_suspended, 0),
      'disconnected', COALESCE(v_cust_disconnected, 0),
      'new_in_range', COALESCE(v_cust_new, 0)
    ),
    'billing', jsonb_build_object(
      'total_bills',          COALESCE(v_bill_total, 0),
      'total_billed_amount',  COALESCE(v_bill_amount, 0.00),
      'total_paid_amount',    COALESCE(v_bill_paid, 0.00),
      'total_pending_amount', COALESCE(v_bill_pending_amt, 0.00),
      'total_overdue_amount', COALESCE(v_bill_overdue_amt, 0.00),
      'bills_by_status',      v_bills_by_status
    ),
    'service_requests', jsonb_build_object(
      'total',     COALESCE(v_sr_total, 0),
      'by_status', v_sr_by_status
    ),
    'technicians', jsonb_build_object(
      'total',  COALESCE(v_tech_total, 0),
      'active', COALESCE(v_tech_active, 0)
    )
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_lco_analytics_overview(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_lco_analytics_overview(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;


-- ══════════════════════════════════════════════
-- 2. PAYMENT ANALYTICS RPC
-- ══════════════════════════════════════════════
-- Returns JSONB with:
--   • total_payments, total_amount
--   • by_method: { "CASH": { "count": N, "amount": X }, ... }
--   • monthly_trend: [ { "month": "2026-01", "count": N, "amount": X }, ... ]
--
-- Date range filters on customer_payments.payment_date.

CREATE OR REPLACE FUNCTION public.get_lco_payment_analytics(
  p_date_from TIMESTAMPTZ DEFAULT NULL,
  p_date_to   TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lco_id        UUID := public.get_lco_id();
  v_total_count   BIGINT;
  v_total_amount  NUMERIC(14,2);
  v_by_method     JSONB;
  v_monthly_trend JSONB;
  v_result        JSONB;
BEGIN
  -- ── Authorization: LCO_ADMIN only ──
  IF v_lco_id IS NULL THEN
    RAISE EXCEPTION 'Access denied. Analytics are available only for authenticated LCO administrators.';
  END IF;

  -- ── Totals ──
  SELECT
    COUNT(*),
    COALESCE(SUM(amount), 0.00)
  INTO v_total_count, v_total_amount
  FROM public.customer_payments
  WHERE lco_id = v_lco_id
    AND (p_date_from IS NULL OR payment_date >= p_date_from)
    AND (p_date_to   IS NULL OR payment_date <= p_date_to);

  -- ── By Payment Method ──
  SELECT COALESCE(
    jsonb_object_agg(
      payment_method,
      jsonb_build_object('count', cnt, 'amount', amt)
    ),
    '{}'::jsonb
  )
  INTO v_by_method
  FROM (
    SELECT
      payment_method,
      COUNT(*)              AS cnt,
      COALESCE(SUM(amount), 0.00) AS amt
    FROM public.customer_payments
    WHERE lco_id = v_lco_id
      AND (p_date_from IS NULL OR payment_date >= p_date_from)
      AND (p_date_to   IS NULL OR payment_date <= p_date_to)
    GROUP BY payment_method
    ORDER BY payment_method
  ) sub;

  -- ── Monthly Trend ──
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'month', month_label,
        'count', cnt,
        'amount', amt
      ) ORDER BY month_label
    ),
    '[]'::jsonb
  )
  INTO v_monthly_trend
  FROM (
    SELECT
      to_char(payment_date, 'YYYY-MM') AS month_label,
      COUNT(*)                          AS cnt,
      COALESCE(SUM(amount), 0.00)       AS amt
    FROM public.customer_payments
    WHERE lco_id = v_lco_id
      AND (p_date_from IS NULL OR payment_date >= p_date_from)
      AND (p_date_to   IS NULL OR payment_date <= p_date_to)
    GROUP BY to_char(payment_date, 'YYYY-MM')
    ORDER BY month_label
  ) sub;

  -- ── Assemble Result ──
  v_result := jsonb_build_object(
    'total_payments', COALESCE(v_total_count, 0),
    'total_amount',   COALESCE(v_total_amount, 0.00),
    'by_method',      v_by_method,
    'monthly_trend',  v_monthly_trend
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_lco_payment_analytics(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_lco_payment_analytics(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;


-- ══════════════════════════════════════════════
-- 3. SERVICE REQUEST ANALYTICS RPC
-- ══════════════════════════════════════════════
-- Returns JSONB with:
--   • total
--   • by_status:   { "OPEN": N, "IN_PROGRESS": N, ... }
--   • by_category: { "NO_SIGNAL": N, "SLOW_INTERNET": N, ... }
--   • by_priority: { "LOW": N, "MEDIUM": N, "HIGH": N, "URGENT": N }
--   • monthly_trend: [ { "month": "2026-01", "count": N }, ... ]
--
-- Date range filters on service_requests.created_at.

CREATE OR REPLACE FUNCTION public.get_lco_service_request_analytics(
  p_date_from TIMESTAMPTZ DEFAULT NULL,
  p_date_to   TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lco_id        UUID := public.get_lco_id();
  v_total         BIGINT;
  v_by_status     JSONB;
  v_by_category   JSONB;
  v_by_priority   JSONB;
  v_monthly_trend JSONB;
  v_result        JSONB;
BEGIN
  -- ── Authorization: LCO_ADMIN only ──
  IF v_lco_id IS NULL THEN
    RAISE EXCEPTION 'Access denied. Analytics are available only for authenticated LCO administrators.';
  END IF;

  -- ── Total ──
  SELECT COUNT(*)
  INTO v_total
  FROM public.service_requests
  WHERE lco_id = v_lco_id
    AND (p_date_from IS NULL OR created_at >= p_date_from)
    AND (p_date_to   IS NULL OR created_at <= p_date_to);

  -- ── By Status ──
  SELECT COALESCE(jsonb_object_agg(status, cnt), '{}'::jsonb)
  INTO v_by_status
  FROM (
    SELECT status, COUNT(*) AS cnt
    FROM public.service_requests
    WHERE lco_id = v_lco_id
      AND (p_date_from IS NULL OR created_at >= p_date_from)
      AND (p_date_to   IS NULL OR created_at <= p_date_to)
    GROUP BY status
  ) sub;

  -- ── By Category ──
  SELECT COALESCE(jsonb_object_agg(category, cnt), '{}'::jsonb)
  INTO v_by_category
  FROM (
    SELECT category, COUNT(*) AS cnt
    FROM public.service_requests
    WHERE lco_id = v_lco_id
      AND (p_date_from IS NULL OR created_at >= p_date_from)
      AND (p_date_to   IS NULL OR created_at <= p_date_to)
    GROUP BY category
  ) sub;

  -- ── By Priority ──
  SELECT COALESCE(jsonb_object_agg(priority, cnt), '{}'::jsonb)
  INTO v_by_priority
  FROM (
    SELECT priority, COUNT(*) AS cnt
    FROM public.service_requests
    WHERE lco_id = v_lco_id
      AND (p_date_from IS NULL OR created_at >= p_date_from)
      AND (p_date_to   IS NULL OR created_at <= p_date_to)
    GROUP BY priority
  ) sub;

  -- ── Monthly Trend ──
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object('month', month_label, 'count', cnt)
      ORDER BY month_label
    ),
    '[]'::jsonb
  )
  INTO v_monthly_trend
  FROM (
    SELECT
      to_char(created_at, 'YYYY-MM') AS month_label,
      COUNT(*)                        AS cnt
    FROM public.service_requests
    WHERE lco_id = v_lco_id
      AND (p_date_from IS NULL OR created_at >= p_date_from)
      AND (p_date_to   IS NULL OR created_at <= p_date_to)
    GROUP BY to_char(created_at, 'YYYY-MM')
    ORDER BY month_label
  ) sub;

  -- ── Assemble Result ──
  v_result := jsonb_build_object(
    'total',         COALESCE(v_total, 0),
    'by_status',     v_by_status,
    'by_category',   v_by_category,
    'by_priority',   v_by_priority,
    'monthly_trend', v_monthly_trend
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_lco_service_request_analytics(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_lco_service_request_analytics(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;


-- ══════════════════════════════════════════════
-- 4. TECHNICIAN ANALYTICS RPC
-- ══════════════════════════════════════════════
-- Returns JSONB with:
--   • total, active, inactive, suspended
--   • workload: array of per-technician objects with assigned/resolved/open counts
--
-- No date range parameter — reflects current technician workload snapshot.
-- Workload counts come from service_requests.assigned_technician_id.

CREATE OR REPLACE FUNCTION public.get_lco_technician_analytics()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lco_id       UUID := public.get_lco_id();
  v_total        BIGINT;
  v_active       BIGINT;
  v_inactive     BIGINT;
  v_suspended    BIGINT;
  v_workload     JSONB;
  v_result       JSONB;
BEGIN
  -- ── Authorization: LCO_ADMIN only ──
  IF v_lco_id IS NULL THEN
    RAISE EXCEPTION 'Access denied. Analytics are available only for authenticated LCO administrators.';
  END IF;

  -- ── Technician Counts ──
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'ACTIVE'),
    COUNT(*) FILTER (WHERE status = 'INACTIVE'),
    COUNT(*) FILTER (WHERE status = 'SUSPENDED')
  INTO v_total, v_active, v_inactive, v_suspended
  FROM public.technicians
  WHERE lco_id = v_lco_id;

  -- ── Per-Technician Workload ──
  -- Left-join technicians with service_requests to count assignments.
  -- Only includes technicians belonging to this LCO.
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'technician_id',  t.technician_id,
        'full_name',      t.full_name,
        'status',         t.status,
        'assigned_count', COALESCE(sr.assigned_count, 0),
        'resolved_count', COALESCE(sr.resolved_count, 0),
        'open_count',     COALESCE(sr.open_count, 0),
        'in_progress_count', COALESCE(sr.in_progress_count, 0)
      )
      ORDER BY t.full_name
    ),
    '[]'::jsonb
  )
  INTO v_workload
  FROM public.technicians t
  LEFT JOIN (
    SELECT
      assigned_technician_id,
      COUNT(*)                                              AS assigned_count,
      COUNT(*) FILTER (WHERE status = 'RESOLVED')           AS resolved_count,
      COUNT(*) FILTER (WHERE status = 'OPEN')               AS open_count,
      COUNT(*) FILTER (WHERE status = 'IN_PROGRESS')        AS in_progress_count
    FROM public.service_requests
    WHERE lco_id = v_lco_id
      AND assigned_technician_id IS NOT NULL
    GROUP BY assigned_technician_id
  ) sr ON sr.assigned_technician_id = t.id
  WHERE t.lco_id = v_lco_id;

  -- ── Assemble Result ──
  v_result := jsonb_build_object(
    'total',     COALESCE(v_total, 0),
    'active',    COALESCE(v_active, 0),
    'inactive',  COALESCE(v_inactive, 0),
    'suspended', COALESCE(v_suspended, 0),
    'workload',  v_workload
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_lco_technician_analytics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_lco_technician_analytics() TO authenticated;


-- ══════════════════════════════════════════════
-- DONE — Phase 12 Batch 1: Analytics Foundation Ready
-- ══════════════════════════════════════════════
-- Created 4 analytics RPCs:
--   1. get_lco_analytics_overview(TIMESTAMPTZ, TIMESTAMPTZ)
--   2. get_lco_payment_analytics(TIMESTAMPTZ, TIMESTAMPTZ)
--   3. get_lco_service_request_analytics(TIMESTAMPTZ, TIMESTAMPTZ)
--   4. get_lco_technician_analytics()
--
-- All functions:
--   ✓ SECURITY DEFINER with SET search_path = public
--   ✓ Strict LCO_ADMIN tenant isolation via get_lco_id()
--   ✓ Non-LCO callers rejected with clear error message
--   ✓ Return structured JSONB for frontend consumption
--   ✓ Safe empty-dataset handling (COALESCE to 0 / 0.00 / {} / [])
--   ✓ No division-by-zero risk (no percentage calculations)
--   ✓ No new tables, no schema modifications
--   ✓ No existing functions or policies modified
-- ══════════════════════════════════════════════
