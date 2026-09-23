-- ============================================================================
-- PHASE 11 BATCH 3 — COMMUNICATION HISTORY MIGRATION
-- ============================================================================
-- Features:
--   1. Reuses existing source-of-truth tables (notifications, broadcasts,
--      urgent_notices, customers, technicians). Zero data duplication.
--   2. Role-specific SECURITY DEFINER RPC functions for LCO Admin, Customer,
--      and Technician communication history audit feeds.
--   3. Multi-tenant RLS & tenant boundary enforcement.
-- ============================================================================
-- SAFE, ADDITIVE & IDEMPOTENT: Safe to run multiple times.
-- ============================================================================

BEGIN;

-- ══════════════════════════════════════════════
-- 1. RPC: GET LCO COMMUNICATION HISTORY
-- ══════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_lco_communication_history(
  p_category TEXT DEFAULT 'ALL',
  p_search TEXT DEFAULT NULL
)
RETURNS TABLE (
  event_id UUID,
  category TEXT,
  title TEXT,
  summary TEXT,
  recipient_role TEXT,
  recipient_name TEXT,
  channel TEXT,
  status_label TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_lco_id UUID;
  v_search_pattern TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  v_lco_id := public.get_lco_id();
  IF v_lco_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized. Only active LCO Admins can view organization communication history.';
  END IF;

  IF p_search IS NOT NULL AND trim(p_search) <> '' THEN
    v_search_pattern := '%' || trim(p_search) || '%';
  ELSE
    v_search_pattern := NULL;
  END IF;

  RETURN QUERY
  WITH combined_events AS (
    -- 1. In-App Notifications Feed
    SELECT
      n.id AS event_id,
      n.category::TEXT AS category,
      n.title::TEXT AS title,
      n.message::TEXT AS summary,
      n.recipient_role::TEXT AS recipient_role,
      COALESCE(c.full_name, t.full_name, 'LCO Organization')::TEXT AS recipient_name,
      'In-App Feed'::TEXT AS channel,
      CASE WHEN n.is_read THEN 'Read' ELSE 'Unread' END::TEXT AS status_label,
      n.created_at AS created_at
    FROM public.notifications n
    LEFT JOIN public.customers c ON n.customer_id = c.id
    LEFT JOIN public.technicians t ON n.technician_id = t.id
    WHERE n.lco_id = v_lco_id

    UNION ALL

    -- 2. Broadcast Announcements
    SELECT
      b.id AS event_id,
      'ANNOUNCEMENT'::TEXT AS category,
      b.title::TEXT AS title,
      b.message::TEXT AS summary,
      'CUSTOMER'::TEXT AS recipient_role,
      (CASE WHEN b.audience = 'ALL_CUSTOMERS' THEN 'All Customers (' || b.recipient_count || ')' ELSE 'Selected Customers (' || b.recipient_count || ')' END)::TEXT AS recipient_name,
      'Broadcast Feed'::TEXT AS channel,
      CASE WHEN b.expires_at IS NOT NULL AND b.expires_at <= now() THEN 'Expired' ELSE 'Active' END::TEXT AS status_label,
      b.created_at AS created_at
    FROM public.broadcasts b
    WHERE b.lco_id = v_lco_id

    UNION ALL

    -- 3. Urgent Customer Notices
    SELECT
      un.id AS event_id,
      'ANNOUNCEMENT'::TEXT AS category,
      ('🚨 Urgent: ' || un.title)::TEXT AS title,
      un.message::TEXT AS summary,
      'CUSTOMER'::TEXT AS recipient_role,
      (CASE WHEN un.audience = 'ALL_CUSTOMERS' THEN 'All Customers' ELSE 'Selected Customers' END)::TEXT AS recipient_name,
      'Urgent Notice Banner'::TEXT AS channel,
      CASE 
        WHEN un.is_active = false THEN 'Inactive'
        WHEN un.expires_at IS NOT NULL AND un.expires_at <= now() THEN 'Expired'
        ELSE 'Active'
      END::TEXT AS status_label,
      un.created_at AS created_at
    FROM public.urgent_notices un
    WHERE un.lco_id = v_lco_id

    UNION ALL

    -- 4. Customer Account Activation Emails
    SELECT
      cust.id AS event_id,
      'ACCOUNT'::TEXT AS category,
      'Customer Account Invitation'::TEXT AS title,
      ('Activation invite for customer ID: ' || cust.customer_id)::TEXT AS summary,
      'CUSTOMER'::TEXT AS recipient_role,
      cust.full_name::TEXT AS recipient_name,
      'Email Invite (Sent/Attempted)'::TEXT AS channel,
      COALESCE(cust.invitation_status, 'PENDING')::TEXT AS status_label,
      COALESCE(cust.invitation_sent_at, cust.created_at) AS created_at
    FROM public.customers cust
    WHERE cust.lco_id = v_lco_id AND cust.invitation_status IS NOT NULL

    UNION ALL

    -- 5. Technician Account Invitation Emails
    SELECT
      tech.id AS event_id,
      'TECHNICIAN_ACTIVITY'::TEXT AS category,
      'Technician Account Invitation'::TEXT AS title,
      ('Activation invite for technician: ' || tech.full_name)::TEXT AS summary,
      'TECHNICIAN'::TEXT AS recipient_role,
      tech.full_name::TEXT AS recipient_name,
      'Email Invite (Sent/Attempted)'::TEXT AS channel,
      COALESCE(tech.invitation_status, 'PENDING')::TEXT AS status_label,
      COALESCE(tech.invitation_sent_at, tech.created_at) AS created_at
    FROM public.technicians tech
    WHERE tech.lco_id = v_lco_id AND tech.invitation_status IS NOT NULL
  )
  SELECT
    ce.event_id,
    ce.category,
    ce.title,
    ce.summary,
    ce.recipient_role,
    ce.recipient_name,
    ce.channel,
    ce.status_label,
    ce.created_at
  FROM combined_events ce
  WHERE (p_category = 'ALL' OR ce.category = p_category)
    AND (
      v_search_pattern IS NULL 
      OR ce.title ILIKE v_search_pattern 
      OR ce.summary ILIKE v_search_pattern
      OR ce.recipient_name ILIKE v_search_pattern
    )
  ORDER BY ce.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_lco_communication_history(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_lco_communication_history(TEXT, TEXT) TO authenticated;


-- ══════════════════════════════════════════════
-- 2. RPC: GET CUSTOMER COMMUNICATION HISTORY
-- ══════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_customer_communication_history(
  p_category TEXT DEFAULT 'ALL',
  p_search TEXT DEFAULT NULL
)
RETURNS TABLE (
  event_id UUID,
  category TEXT,
  title TEXT,
  summary TEXT,
  channel TEXT,
  status_label TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_cust_id UUID;
  v_lco_id UUID;
  v_search_pattern TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  v_cust_id := public.get_customer_id();
  v_lco_id := public.get_customer_lco_id();

  IF v_cust_id IS NULL OR v_lco_id IS NULL THEN
    RETURN;
  END IF;

  IF p_search IS NOT NULL AND trim(p_search) <> '' THEN
    v_search_pattern := '%' || trim(p_search) || '%';
  ELSE
    v_search_pattern := NULL;
  END IF;

  RETURN QUERY
  WITH combined_events AS (
    -- 1. Customer Notifications Feed
    SELECT
      n.id AS event_id,
      n.category::TEXT AS category,
      n.title::TEXT AS title,
      n.message::TEXT AS summary,
      'In-App Feed'::TEXT AS channel,
      CASE WHEN n.is_read THEN 'Read' ELSE 'Unread' END::TEXT AS status_label,
      n.created_at AS created_at
    FROM public.notifications n
    WHERE n.customer_id = v_cust_id

    UNION ALL

    -- 2. Urgent Notices Banner (active or dismissed for this customer)
    SELECT
      un.id AS event_id,
      'ANNOUNCEMENT'::TEXT AS category,
      ('🚨 Urgent Notice: ' || un.title)::TEXT AS title,
      un.message::TEXT AS summary,
      'Urgent Notice Banner'::TEXT AS channel,
      CASE
        WHEN EXISTS (SELECT 1 FROM public.urgent_notice_dismissals und WHERE und.notice_id = un.id AND und.customer_id = v_cust_id) THEN 'Dismissed'
        WHEN un.expires_at IS NOT NULL AND un.expires_at <= now() THEN 'Expired'
        ELSE 'Active'
      END::TEXT AS status_label,
      un.created_at AS created_at
    FROM public.urgent_notices un
    WHERE un.lco_id = v_lco_id
      AND (
        un.audience = 'ALL_CUSTOMERS'
        OR EXISTS (SELECT 1 FROM public.urgent_notice_recipients unr WHERE unr.notice_id = un.id AND unr.customer_id = v_cust_id)
      )

    UNION ALL

    -- 3. Customer Invitation/Account Status Event
    SELECT
      c.id AS event_id,
      'ACCOUNT'::TEXT AS category,
      'Account Activation Email'::TEXT AS title,
      ('Account setup invitation for Customer ID: ' || c.customer_id)::TEXT AS summary,
      'Email Invite (Sent/Attempted)'::TEXT AS channel,
      COALESCE(c.invitation_status, 'PENDING')::TEXT AS status_label,
      COALESCE(c.invitation_sent_at, c.created_at) AS created_at
    FROM public.customers c
    WHERE c.id = v_cust_id AND c.invitation_status IS NOT NULL
  )
  SELECT
    ce.event_id,
    ce.category,
    ce.title,
    ce.summary,
    ce.channel,
    ce.status_label,
    ce.created_at
  FROM combined_events ce
  WHERE (p_category = 'ALL' OR ce.category = p_category)
    AND (
      v_search_pattern IS NULL 
      OR ce.title ILIKE v_search_pattern 
      OR ce.summary ILIKE v_search_pattern
    )
  ORDER BY ce.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_customer_communication_history(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_customer_communication_history(TEXT, TEXT) TO authenticated;


-- ══════════════════════════════════════════════
-- 3. RPC: GET TECHNICIAN COMMUNICATION HISTORY
-- ══════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_technician_communication_history(
  p_category TEXT DEFAULT 'ALL',
  p_search TEXT DEFAULT NULL
)
RETURNS TABLE (
  event_id UUID,
  category TEXT,
  title TEXT,
  summary TEXT,
  channel TEXT,
  status_label TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_tech_id UUID;
  v_lco_id UUID;
  v_search_pattern TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  v_tech_id := public.get_technician_id();
  v_lco_id := public.get_technician_lco_id();

  IF v_tech_id IS NULL OR v_lco_id IS NULL THEN
    RETURN;
  END IF;

  IF p_search IS NOT NULL AND trim(p_search) <> '' THEN
    v_search_pattern := '%' || trim(p_search) || '%';
  ELSE
    v_search_pattern := NULL;
  END IF;

  RETURN QUERY
  WITH combined_events AS (
    -- 1. Technician In-App Notifications (Field ticket assignments, job updates)
    SELECT
      n.id AS event_id,
      n.category::TEXT AS category,
      n.title::TEXT AS title,
      n.message::TEXT AS summary,
      'In-App Feed'::TEXT AS channel,
      CASE WHEN n.is_read THEN 'Read' ELSE 'Unread' END::TEXT AS status_label,
      n.created_at AS created_at
    FROM public.notifications n
    WHERE n.technician_id = v_tech_id

    UNION ALL

    -- 2. Technician Invitation/Account Setup Event
    SELECT
      t.id AS event_id,
      'ACCOUNT'::TEXT AS category,
      'Technician Setup Email'::TEXT AS title,
      ('Account activation email for field technician: ' || t.full_name)::TEXT AS summary,
      'Email Invite (Sent/Attempted)'::TEXT AS channel,
      COALESCE(t.invitation_status, 'PENDING')::TEXT AS status_label,
      COALESCE(t.invitation_sent_at, t.created_at) AS created_at
    FROM public.technicians t
    WHERE t.id = v_tech_id AND t.invitation_status IS NOT NULL
  )
  SELECT
    ce.event_id,
    ce.category,
    ce.title,
    ce.summary,
    ce.channel,
    ce.status_label,
    ce.created_at
  FROM combined_events ce
  WHERE (p_category = 'ALL' OR ce.category = p_category)
    AND (
      v_search_pattern IS NULL 
      OR ce.title ILIKE v_search_pattern 
      OR ce.summary ILIKE v_search_pattern
    )
  ORDER BY ce.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_technician_communication_history(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_technician_communication_history(TEXT, TEXT) TO authenticated;

COMMIT;

-- ============================================================================
-- DONE — Phase 11 Batch 3 Database Migration Ready
-- ============================================================================
