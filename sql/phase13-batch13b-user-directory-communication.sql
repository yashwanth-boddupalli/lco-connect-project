-- ============================================
-- LCO CONNECT — Phase 13 Batch 13B Migration
-- Platform User Directory & Communication Oversight RPCs
-- ============================================
-- Features:
--   1. RPC: public.get_super_admin_user_directory
--   2. RPC: public.get_super_admin_user_detail
--   3. RPC: public.get_super_admin_communication_oversight
-- ============================================
-- SAFE & IDEMPOTENT: Reuses existing database schema without adding tables or mutating RLS.
-- ============================================

BEGIN;

-- ══════════════════════════════════════════════
-- 1. RPC: PLATFORM USER DIRECTORY
-- ══════════════════════════════════════════════
-- Returns paginated, searchable user directory across all roles
-- with account status, LCO association, and entity metadata.

CREATE OR REPLACE FUNCTION public.get_super_admin_user_directory(
  p_search TEXT DEFAULT NULL,
  p_role TEXT DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_lco_id UUID DEFAULT NULL,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INT;
  v_offset INT;
  v_search TEXT;
  v_role TEXT;
  v_status TEXT;
  v_lco_id UUID := p_lco_id;
  v_total_records INT;
  v_data JSONB;
  v_result JSONB;
BEGIN
  -- Security check: Caller MUST be Super Admin
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: Caller is not a Super Admin';
  END IF;

  -- Clamp pagination
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_offset := GREATEST(COALESCE(p_offset, 0), 0);
  v_search := NULLIF(trim(p_search), '');
  v_role := NULLIF(trim(upper(p_role)), '');
  IF v_role = 'ALL' THEN v_role := NULL; END IF;
  v_status := NULLIF(trim(upper(p_status)), '');
  IF v_status = 'ALL' THEN v_status := NULL; END IF;

  WITH raw_users AS (
    SELECT
      p.id AS user_id,
      p.email AS email,
      p.role AS role,
      COALESCE(p.status, 'ACTIVE') AS status,
      COALESCE(a.owner_name, c.full_name, t.full_name) AS full_name,
      COALESCE(a.phone, c.phone, t.phone) AS phone,
      COALESCE(a.id, c.lco_id, t.lco_id) AS lco_id,
      COALESCE(a.business_name, lco_c.business_name, lco_t.business_name) AS lco_business_name,
      COALESCE(a.application_id, c.customer_id, t.technician_id) AS entity_id,
      p.created_at AS created_at
    FROM public.profiles p
    LEFT JOIN public.lco_applications a ON p.role = 'LCO_ADMIN' AND a.user_id = p.id
    LEFT JOIN public.customers c ON p.role = 'CUSTOMER' AND c.user_id = p.id
    LEFT JOIN public.lco_applications lco_c ON c.lco_id = lco_c.id
    LEFT JOIN public.technicians t ON p.role = 'TECHNICIAN' AND t.user_id = p.id
    LEFT JOIN public.lco_applications lco_t ON t.lco_id = lco_t.id
  )
  SELECT COUNT(*) INTO v_total_records
  FROM raw_users u
  WHERE (v_role IS NULL OR u.role = v_role)
    AND (v_status IS NULL OR u.status = v_status)
    AND (v_lco_id IS NULL OR u.lco_id = v_lco_id)
    AND (
      v_search IS NULL
      OR u.email ILIKE '%' || v_search || '%'
      OR u.full_name ILIKE '%' || v_search || '%'
      OR u.phone ILIKE '%' || v_search || '%'
      OR u.entity_id ILIKE '%' || v_search || '%'
      OR u.lco_business_name ILIKE '%' || v_search || '%'
    );

  WITH raw_users AS (
    SELECT
      p.id AS user_id,
      p.email AS email,
      p.role AS role,
      COALESCE(p.status, 'ACTIVE') AS status,
      COALESCE(a.owner_name, c.full_name, t.full_name) AS full_name,
      COALESCE(a.phone, c.phone, t.phone) AS phone,
      COALESCE(a.id, c.lco_id, t.lco_id) AS lco_id,
      COALESCE(a.business_name, lco_c.business_name, lco_t.business_name) AS lco_business_name,
      COALESCE(a.application_id, c.customer_id, t.technician_id) AS entity_id,
      p.created_at AS created_at
    FROM public.profiles p
    LEFT JOIN public.lco_applications a ON p.role = 'LCO_ADMIN' AND a.user_id = p.id
    LEFT JOIN public.customers c ON p.role = 'CUSTOMER' AND c.user_id = p.id
    LEFT JOIN public.lco_applications lco_c ON c.lco_id = lco_c.id
    LEFT JOIN public.technicians t ON p.role = 'TECHNICIAN' AND t.user_id = p.id
    LEFT JOIN public.lco_applications lco_t ON t.lco_id = lco_t.id
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'user_id', u.user_id,
      'email', u.email,
      'role', u.role,
      'status', u.status,
      'full_name', u.full_name,
      'phone', u.phone,
      'lco_id', u.lco_id,
      'lco_business_name', u.lco_business_name,
      'entity_id', u.entity_id,
      'created_at', u.created_at
    )
  ), '[]'::jsonb) INTO v_data
  FROM (
    SELECT *
    FROM raw_users u
    WHERE (v_role IS NULL OR u.role = v_role)
      AND (v_status IS NULL OR u.status = v_status)
      AND (v_lco_id IS NULL OR u.lco_id = v_lco_id)
      AND (
        v_search IS NULL
        OR u.email ILIKE '%' || v_search || '%'
        OR u.full_name ILIKE '%' || v_search || '%'
        OR u.phone ILIKE '%' || v_search || '%'
        OR u.entity_id ILIKE '%' || v_search || '%'
        OR u.lco_business_name ILIKE '%' || v_search || '%'
      )
    ORDER BY u.created_at DESC
    LIMIT v_limit OFFSET v_offset
  ) u;

  v_result := jsonb_build_object(
    'data', v_data,
    'pagination', jsonb_build_object(
      'total_records', v_total_records,
      'limit', v_limit,
      'offset', v_offset,
      'has_more', (v_offset + v_limit) < v_total_records
    )
  );

  RETURN v_result;
