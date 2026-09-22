-- ============================================================================
-- PHASE 11 BATCH 2 — BROADCASTS + URGENT NOTICES MIGRATION
-- ============================================================================
-- Features:
--   1. Customer Broadcasts schema (public.broadcasts, public.broadcast_recipients)
--   2. Urgent Customer Notices schema (public.urgent_notices, public.urgent_notice_recipients, public.urgent_notice_dismissals)
--   3. Row Level Security (RLS) policies for tenant & role isolation
--   4. Security Definer RPC functions for LCO Admin & Customer workflows
-- ============================================================================
-- SAFE, ADDITIVE & IDEMPOTENT: Safe to run multiple times.
-- ============================================================================

BEGIN;

-- ══════════════════════════════════════════════
-- 1. PUBLIC.BROADCASTS TABLE
-- ══════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.broadcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lco_id UUID NOT NULL REFERENCES public.lco_applications(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  audience TEXT NOT NULL CHECK (audience IN ('ALL_CUSTOMERS', 'SELECTED_CUSTOMERS')),
  expires_at TIMESTAMPTZ,
  recipient_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_broadcasts_lco_id ON public.broadcasts(lco_id);
CREATE INDEX IF NOT EXISTS idx_broadcasts_created_at ON public.broadcasts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_broadcasts_expires_at ON public.broadcasts(expires_at);


-- ══════════════════════════════════════════════
-- 2. PUBLIC.BROADCAST_RECIPIENTS TABLE
-- ══════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.broadcast_recipients (
  broadcast_id UUID NOT NULL REFERENCES public.broadcasts(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (broadcast_id, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_customer_id ON public.broadcast_recipients(customer_id);


-- ══════════════════════════════════════════════
-- 3. PUBLIC.URGENT_NOTICES TABLE
-- ══════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.urgent_notices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lco_id UUID NOT NULL REFERENCES public.lco_applications(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  audience TEXT NOT NULL CHECK (audience IN ('ALL_CUSTOMERS', 'SELECTED_CUSTOMERS')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_urgent_notices_lco_id ON public.urgent_notices(lco_id);
CREATE INDEX IF NOT EXISTS idx_urgent_notices_active_expires ON public.urgent_notices(is_active, expires_at);
CREATE INDEX IF NOT EXISTS idx_urgent_notices_created_at ON public.urgent_notices(created_at DESC);


-- ══════════════════════════════════════════════
-- 4. PUBLIC.URGENT_NOTICE_RECIPIENTS TABLE
-- ══════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.urgent_notice_recipients (
  notice_id UUID NOT NULL REFERENCES public.urgent_notices(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (notice_id, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_urgent_notice_recipients_customer_id ON public.urgent_notice_recipients(customer_id);


-- ══════════════════════════════════════════════
-- 5. PUBLIC.URGENT_NOTICE_DISMISSALS TABLE
-- ══════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.urgent_notice_dismissals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notice_id UUID NOT NULL REFERENCES public.urgent_notices(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT urgent_notice_dismissals_unique UNIQUE (notice_id, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_urgent_notice_dismissals_customer_id ON public.urgent_notice_dismissals(customer_id);
CREATE INDEX IF NOT EXISTS idx_urgent_notice_dismissals_notice_id ON public.urgent_notice_dismissals(notice_id);


-- ══════════════════════════════════════════════
-- 6. ROW LEVEL SECURITY (RLS) POLICIES
-- ══════════════════════════════════════════════

-- ── public.broadcasts RLS ──
ALTER TABLE public.broadcasts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "LCO Admin can view own broadcasts" ON public.broadcasts;
CREATE POLICY "LCO Admin can view own broadcasts"
  ON public.broadcasts FOR SELECT TO authenticated
  USING (lco_id = public.get_lco_id());

DROP POLICY IF EXISTS "LCO Admin can insert own broadcasts" ON public.broadcasts;
CREATE POLICY "LCO Admin can insert own broadcasts"
  ON public.broadcasts FOR INSERT TO authenticated
  WITH CHECK (lco_id = public.get_lco_id());

DROP POLICY IF EXISTS "Super Admin can manage all broadcasts" ON public.broadcasts;
CREATE POLICY "Super Admin can manage all broadcasts"
  ON public.broadcasts FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());


-- ── public.broadcast_recipients RLS ──
ALTER TABLE public.broadcast_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "LCO Admin can view own broadcast recipients" ON public.broadcast_recipients;
CREATE POLICY "LCO Admin can view own broadcast recipients"
  ON public.broadcast_recipients FOR SELECT TO authenticated
  USING (broadcast_id IN (SELECT id FROM public.broadcasts WHERE lco_id = public.get_lco_id()));

DROP POLICY IF EXISTS "Customer can view own broadcast recipient entries" ON public.broadcast_recipients;
CREATE POLICY "Customer can view own broadcast recipient entries"
  ON public.broadcast_recipients FOR SELECT TO authenticated
  USING (customer_id = public.get_customer_id());

DROP POLICY IF EXISTS "Super Admin can manage all broadcast recipients" ON public.broadcast_recipients;
CREATE POLICY "Super Admin can manage all broadcast recipients"
  ON public.broadcast_recipients FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());


-- ── public.urgent_notices RLS ──
ALTER TABLE public.urgent_notices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "LCO Admin can manage own urgent notices" ON public.urgent_notices;
CREATE POLICY "LCO Admin can manage own urgent notices"
  ON public.urgent_notices FOR ALL TO authenticated
  USING (lco_id = public.get_lco_id())
  WITH CHECK (lco_id = public.get_lco_id());

DROP POLICY IF EXISTS "Customer can view targeted active unexpired urgent notices" ON public.urgent_notices;
CREATE POLICY "Customer can view targeted active unexpired urgent notices"
  ON public.urgent_notices FOR SELECT TO authenticated
  USING (
    lco_id = public.get_customer_lco_id()
    AND is_active = true
    AND (expires_at IS NULL OR expires_at > now())
    AND (
      audience = 'ALL_CUSTOMERS'
      OR id IN (SELECT notice_id FROM public.urgent_notice_recipients WHERE customer_id = public.get_customer_id())
    )
  );

DROP POLICY IF EXISTS "Super Admin can manage all urgent notices" ON public.urgent_notices;
CREATE POLICY "Super Admin can manage all urgent notices"
  ON public.urgent_notices FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());


-- ── public.urgent_notice_recipients RLS ──
ALTER TABLE public.urgent_notice_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "LCO Admin can manage urgent notice recipients" ON public.urgent_notice_recipients;
CREATE POLICY "LCO Admin can manage urgent notice recipients"
  ON public.urgent_notice_recipients FOR ALL TO authenticated
  USING (notice_id IN (SELECT id FROM public.urgent_notices WHERE lco_id = public.get_lco_id()))
  WITH CHECK (notice_id IN (SELECT id FROM public.urgent_notices WHERE lco_id = public.get_lco_id()));

DROP POLICY IF EXISTS "Customer can view own urgent notice recipient rows" ON public.urgent_notice_recipients;
CREATE POLICY "Customer can view own urgent notice recipient rows"
  ON public.urgent_notice_recipients FOR SELECT TO authenticated
  USING (customer_id = public.get_customer_id());

DROP POLICY IF EXISTS "Super Admin can manage all urgent notice recipients" ON public.urgent_notice_recipients;
CREATE POLICY "Super Admin can manage all urgent notice recipients"
  ON public.urgent_notice_recipients FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());


-- ── public.urgent_notice_dismissals RLS ──
ALTER TABLE public.urgent_notice_dismissals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Customer can select own dismissals" ON public.urgent_notice_dismissals;
CREATE POLICY "Customer can select own dismissals"
  ON public.urgent_notice_dismissals FOR SELECT TO authenticated
  USING (customer_id = public.get_customer_id());

DROP POLICY IF EXISTS "Customer can insert own dismissals" ON public.urgent_notice_dismissals;
CREATE POLICY "Customer can insert own dismissals"
  ON public.urgent_notice_dismissals FOR INSERT TO authenticated
  WITH CHECK (customer_id = public.get_customer_id());

DROP POLICY IF EXISTS "LCO Admin can view dismissals for their urgent notices" ON public.urgent_notice_dismissals;
CREATE POLICY "LCO Admin can view dismissals for their urgent notices"
  ON public.urgent_notice_dismissals FOR SELECT TO authenticated
  USING (notice_id IN (SELECT id FROM public.urgent_notices WHERE lco_id = public.get_lco_id()));

DROP POLICY IF EXISTS "Super Admin can manage all urgent notice dismissals" ON public.urgent_notice_dismissals;
CREATE POLICY "Super Admin can manage all urgent notice dismissals"
  ON public.urgent_notice_dismissals FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());


-- ══════════════════════════════════════════════
-- 7. SECURITY DEFINER RPC FUNCTIONS
-- ══════════════════════════════════════════════

-- ── RPC 1: CREATE CUSTOMER BROADCAST ──
CREATE OR REPLACE FUNCTION public.create_customer_broadcast(
  p_title TEXT,
  p_message TEXT,
  p_audience TEXT,
  p_customer_ids UUID[] DEFAULT NULL,
  p_expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_lco_id UUID;
  v_target_cust_ids UUID[];
  v_broadcast_id UUID;
  v_count INT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  v_lco_id := public.get_lco_id();
  IF v_lco_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized. Only active LCO Admins can create broadcasts.';
  END IF;

  IF coalesce(trim(p_title), '') = '' OR coalesce(trim(p_message), '') = '' THEN
    RAISE EXCEPTION 'Title and message are required.';
  END IF;

  IF p_audience NOT IN ('ALL_CUSTOMERS', 'SELECTED_CUSTOMERS') THEN
    RAISE EXCEPTION 'Invalid audience selection.';
  END IF;

  -- Resolve target active customer IDs strictly within authenticated LCO
  IF p_audience = 'ALL_CUSTOMERS' THEN
    SELECT array_agg(id) INTO v_target_cust_ids
    FROM public.customers
    WHERE lco_id = v_lco_id AND service_status = 'ACTIVE';
  ELSE
    IF p_customer_ids IS NULL OR array_length(p_customer_ids, 1) IS NULL THEN
      RAISE EXCEPTION 'At least one customer must be selected.';
    END IF;

    SELECT array_agg(id) INTO v_target_cust_ids
    FROM public.customers
    WHERE lco_id = v_lco_id 
      AND service_status = 'ACTIVE'
      AND id = ANY(p_customer_ids);
  END IF;

  v_count := COALESCE(array_length(v_target_cust_ids, 1), 0);
  IF v_count = 0 THEN
    RAISE EXCEPTION 'No active target customers found for this broadcast.';
  END IF;

  -- Insert Broadcast record
  INSERT INTO public.broadcasts (lco_id, title, message, audience, expires_at, recipient_count)
  VALUES (v_lco_id, trim(p_title), trim(p_message), p_audience, p_expires_at, v_count)
  RETURNING id INTO v_broadcast_id;

  -- Track Broadcast Recipients
  INSERT INTO public.broadcast_recipients (broadcast_id, customer_id)
  SELECT v_broadcast_id, cid FROM unnest(v_target_cust_ids) AS cid;

  -- Create Notification records for each intended customer recipient
  INSERT INTO public.notifications (
    lco_id, customer_id, technician_id, recipient_role, category, title, message, type, created_at
  )
  SELECT
    v_lco_id,
    cid,
    NULL,
    'CUSTOMER',
    'ANNOUNCEMENT',
    trim(p_title),
    trim(p_message),
    'INFO',
    now()
  FROM unnest(v_target_cust_ids) AS cid;

  RETURN jsonb_build_object(
    'success', true,
    'broadcast_id', v_broadcast_id,
    'recipient_count', v_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_customer_broadcast(TEXT, TEXT, TEXT, UUID[], TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_customer_broadcast(TEXT, TEXT, TEXT, UUID[], TIMESTAMPTZ) TO authenticated;


-- ── RPC 2: CREATE URGENT NOTICE ──
CREATE OR REPLACE FUNCTION public.create_urgent_notice(
  p_title TEXT,
  p_message TEXT,
  p_audience TEXT,
  p_customer_ids UUID[] DEFAULT NULL,
  p_expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_lco_id UUID;
  v_target_cust_ids UUID[];
  v_notice_id UUID;
  v_count INT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  v_lco_id := public.get_lco_id();
  IF v_lco_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized. Only active LCO Admins can create urgent notices.';
  END IF;

  IF coalesce(trim(p_title), '') = '' OR coalesce(trim(p_message), '') = '' THEN
    RAISE EXCEPTION 'Title and message are required.';
  END IF;

  IF p_audience NOT IN ('ALL_CUSTOMERS', 'SELECTED_CUSTOMERS') THEN
    RAISE EXCEPTION 'Invalid audience selection.';
  END IF;

  -- Resolve target active customer IDs strictly within authenticated LCO
  IF p_audience = 'ALL_CUSTOMERS' THEN
    SELECT array_agg(id) INTO v_target_cust_ids
    FROM public.customers
    WHERE lco_id = v_lco_id AND service_status = 'ACTIVE';
  ELSE
    IF p_customer_ids IS NULL OR array_length(p_customer_ids, 1) IS NULL THEN
      RAISE EXCEPTION 'At least one customer must be selected.';
    END IF;

    SELECT array_agg(id) INTO v_target_cust_ids
    FROM public.customers
    WHERE lco_id = v_lco_id 
      AND service_status = 'ACTIVE'
      AND id = ANY(p_customer_ids);
  END IF;

  v_count := COALESCE(array_length(v_target_cust_ids, 1), 0);
  IF v_count = 0 THEN
    RAISE EXCEPTION 'No active target customers found for this urgent notice.';
  END IF;

  -- Insert Urgent Notice record
  INSERT INTO public.urgent_notices (lco_id, title, message, audience, is_active, expires_at)
  VALUES (v_lco_id, trim(p_title), trim(p_message), p_audience, true, p_expires_at)
  RETURNING id INTO v_notice_id;

  -- Track Urgent Notice Recipients (for selected or explicit target list)
  IF p_audience = 'SELECTED_CUSTOMERS' THEN
    INSERT INTO public.urgent_notice_recipients (notice_id, customer_id)
    SELECT v_notice_id, cid FROM unnest(v_target_cust_ids) AS cid;
  END IF;

  -- ALSO create customer notification records for feed history
  INSERT INTO public.notifications (
    lco_id, customer_id, technician_id, recipient_role, category, title, message, type, created_at
  )
  SELECT
    v_lco_id,
    cid,
    NULL,
    'CUSTOMER',
    'ANNOUNCEMENT',
    '🚨 URGENT: ' || trim(p_title),
    trim(p_message),
    'WARNING',
    now()
  FROM unnest(v_target_cust_ids) AS cid;

  RETURN jsonb_build_object(
    'success', true,
    'notice_id', v_notice_id,
    'recipient_count', v_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_urgent_notice(TEXT, TEXT, TEXT, UUID[], TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_urgent_notice(TEXT, TEXT, TEXT, UUID[], TIMESTAMPTZ) TO authenticated;


-- ── RPC 3: DISMISS URGENT NOTICE (Customer side) ──
CREATE OR REPLACE FUNCTION public.dismiss_urgent_notice(
  p_notice_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_cust_id UUID;
  v_notice public.urgent_notices%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  v_cust_id := public.get_customer_id();
  IF v_cust_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized. Only customer accounts can dismiss urgent notices.';
  END IF;

  SELECT * INTO v_notice FROM public.urgent_notices WHERE id = p_notice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Urgent notice not found.';
  END IF;

  -- Ensure notice belongs to customer's LCO
  IF v_notice.lco_id != public.get_customer_lco_id() THEN
    RAISE EXCEPTION 'Access denied.';
  END IF;

  -- Insert dismissal record (idempotent)
  INSERT INTO public.urgent_notice_dismissals (notice_id, customer_id, dismissed_at)
  VALUES (p_notice_id, v_cust_id, now())
  ON CONFLICT (notice_id, customer_id) DO NOTHING;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.dismiss_urgent_notice(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dismiss_urgent_notice(UUID) TO authenticated;


-- ── RPC 4: GET ACTIVE URGENT NOTICES FOR CUSTOMER ──
CREATE OR REPLACE FUNCTION public.get_active_urgent_notices_for_customer()
RETURNS TABLE (
  id UUID,
  title TEXT,
  message TEXT,
  audience TEXT,
  created_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_cust_id UUID;
  v_lco_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  v_cust_id := public.get_customer_id();
  v_lco_id := public.get_customer_lco_id();

  IF v_cust_id IS NULL OR v_lco_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT 
    un.id,
    un.title,
    un.message,
    un.audience,
    un.created_at,
    un.expires_at
  FROM public.urgent_notices un
  WHERE un.lco_id = v_lco_id
    AND un.is_active = true
    AND (un.expires_at IS NULL OR un.expires_at > now())
    AND (
      un.audience = 'ALL_CUSTOMERS'
      OR EXISTS (
        SELECT 1 FROM public.urgent_notice_recipients unr
        WHERE unr.notice_id = un.id AND unr.customer_id = v_cust_id
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.urgent_notice_dismissals und
      WHERE und.notice_id = un.id AND und.customer_id = v_cust_id
    )
  ORDER BY un.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_active_urgent_notices_for_customer() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_urgent_notices_for_customer() TO authenticated;


-- ── RPC 5: GET LCO BROADCAST HISTORY ──
CREATE OR REPLACE FUNCTION public.get_lco_broadcast_history()
RETURNS TABLE (
  id UUID,
  title TEXT,
  message TEXT,
  audience TEXT,
  created_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  recipient_count INT,
  status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_lco_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  v_lco_id := public.get_lco_id();
  IF v_lco_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized.';
  END IF;

  RETURN QUERY
  SELECT 
    b.id,
    b.title,
    b.message,
    b.audience,
    b.created_at,
    b.expires_at,
    b.recipient_count,
    CASE 
      WHEN b.expires_at IS NOT NULL AND b.expires_at <= now() THEN 'EXPIRED'
      ELSE 'ACTIVE'
    END AS status
  FROM public.broadcasts b
  WHERE b.lco_id = v_lco_id
  ORDER BY b.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_lco_broadcast_history() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_lco_broadcast_history() TO authenticated;


-- ── RPC 6: GET LCO URGENT NOTICES HISTORY ──
CREATE OR REPLACE FUNCTION public.get_lco_urgent_notices_history()
RETURNS TABLE (
  id UUID,
  title TEXT,
  message TEXT,
  audience TEXT,
  is_active BOOLEAN,
  created_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  recipient_count INT,
  dismissal_count INT,
  status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_lco_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  v_lco_id := public.get_lco_id();
  IF v_lco_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized.';
  END IF;

  RETURN QUERY
  SELECT 
    un.id,
    un.title,
    un.message,
    un.audience,
    un.is_active,
    un.created_at,
    un.expires_at,
    CASE 
      WHEN un.audience = 'ALL_CUSTOMERS' THEN (SELECT COUNT(*)::INT FROM public.customers c WHERE c.lco_id = v_lco_id AND c.service_status = 'ACTIVE')
      ELSE (SELECT COUNT(*)::INT FROM public.urgent_notice_recipients unr WHERE unr.notice_id = un.id)
    END AS recipient_count,
    (SELECT COUNT(*)::INT FROM public.urgent_notice_dismissals und WHERE und.notice_id = un.id) AS dismissal_count,
    CASE 
      WHEN un.is_active = false THEN 'INACTIVE'
      WHEN un.expires_at IS NOT NULL AND un.expires_at <= now() THEN 'EXPIRED'
      ELSE 'ACTIVE'
    END AS status
  FROM public.urgent_notices un
  WHERE un.lco_id = v_lco_id
  ORDER BY un.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_lco_urgent_notices_history() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_lco_urgent_notices_history() TO authenticated;


-- ── RPC 7: TOGGLE URGENT NOTICE ACTIVE STATUS ──
CREATE OR REPLACE FUNCTION public.toggle_urgent_notice_status(
  p_notice_id UUID,
  p_is_active BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_lco_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  v_lco_id := public.get_lco_id();
  IF v_lco_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized.';
  END IF;

  UPDATE public.urgent_notices
  SET is_active = p_is_active,
      updated_at = now()
  WHERE id = p_notice_id AND lco_id = v_lco_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Urgent notice not found or access denied.';
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.toggle_urgent_notice_status(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.toggle_urgent_notice_status(UUID, BOOLEAN) TO authenticated;

COMMIT;

-- ============================================================================
-- DONE — Phase 11 Batch 2 Database Migration Ready
-- ============================================================================
