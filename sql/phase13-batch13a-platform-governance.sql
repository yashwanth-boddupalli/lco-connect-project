-- ============================================
-- LCO CONNECT — Phase 13 Batch 13A Migration
-- Global Platform Overview + LCO Governance RPCs
-- ============================================

-- ══════════════════════════════════════════════
-- 1. RPC: PLATFORM OVERVIEW METRICS
-- ══════════════════════════════════════════════
-- Computes global platform-wide statistics for Super Admin.
-- Aggregates metrics independently without row multiplication.

CREATE OR REPLACE FUNCTION public.get_super_admin_platform_overview()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  -- Security check: Caller MUST be Super Admin
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: Caller is not a Super Admin';
  END IF;

  SELECT jsonb_build_object(
    'total_lco_applications', (SELECT COALESCE(COUNT(*), 0) FROM public.lco_applications),
    'total_approved_lcos', (SELECT COALESCE(COUNT(*), 0) FROM public.lco_applications WHERE status = 'APPROVED'),
    'active_lcos', (
      SELECT COALESCE(COUNT(*), 0)
      FROM public.lco_applications a
      JOIN public.profiles p ON a.user_id = p.id
      WHERE a.status = 'APPROVED' AND p.status = 'ACTIVE'
    ),
    'suspended_lcos', (
      SELECT COALESCE(COUNT(*), 0)
      FROM public.lco_applications a
      JOIN public.profiles p ON a.user_id = p.id
      WHERE a.status = 'APPROVED' AND p.status = 'SUSPENDED'
    ),
    'pending_lco_applications', (SELECT COALESCE(COUNT(*), 0) FROM public.lco_applications WHERE status IN ('PENDING', 'UNDER_REVIEW')),
    'rejected_lco_applications', (SELECT COALESCE(COUNT(*), 0) FROM public.lco_applications WHERE status = 'REJECTED'),
    'total_customers', (SELECT COALESCE(COUNT(*), 0) FROM public.customers),
    'active_customers', (SELECT COALESCE(COUNT(*), 0) FROM public.customers WHERE service_status = 'ACTIVE'),
    'total_technicians', (SELECT COALESCE(COUNT(*), 0) FROM public.technicians),
    'active_technicians', (SELECT COALESCE(COUNT(*), 0) FROM public.technicians WHERE status = 'ACTIVE'),
    'total_service_requests', (SELECT COALESCE(COUNT(*), 0) FROM public.service_requests),
    'open_service_requests', (SELECT COALESCE(COUNT(*), 0) FROM public.service_requests WHERE status IN ('OPEN', 'IN_PROGRESS')),
    'total_billed_amount', (SELECT COALESCE(SUM(amount), 0) FROM public.customer_bills),
    'total_collected_amount', (SELECT COALESCE(SUM(amount), 0) FROM public.customer_payments)
  ) INTO v_result;

  RETURN v_result;
END;
$$;


-- ══════════════════════════════════════════════
-- 2. RPC: APPROVED LCO OPERATOR DIRECTORY
-- ══════════════════════════════════════════════
-- Returns paginated list of approved LCO operators with account status,
-- customer counts, and technician counts.