END;
$$;


-- ══════════════════════════════════════════════
-- 2. RPC: PLATFORM USER DETAIL INSPECTOR
-- ══════════════════════════════════════════════
-- Returns detailed contextual view for any user ID (SUPER_ADMIN, LCO_ADMIN, CUSTOMER, TECHNICIAN).

CREATE OR REPLACE FUNCTION public.get_super_admin_user_detail(
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_app public.lco_applications%ROWTYPE;
  v_cust public.customers%ROWTYPE;
  v_tech public.technicians%ROWTYPE;
  v_lco_assoc JSONB := NULL;
  v_role_entity JSONB := NULL;
  v_comm_summary JSONB := NULL;
  v_notification_count INT := 0;
  v_last_notif_at TIMESTAMPTZ := NULL;
  v_result JSONB;
BEGIN
  -- Security check: Caller MUST be Super Admin
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: Caller is not a Super Admin';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'User ID parameter is required';
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found for ID: %', p_user_id;
  END IF;

  -- Build role-specific details & LCO context
  IF v_profile.role = 'LCO_ADMIN' THEN
    SELECT * INTO v_app FROM public.lco_applications WHERE user_id = p_user_id LIMIT 1;
    IF FOUND THEN
      v_lco_assoc := jsonb_build_object(
        'lco_id', v_app.id,
        'business_name', v_app.business_name,
        'application_id', v_app.application_id,
        'city', v_app.city,
        'state', v_app.state
      );
      v_role_entity := jsonb_build_object(
        'application_id', v_app.application_id,
        'business_name', v_app.business_name,
        'owner_name', v_app.owner_name,
        'email', v_app.email,
        'phone', v_app.phone,
        'address', v_app.address,
        'city', v_app.city,
        'state', v_app.state,
        'pincode', v_app.pincode,
        'application_status', v_app.status,
        'reviewed_at', v_app.reviewed_at,
        'created_at', v_app.created_at
      );

      SELECT COUNT(*), MAX(created_at) INTO v_notification_count, v_last_notif_at
      FROM public.notifications
      WHERE lco_id = v_app.id AND recipient_role = 'LCO_ADMIN';
    END IF;

  ELSIF v_profile.role = 'CUSTOMER' THEN
    SELECT * INTO v_cust FROM public.customers WHERE user_id = p_user_id LIMIT 1;
    IF FOUND THEN
      SELECT * INTO v_app FROM public.lco_applications WHERE id = v_cust.lco_id;
      IF FOUND THEN
        v_lco_assoc := jsonb_build_object(
          'lco_id', v_app.id,
          'business_name', v_app.business_name,
          'application_id', v_app.application_id
        );
      END IF;

      v_role_entity := jsonb_build_object(
        'customer_id', v_cust.customer_id,
        'full_name', v_cust.full_name,
        'email', v_cust.email,
        'phone', v_cust.phone,
        'address', v_cust.address,
        'city', v_cust.city,
        'state', v_cust.state,
        'pincode', v_cust.pincode,
        'service_status', v_cust.service_status,
        'service_type', v_cust.service_type,
        'plan_name', v_cust.plan_name,
        'connection_date', v_cust.connection_date,
        'created_at', v_cust.created_at
      );

      SELECT COUNT(*), MAX(created_at) INTO v_notification_count, v_last_notif_at
      FROM public.notifications
      WHERE customer_id = v_cust.id;
    END IF;

  ELSIF v_profile.role = 'TECHNICIAN' THEN
    SELECT * INTO v_tech FROM public.technicians WHERE user_id = p_user_id LIMIT 1;
    IF FOUND THEN
      SELECT * INTO v_app FROM public.lco_applications WHERE id = v_tech.lco_id;
      IF FOUND THEN
        v_lco_assoc := jsonb_build_object(
          'lco_id', v_app.id,
          'business_name', v_app.business_name,
          'application_id', v_app.application_id
        );
      END IF;

      v_role_entity := jsonb_build_object(
        'technician_id', v_tech.technician_id,
        'full_name', v_tech.full_name,
        'email', v_tech.email,
        'phone', v_tech.phone,
        'status', v_tech.status,
        'invitation_status', v_tech.invitation_status,
        'invitation_sent_at', v_tech.invitation_sent_at,
        'created_at', v_tech.created_at
      );

      SELECT COUNT(*), MAX(created_at) INTO v_notification_count, v_last_notif_at
      FROM public.notifications
      WHERE technician_id = v_tech.id;
    END IF;

  END IF;

  v_comm_summary := jsonb_build_object(
    'total_notifications', COALESCE(v_notification_count, 0),
    'last_notification_at', v_last_notif_at
  );

  v_result := jsonb_build_object(
    'profile', jsonb_build_object(
      'id', v_profile.id,
      'email', v_profile.email,
      'role', v_profile.role,
      'status', COALESCE(v_profile.status, 'ACTIVE'),
      'created_at', v_profile.created_at,
      'updated_at', v_profile.updated_at
    ),
    'lco_association', v_lco_assoc,
    'role_specific_entity', v_role_entity,
    'communication_summary', v_comm_summary
  );

  RETURN v_result;
END;
$$;


-- ══════════════════════════════════════════════
-- 3. RPC: PLATFORM COMMUNICATION OVERSIGHT
-- ══════════════════════════════════════════════
-- Global communication feed for Super Admin to audit notifications, broadcasts,
-- and urgent notices across all LCOs.

CREATE OR REPLACE FUNCTION public.get_super_admin_communication_oversight(
  p_search TEXT DEFAULT NULL,
  p_lco_id UUID DEFAULT NULL,
  p_category TEXT DEFAULT 'ALL',
  p_recipient_role TEXT DEFAULT 'ALL',
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INT;
  v_offset INT;
  v_search TEXT;
  v_category TEXT;
  v_recipient_role TEXT;
  v_lco_id UUID := p_lco_id;
  v_total_records INT;
  v_data JSONB;
  v_result JSONB;
BEGIN
  -- Security check: Caller MUST be Super Admin
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: Caller is not a Super Admin';
  END IF;

  -- Clamp pagination
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_offset := GREATEST(COALESCE(p_offset, 0), 0);
  v_search := NULLIF(trim(p_search), '');
  v_category := NULLIF(trim(upper(p_category)), '');
  IF v_category = 'ALL' THEN v_category := NULL; END IF;
  v_recipient_role := NULLIF(trim(upper(p_recipient_role)), '');
  IF v_recipient_role = 'ALL' THEN v_recipient_role := NULL; END IF;

  WITH combined_events AS (
    -- 1. In-App Notifications Feed
    SELECT
      n.id AS event_id,
      n.lco_id AS lco_id,
      lco.business_name::TEXT AS lco_business_name,
      n.category::TEXT AS category,
      n.title::TEXT AS title,
      n.message::TEXT AS summary,
      n.recipient_role::TEXT AS recipient_role,
      COALESCE(c.full_name, t.full_name, 'LCO Organization')::TEXT AS recipient_name,
      'In-App Feed'::TEXT AS channel,
      CASE WHEN n.is_read THEN 'Read' ELSE 'Unread' END::TEXT AS status_label,
      n.created_at AS created_at
    FROM public.notifications n
    LEFT JOIN public.lco_applications lco ON n.lco_id = lco.id
    LEFT JOIN public.customers c ON n.customer_id = c.id
    LEFT JOIN public.technicians t ON n.technician_id = t.id

    UNION ALL

    -- 2. Broadcast Announcements
    SELECT
      b.id AS event_id,
      b.lco_id AS lco_id,
      lco.business_name::TEXT AS lco_business_name,
      'ANNOUNCEMENT'::TEXT AS category,
      b.title::TEXT AS title,
      b.message::TEXT AS summary,
      'CUSTOMER'::TEXT AS recipient_role,
      (CASE WHEN b.audience = 'ALL_CUSTOMERS' THEN 'All Customers (' || b.recipient_count || ')' ELSE 'Selected Customers (' || b.recipient_count || ')' END)::TEXT AS recipient_name,
      'Broadcast Feed'::TEXT AS channel,
      CASE WHEN b.expires_at IS NOT NULL AND b.expires_at <= now() THEN 'Expired' ELSE 'Active' END::TEXT AS status_label,
      b.created_at AS created_at
    FROM public.broadcasts b
    LEFT JOIN public.lco_applications lco ON b.lco_id = lco.id

    UNION ALL

    -- 3. Urgent Customer Notices
    SELECT
      un.id AS event_id,
      un.lco_id AS lco_id,
      lco.business_name::TEXT AS lco_business_name,
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
    LEFT JOIN public.lco_applications lco ON un.lco_id = lco.id
  )
  SELECT COUNT(*) INTO v_total_records
  FROM combined_events ce
  WHERE (v_lco_id IS NULL OR ce.lco_id = v_lco_id)
    AND (v_category IS NULL OR ce.category = v_category)
    AND (v_recipient_role IS NULL OR ce.recipient_role = v_recipient_role)
    AND (
      v_search IS NULL
      OR ce.title ILIKE '%' || v_search || '%'
      OR ce.summary ILIKE '%' || v_search || '%'
      OR ce.recipient_name ILIKE '%' || v_search || '%'
      OR ce.lco_business_name ILIKE '%' || v_search || '%'
    );

  WITH combined_events AS (
    -- 1. In-App Notifications Feed
    SELECT
      n.id AS event_id,
      n.lco_id AS lco_id,
      lco.business_name::TEXT AS lco_business_name,
      n.category::TEXT AS category,
      n.title::TEXT AS title,
      n.message::TEXT AS summary,
      n.recipient_role::TEXT AS recipient_role,
      COALESCE(c.full_name, t.full_name, 'LCO Organization')::TEXT AS recipient_name,
      'In-App Feed'::TEXT AS channel,
      CASE WHEN n.is_read THEN 'Read' ELSE 'Unread' END::TEXT AS status_label,
      n.created_at AS created_at
    FROM public.notifications n
    LEFT JOIN public.lco_applications lco ON n.lco_id = lco.id
    LEFT JOIN public.customers c ON n.customer_id = c.id
    LEFT JOIN public.technicians t ON n.technician_id = t.id

    UNION ALL

    -- 2. Broadcast Announcements
    SELECT
      b.id AS event_id,
      b.lco_id AS lco_id,
      lco.business_name::TEXT AS lco_business_name,
      'ANNOUNCEMENT'::TEXT AS category,
      b.title::TEXT AS title,
      b.message::TEXT AS summary,
      'CUSTOMER'::TEXT AS recipient_role,
      (CASE WHEN b.audience = 'ALL_CUSTOMERS' THEN 'All Customers (' || b.recipient_count || ')' ELSE 'Selected Customers (' || b.recipient_count || ')' END)::TEXT AS recipient_name,
      'Broadcast Feed'::TEXT AS channel,
      CASE WHEN b.expires_at IS NOT NULL AND b.expires_at <= now() THEN 'Expired' ELSE 'Active' END::TEXT AS status_label,
      b.created_at AS created_at
    FROM public.broadcasts b
    LEFT JOIN public.lco_applications lco ON b.lco_id = lco.id

    UNION ALL

    -- 3. Urgent Customer Notices
    SELECT
      un.id AS event_id,
      un.lco_id AS lco_id,
      lco.business_name::TEXT AS lco_business_name,
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
    LEFT JOIN public.lco_applications lco ON un.lco_id = lco.id
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'event_id', ce.event_id,
      'lco_id', ce.lco_id,
      'lco_business_name', ce.lco_business_name,
      'category', ce.category,
      'title', ce.title,
      'summary', ce.summary,
      'recipient_role', ce.recipient_role,
      'recipient_name', ce.recipient_name,
      'channel', ce.channel,
      'status_label', ce.status_label,
      'created_at', ce.created_at
    )
  ), '[]'::jsonb) INTO v_data
  FROM (
    SELECT *
    FROM combined_events ce
    WHERE (v_lco_id IS NULL OR ce.lco_id = v_lco_id)
      AND (v_category IS NULL OR ce.category = v_category)
      AND (v_recipient_role IS NULL OR ce.recipient_role = v_recipient_role)
      AND (
        v_search IS NULL
        OR ce.title ILIKE '%' || v_search || '%'
        OR ce.summary ILIKE '%' || v_search || '%'
        OR ce.recipient_name ILIKE '%' || v_search || '%'
        OR ce.lco_business_name ILIKE '%' || v_search || '%'
      )
    ORDER BY ce.created_at DESC
    LIMIT v_limit OFFSET v_offset
  ) ce;

  v_result := jsonb_build_object(
    'data', v_data,
    'pagination', jsonb_build_object(
      'total_records', v_total_records,
      'limit', v_limit,
      'offset', v_offset,
      'has_more', (v_offset + v_limit) < v_total_records
    )
  );

  RETURN v_result;
END;
$$;


-- ══════════════════════════════════════════════
-- 4. EXECUTION PERMISSIONS
-- ══════════════════════════════════════════════

REVOKE ALL ON FUNCTION public.get_super_admin_user_directory(TEXT, TEXT, TEXT, UUID, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_super_admin_user_directory(TEXT, TEXT, TEXT, UUID, INT, INT) TO authenticated;

REVOKE ALL ON FUNCTION public.get_super_admin_user_detail(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_super_admin_user_detail(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.get_super_admin_communication_oversight(TEXT, UUID, TEXT, TEXT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_super_admin_communication_oversight(TEXT, UUID, TEXT, TEXT, INT, INT) TO authenticated;

COMMIT;

-- ══════════════════════════════════════════════
-- DONE — Phase 13 Batch 13B Migration Ready
-- ══════════════════════════════════════════════