CREATE OR REPLACE FUNCTION public.get_super_admin_lco_directory(
  p_search TEXT DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
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
  v_status TEXT;
  v_total_records INT;
  v_data JSONB;
  v_result JSONB;
BEGIN
  -- Security check
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: Caller is not a Super Admin';
  END IF;

  -- Clamp pagination
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_offset := GREATEST(COALESCE(p_offset, 0), 0);
  v_search := NULLIF(trim(p_search), '');
  v_status := NULLIF(trim(upper(p_status)), '');

  -- Count total matching records BEFORE pagination
  SELECT COUNT(*) INTO v_total_records
  FROM public.lco_applications a
  LEFT JOIN public.profiles p ON a.user_id = p.id
  WHERE a.status = 'APPROVED'
    AND (
      v_status IS NULL 
      OR v_status = 'ALL'
      OR (v_status = 'ACTIVE' AND (p.status IS NULL OR p.status = 'ACTIVE'))
      OR (v_status = 'SUSPENDED' AND p.status = 'SUSPENDED')
    )
    AND (
      v_search IS NULL
      OR a.application_id ILIKE '%' || v_search || '%'
      OR a.business_name ILIKE '%' || v_search || '%'
      OR a.owner_name ILIKE '%' || v_search || '%'
      OR a.email ILIKE '%' || v_search || '%'
      OR a.phone ILIKE '%' || v_search || '%'
      OR a.city ILIKE '%' || v_search || '%'
      OR a.state ILIKE '%' || v_search || '%'
      OR a.pincode ILIKE '%' || v_search || '%'
    );

  -- Fetch paginated dataset
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', a.id,
      'application_id', a.application_id,
      'user_id', a.user_id,
      'business_name', a.business_name,
      'owner_name', a.owner_name,
      'email', a.email,
      'phone', a.phone,
      'address', a.address,
      'city', a.city,
      'state', a.state,
      'pincode', a.pincode,
      'services', a.services,
      'account_status', COALESCE(a.profile_status, 'ACTIVE'),
      'application_status', a.status,
      'total_customers', COALESCE(cust.total_cust, 0),
      'active_customers', COALESCE(cust.active_cust, 0),
      'total_technicians', COALESCE(tech.total_tech, 0),
      'active_technicians', COALESCE(tech.active_tech, 0),
      'reviewed_at', a.reviewed_at,
      'created_at', a.created_at
    )
  ), '[]'::jsonb) INTO v_data
  FROM (
    SELECT a.*, p.status AS profile_status
    FROM public.lco_applications a
    LEFT JOIN public.profiles p ON a.user_id = p.id
    WHERE a.status = 'APPROVED'
      AND (
        v_status IS NULL 
        OR v_status = 'ALL'
        OR (v_status = 'ACTIVE' AND (p.status IS NULL OR p.status = 'ACTIVE'))
        OR (v_status = 'SUSPENDED' AND p.status = 'SUSPENDED')
      )
      AND (
        v_search IS NULL
        OR a.application_id ILIKE '%' || v_search || '%'
        OR a.business_name ILIKE '%' || v_search || '%'
        OR a.owner_name ILIKE '%' || v_search || '%'
        OR a.email ILIKE '%' || v_search || '%'
        OR a.phone ILIKE '%' || v_search || '%'
        OR a.city ILIKE '%' || v_search || '%'
        OR a.state ILIKE '%' || v_search || '%'
        OR a.pincode ILIKE '%' || v_search || '%'
      )
    ORDER BY a.created_at DESC
    LIMIT v_limit OFFSET v_offset
  ) a
  LEFT JOIN LATERAL (
    SELECT 
      COUNT(*) AS total_cust,
      COUNT(*) FILTER (WHERE c.service_status = 'ACTIVE') AS active_cust
    FROM public.customers c
    WHERE c.lco_id = a.id
  ) cust ON true
  LEFT JOIN LATERAL (
    SELECT 
      COUNT(*) AS total_tech,
      COUNT(*) FILTER (WHERE t.status = 'ACTIVE') AS active_tech
    FROM public.technicians t
    WHERE t.lco_id = a.id
  ) tech ON true;

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
-- 3. RPC: LCO OPERATOR DETAIL INSPECTOR
-- ══════════════════════════════════════════════
-- Returns detailed operational metrics and account profile information
-- for a specific approved LCO application.

CREATE OR REPLACE FUNCTION public.get_super_admin_lco_detail(
  p_application_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app public.lco_applications%ROWTYPE;
  v_profile_status TEXT;
  v_reviewer_email TEXT;
  v_result JSONB;
BEGIN
  -- Security check
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: Caller is not a Super Admin';
  END IF;

  -- Locate application
  SELECT * INTO v_app
  FROM public.lco_applications
  WHERE id = p_application_id AND status = 'APPROVED';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approved LCO application not found for ID: %', p_application_id;
  END IF;

  -- Fetch linked profile status
  IF v_app.user_id IS NOT NULL THEN
    SELECT status INTO v_profile_status
    FROM public.profiles
    WHERE id = v_app.user_id;
  END IF;

  -- Fetch reviewer email if reviewed_by is set
  IF v_app.reviewed_by IS NOT NULL THEN
    SELECT email INTO v_reviewer_email
    FROM public.profiles
    WHERE id = v_app.reviewed_by;
  END IF;

  SELECT jsonb_build_object(
    'application', jsonb_build_object(
      'id', v_app.id,
      'application_id', v_app.application_id,
      'user_id', v_app.user_id,
      'business_name', v_app.business_name,
      'owner_name', v_app.owner_name,
      'email', v_app.email,
      'phone', v_app.phone,
      'address', v_app.address,
      'city', v_app.city,
      'state', v_app.state,
      'pincode', v_app.pincode,
      'services', v_app.services,
      'other_service_description', v_app.other_service_description,
      'service_area_locality', v_app.service_area_locality,
      'service_area_city', v_app.service_area_city,
      'service_area_state', v_app.service_area_state,
      'service_area_pincode', v_app.service_area_pincode,
      'service_area_description', v_app.service_area_description,
      'application_status', v_app.status,
      'account_status', COALESCE(v_profile_status, 'ACTIVE'),
      'reviewed_by', v_app.reviewed_by,
      'reviewer_email', v_reviewer_email,
      'reviewed_at', v_app.reviewed_at,
      'review_notes', v_app.review_notes,
      'created_at', v_app.created_at,
      'updated_at', v_app.updated_at
    ),
    'customers', (
      SELECT jsonb_build_object(
        'total', COALESCE(COUNT(*), 0),
        'active', COALESCE(COUNT(*) FILTER (WHERE service_status = 'ACTIVE'), 0),
        'inactive', COALESCE(COUNT(*) FILTER (WHERE service_status = 'INACTIVE'), 0),
        'suspended', COALESCE(COUNT(*) FILTER (WHERE service_status = 'SUSPENDED'), 0),
        'pending', COALESCE(COUNT(*) FILTER (WHERE service_status = 'PENDING'), 0)
      )
      FROM public.customers WHERE lco_id = v_app.id
    ),
    'technicians', (
      SELECT jsonb_build_object(
        'total', COALESCE(COUNT(*), 0),
        'active', COALESCE(COUNT(*) FILTER (WHERE status = 'ACTIVE'), 0),
        'inactive', COALESCE(COUNT(*) FILTER (WHERE status = 'INACTIVE'), 0),
        'suspended', COALESCE(COUNT(*) FILTER (WHERE status = 'SUSPENDED'), 0)
      )
      FROM public.technicians WHERE lco_id = v_app.id
    ),
    'billing', (
      SELECT jsonb_build_object(
        'total_bills', COALESCE(COUNT(*), 0),
        'total_billed_amount', COALESCE(SUM(amount), 0),
        'total_paid_amount', COALESCE(SUM(paid_amount), 0),
        'outstanding_balance', COALESCE(SUM(amount - paid_amount), 0)
      )
      FROM public.customer_bills WHERE lco_id = v_app.id
    ),
    'payments', (
      SELECT jsonb_build_object(
        'total_payments', COALESCE(COUNT(*), 0),
        'total_collected_amount', COALESCE(SUM(amount), 0)
      )
      FROM public.customer_payments WHERE lco_id = v_app.id
    ),
    'service_requests', (
      SELECT jsonb_build_object(
        'total_requests', COALESCE(COUNT(*), 0),
        'open_requests', COALESCE(COUNT(*) FILTER (WHERE status = 'OPEN'), 0),
        'in_progress_requests', COALESCE(COUNT(*) FILTER (WHERE status = 'IN_PROGRESS'), 0),
        'resolved_requests', COALESCE(COUNT(*) FILTER (WHERE status = 'RESOLVED'), 0),
        'closed_requests', COALESCE(COUNT(*) FILTER (WHERE status = 'CLOSED'), 0)
      )
      FROM public.service_requests WHERE lco_id = v_app.id
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;


-- ══════════════════════════════════════════════
-- 4. RPC: LCO ACCOUNT STATUS GOVERNANCE
-- ══════════════════════════════════════════════
-- Toggles profile status (ACTIVE <-> SUSPENDED) for linked LCO_ADMIN accounts.
-- Preserves lco_applications.status = 'APPROVED'.

CREATE OR REPLACE FUNCTION public.manage_lco_status(
  p_application_id UUID,
  p_new_status TEXT,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app public.lco_applications%ROWTYPE;
  v_target_profile public.profiles%ROWTYPE;
  v_normalized_status TEXT;
  v_clean_reason TEXT;
  v_old_status TEXT;
  v_result JSONB;
BEGIN
  -- 1. Security check: Caller MUST be Super Admin
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: Only a Super Admin can manage LCO account status';
  END IF;

  -- 2. Validate input parameters
  v_normalized_status := upper(trim(COALESCE(p_new_status, '')));
  v_clean_reason := trim(COALESCE(p_reason, ''));

  IF v_normalized_status NOT IN ('ACTIVE', 'SUSPENDED') THEN
    RAISE EXCEPTION 'Invalid status transition target: %. Status must be ACTIVE or SUSPENDED', p_new_status;
  END IF;

  IF v_clean_reason = '' THEN
    RAISE EXCEPTION 'A valid reason is required for account status management';
  END IF;

  -- 3. Lock application row for atomic update
  SELECT * INTO v_app
  FROM public.lco_applications
  WHERE id = p_application_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'LCO application not found for ID: %', p_application_id;
  END IF;

  IF v_app.status <> 'APPROVED' THEN
    RAISE EXCEPTION 'Account status can only be managed for APPROVED LCO applications (Current status: %)', v_app.status;
  END IF;

  IF v_app.user_id IS NULL THEN
    RAISE EXCEPTION 'LCO application does not have a linked user account profile';
  END IF;

  -- 4. Lock linked profile row
  SELECT * INTO v_target_profile
  FROM public.profiles
  WHERE id = v_app.user_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Linked user profile not found for user_id: %', v_app.user_id;
  END IF;

  -- Security check: Ensure target profile is an LCO_ADMIN (prevent accidental Super Admin modification)
  IF v_target_profile.role <> 'LCO_ADMIN' THEN
    RAISE EXCEPTION 'Target user profile is not an LCO_ADMIN (Role: %)', v_target_profile.role;
  END IF;

  v_old_status := COALESCE(v_target_profile.status, 'ACTIVE');

  IF v_old_status = v_normalized_status THEN
    RAISE EXCEPTION 'LCO account is already in status: %', v_normalized_status;
  END IF;

  -- 5. Atomic Profile Status Update
  -- CRITICAL RULE: Update ONLY profiles.status. Keep lco_applications.status = APPROVED.
  UPDATE public.profiles
  SET 
    status = v_normalized_status,
    updated_at = now()
  WHERE id = v_app.user_id;

  v_result := jsonb_build_object(
    'success', true,
    'application_id', v_app.id,
    'user_id', v_app.user_id,
    'business_name', v_app.business_name,
    'old_status', v_old_status,
    'new_status', v_normalized_status,
    'reason', v_clean_reason,
    'updated_at', now()
  );

  RETURN v_result;
END;
$$;


-- ══════════════════════════════════════════════
-- 5. EXECUTION PERMISSIONS
-- ══════════════════════════════════════════════

REVOKE ALL ON FUNCTION public.get_super_admin_platform_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_super_admin_platform_overview() TO authenticated;

REVOKE ALL ON FUNCTION public.get_super_admin_lco_directory(TEXT, TEXT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_super_admin_lco_directory(TEXT, TEXT, INT, INT) TO authenticated;

REVOKE ALL ON FUNCTION public.get_super_admin_lco_detail(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_super_admin_lco_detail(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.manage_lco_status(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manage_lco_status(UUID, TEXT, TEXT) TO authenticated;
