-- ============================================================================
-- PHASE 11 BATCH 1 — NOTIFICATION CENTER & NOTIFICATION PREFERENCES MIGRATION
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ADD CATEGORY COLUMN TO PUBLIC.NOTIFICATIONS (IF NOT EXISTS)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'notifications'
      AND column_name = 'category'
  ) THEN
    ALTER TABLE public.notifications
    ADD COLUMN category TEXT NOT NULL DEFAULT 'SYSTEM';
  END IF;
END $$;

-- Add or replace category constraint
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_category_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_category_check
  CHECK (category IN (
    'ACCOUNT',
    'SERVICE_REQUEST',
    'PAYMENT',
    'ANNOUNCEMENT',
    'SYSTEM',
    'CUSTOMER_ACTIVITY',
    'TECHNICIAN_ACTIVITY'
  ));

-- Index on category
CREATE INDEX IF NOT EXISTS idx_notifications_category
  ON public.notifications (category);


-- ----------------------------------------------------------------------------
-- 2. BACKFILL CATEGORY FOR EXISTING NOTIFICATIONS
-- ----------------------------------------------------------------------------
UPDATE public.notifications
SET category = 'PAYMENT'
WHERE title ILIKE '%payment%' OR title ILIKE '%bill%';

UPDATE public.notifications
SET category = 'SERVICE_REQUEST'
WHERE title ILIKE '%service request%'
   OR title ILIKE '%ticket%'
   OR title ILIKE '%technician%'
   OR title ILIKE '%resolved%';

UPDATE public.notifications
SET category = 'ACCOUNT'
WHERE title ILIKE '%welcome%' OR title ILIKE '%account%';


-- ----------------------------------------------------------------------------
-- 3. CREATE PUBLIC.NOTIFICATION_PREFERENCES TABLE
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lco_id UUID REFERENCES public.lco_applications(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('LCO_ADMIN', 'CUSTOMER', 'TECHNICIAN')),
  category TEXT NOT NULL,
  channel_in_app BOOLEAN NOT NULL DEFAULT true,
  channel_email BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT notification_preferences_user_role_category_key UNIQUE (user_id, role, category)
);

CREATE INDEX IF NOT EXISTS idx_notification_preferences_user_role
  ON public.notification_preferences (user_id, role);

CREATE INDEX IF NOT EXISTS idx_notification_preferences_lco_id
  ON public.notification_preferences (lco_id);


-- ----------------------------------------------------------------------------
-- 4. RLS POLICIES FOR PUBLIC.NOTIFICATION_PREFERENCES
-- ----------------------------------------------------------------------------
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can select own notification preferences" ON public.notification_preferences;
CREATE POLICY "Users can select own notification preferences"
  ON public.notification_preferences
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own notification preferences" ON public.notification_preferences;
CREATE POLICY "Users can insert own notification preferences"
  ON public.notification_preferences
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own notification preferences" ON public.notification_preferences;
CREATE POLICY "Users can update own notification preferences"
  ON public.notification_preferences
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Super admins can manage all notification preferences" ON public.notification_preferences;
CREATE POLICY "Super admins can manage all notification preferences"
  ON public.notification_preferences
  FOR ALL
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());


-- ----------------------------------------------------------------------------
-- 5. RPC FUNCTION: GET_MY_NOTIFICATION_PREFERENCES
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_notification_preferences(p_role TEXT)
RETURNS TABLE (
  id UUID,
  role TEXT,
  category TEXT,
  channel_in_app BOOLEAN,
  channel_email BOOLEAN,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_lco_id UUID;
  v_cat RECORD;
  v_categories TEXT[];
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF p_role NOT IN ('LCO_ADMIN', 'CUSTOMER', 'TECHNICIAN') THEN
    RAISE EXCEPTION 'Invalid role specified.';
  END IF;

  -- Get user's LCO ID if applicable
  IF p_role = 'LCO_ADMIN' THEN
    SELECT lco_id INTO v_lco_id FROM public.profiles WHERE id = v_user_id;
  ELSIF p_role = 'CUSTOMER' THEN
    SELECT lco_id INTO v_lco_id FROM public.customers WHERE user_id = v_user_id;
  ELSIF p_role = 'TECHNICIAN' THEN
    SELECT lco_id INTO v_lco_id FROM public.technicians WHERE user_id = v_user_id;
  END IF;

  -- Define default categories per role
  IF p_role = 'CUSTOMER' THEN
    v_categories := ARRAY['ACCOUNT', 'SERVICE_REQUEST', 'PAYMENT', 'ANNOUNCEMENT'];
  ELSIF p_role = 'TECHNICIAN' THEN
    v_categories := ARRAY['ACCOUNT', 'SERVICE_REQUEST', 'SYSTEM', 'ANNOUNCEMENT'];
  ELSIF p_role = 'LCO_ADMIN' THEN
    v_categories := ARRAY['CUSTOMER_ACTIVITY', 'SERVICE_REQUEST', 'TECHNICIAN_ACTIVITY', 'PAYMENT', 'SYSTEM', 'ANNOUNCEMENT'];
  END IF;

  -- Insert default preference records if missing
  FOREACH v_cat.category IN ARRAY v_categories
  LOOP
    INSERT INTO public.notification_preferences (user_id, lco_id, role, category, channel_in_app, channel_email)
    VALUES (v_user_id, v_lco_id, p_role, v_cat.category, true, true)
    ON CONFLICT (user_id, role, category) DO NOTHING;
  END LOOP;

  -- Return preferences for authenticated user and specified role
  RETURN QUERY
  SELECT np.id, np.role, np.category, np.channel_in_app, np.channel_email, np.updated_at
  FROM public.notification_preferences np
  WHERE np.user_id = v_user_id
    AND np.role = p_role
  ORDER BY np.category ASC;
END;
$$;


-- ----------------------------------------------------------------------------
-- 6. RPC FUNCTION: SAVE_MY_NOTIFICATION_PREFERENCES
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_my_notification_preferences(
  p_role TEXT,
  p_preferences JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_lco_id UUID;
  v_elem JSONB;
  v_category TEXT;
  v_in_app BOOLEAN;
  v_email BOOLEAN;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF p_role NOT IN ('LCO_ADMIN', 'CUSTOMER', 'TECHNICIAN') THEN
    RAISE EXCEPTION 'Invalid role specified.';
  END IF;

  -- Resolve LCO ID
  IF p_role = 'LCO_ADMIN' THEN
    SELECT lco_id INTO v_lco_id FROM public.profiles WHERE id = v_user_id;
  ELSIF p_role = 'CUSTOMER' THEN
    SELECT lco_id INTO v_lco_id FROM public.customers WHERE user_id = v_user_id;
  ELSIF p_role = 'TECHNICIAN' THEN
    SELECT lco_id INTO v_lco_id FROM public.technicians WHERE user_id = v_user_id;
  END IF;

  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_preferences)
  LOOP
    v_category := v_elem ->> 'category';
    v_in_app := COALESCE((v_elem ->> 'channel_in_app')::BOOLEAN, true);
    v_email := COALESCE((v_elem ->> 'channel_email')::BOOLEAN, true);

    IF v_category IS NOT NULL THEN
      INSERT INTO public.notification_preferences (user_id, lco_id, role, category, channel_in_app, channel_email, updated_at)
      VALUES (v_user_id, v_lco_id, p_role, v_category, v_in_app, v_email, now())
      ON CONFLICT (user_id, role, category)
      DO UPDATE SET
        channel_in_app = EXCLUDED.channel_in_app,
        channel_email = EXCLUDED.channel_email,
        updated_at = now();
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true);
END;
$$;


-- ----------------------------------------------------------------------------
-- 7. UPDATE LINK ACCOUNT FUNCTIONS TO SET CATEGORY = 'ACCOUNT'
-- ----------------------------------------------------------------------------
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

  SELECT * INTO v_customer
  FROM public.customers
  WHERE UPPER(TRIM(customer_id)) = UPPER(TRIM(p_customer_id))
    AND LOWER(TRIM(email)) = LOWER(TRIM(p_email));

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer record not found. Please verify your Customer ID and Email.';
  END IF;

  IF v_customer.user_id IS NOT NULL AND v_customer.user_id != v_user_id THEN
    RAISE EXCEPTION 'This customer account has already been activated.';
  END IF;

  UPDATE public.customers
  SET user_id = v_user_id,
      updated_at = now()
  WHERE id = v_customer.id;

  UPDATE public.profiles
  SET role = 'CUSTOMER',
      status = 'ACTIVE'
  WHERE id = v_user_id;

  -- Create explicit customer-directed welcome notification
  INSERT INTO public.notifications (lco_id, customer_id, technician_id, recipient_role, category, title, message, type)
  VALUES (
    v_customer.lco_id,
    v_customer.id,
    NULL,
    'CUSTOMER',
    'ACCOUNT',
    'Welcome to Customer Portal!',
    'Your customer account has been activated. You can now view your subscription, service plans, and account details.',
    'SUCCESS'
  );

  RETURN jsonb_build_object(
    'success', true,
    'customer_id', v_customer.customer_id,
    'full_name', v_customer.full_name
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.link_technician_account(
  p_technician_id TEXT,
  p_email TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_auth_email TEXT;
  v_tech public.technicians%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF coalesce(trim(p_technician_id), '') = '' OR coalesce(trim(p_email), '') = '' THEN
    RAISE EXCEPTION 'Technician ID and email are required.';
  END IF;

  v_auth_email := COALESCE(
    NULLIF(trim(auth.jwt() ->> 'email'), ''),
    (SELECT email FROM auth.users WHERE id = v_user_id)
  );

  IF v_auth_email IS NULL THEN
    RAISE EXCEPTION 'Unable to verify authenticated email.';
  END IF;

  SELECT * INTO v_tech
  FROM public.technicians
  WHERE UPPER(TRIM(technician_id)) = UPPER(TRIM(p_technician_id))
    AND LOWER(TRIM(email)) = LOWER(TRIM(p_email));

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Technician record not found. Please verify your Technician ID and Email.';
  END IF;

  IF LOWER(TRIM(v_auth_email)) <> LOWER(TRIM(v_tech.email)) THEN
    RAISE EXCEPTION 'Authenticated email does not match the registered technician email.';
  END IF;

  IF v_tech.invitation_status = 'ACTIVATED' AND v_tech.user_id IS NOT DISTINCT FROM v_user_id THEN
    UPDATE public.profiles
    SET role = 'TECHNICIAN', status = 'ACTIVE'
    WHERE id = v_user_id;

    RETURN jsonb_build_object(
      'success', true,
      'technician_id', v_tech.technician_id,
      'full_name', v_tech.full_name,
      'already_activated', true
    );
  END IF;

  IF v_tech.invitation_status = 'DISABLED' THEN
    RAISE EXCEPTION 'This technician account has been disabled.';
  END IF;

  IF v_tech.user_id IS NOT NULL AND v_tech.user_id <> v_user_id THEN
    RAISE EXCEPTION 'This technician account has already been activated.';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id;
  IF FOUND AND v_profile.role NOT IN ('USER', 'TECHNICIAN') THEN
    RAISE EXCEPTION 'This account cannot be linked as a technician.';
  END IF;

  UPDATE public.technicians
  SET user_id = v_user_id,
      invitation_status = 'ACTIVATED',
      updated_at = now()
  WHERE id = v_tech.id;

  UPDATE public.profiles
  SET role = 'TECHNICIAN',
      status = 'ACTIVE'
  WHERE id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unable to activate technician profile.';
  END IF;

  -- Create explicit technician-directed welcome notification
  IF NOT EXISTS (
    SELECT 1 FROM public.notifications
    WHERE recipient_role = 'TECHNICIAN'
      AND technician_id = v_tech.id
      AND title = 'Welcome to Technician Portal!'
  ) THEN
    INSERT INTO public.notifications (lco_id, customer_id, technician_id, recipient_role, category, title, message, type)
    VALUES (
      v_tech.lco_id,
      NULL,
      v_tech.id,
      'TECHNICIAN',
      'ACCOUNT',
      'Welcome to Technician Portal!',
      'Your technician account (' || v_tech.technician_id || ') has been activated. You can now view and manage your assigned service requests.',
      'SUCCESS'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'technician_id', v_tech.technician_id,
    'full_name', v_tech.full_name
  );
END;
$$;


-- ----------------------------------------------------------------------------
-- 8. UPDATE SERVICE REQUEST NOTIFICATION TRIGGERS TO SET CATEGORY = 'SERVICE_REQUEST'
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_notify_service_request_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cust_name TEXT;
BEGIN
  SELECT full_name INTO v_cust_name
  FROM public.customers
  WHERE id = NEW.customer_id;

  -- 1. Notify LCO Admin
  INSERT INTO public.notifications (lco_id, customer_id, technician_id, recipient_role, category, title, message, type)
  VALUES (
    NEW.lco_id,
    NULL,
    NULL,
    'LCO_ADMIN',
    'SERVICE_REQUEST',
    'New Service Request: ' || NEW.request_id,
    'Customer ' || COALESCE(v_cust_name, 'User') || ' submitted a new ' || NEW.category || ' request: "' || NEW.subject || '".',
    'INFO'
  );

  -- 2. Confirmation to Customer
  INSERT INTO public.notifications (lco_id, customer_id, technician_id, recipient_role, category, title, message, type)
  VALUES (
    NEW.lco_id,
    NEW.customer_id,
    NULL,
    'CUSTOMER',
    'SERVICE_REQUEST',
    'Service Request Submitted',
    'Your service request ' || NEW.request_id || ' (' || NEW.subject || ') has been received and logged as OPEN.',
    'SUCCESS'
  );

  RETURN NEW;
END;
$$;

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

    INSERT INTO public.notifications (lco_id, customer_id, technician_id, recipient_role, category, title, message, type)
    VALUES (
      NEW.lco_id,
      NULL,
      NULL,
      'LCO_ADMIN',
      'SERVICE_REQUEST',
      'Service Request Cancelled: ' || NEW.request_id,
      'Customer ' || COALESCE(v_cust_name, 'User') || ' cancelled service request ' || NEW.request_id || '.',
      'WARNING'
    );
  END IF;

  -- Case B: Status or Resolution Note updated by LCO/Tech -> Notify Customer
  IF (NEW.status IS DISTINCT FROM OLD.status AND NEW.status != 'CANCELLED')
     OR (NEW.resolution_notes IS DISTINCT FROM OLD.resolution_notes AND NEW.resolution_notes IS NOT NULL)
  THEN
    IF NEW.status = 'RESOLVED' THEN
      INSERT INTO public.notifications (lco_id, customer_id, technician_id, recipient_role, category, title, message, type)
      VALUES (
        NEW.lco_id,
        NEW.customer_id,
        NULL,
        'CUSTOMER',
        'SERVICE_REQUEST',
        'Service Request Resolved: ' || NEW.request_id,
        'Your request ' || NEW.request_id || ' has been RESOLVED. ' || COALESCE('Resolution: ' || NEW.resolution_notes, ''),
        'SUCCESS'
      );
    ELSE
      INSERT INTO public.notifications (lco_id, customer_id, technician_id, recipient_role, category, title, message, type)
      VALUES (
        NEW.lco_id,
        NEW.customer_id,
        NULL,
        'CUSTOMER',
        'SERVICE_REQUEST',
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

CREATE OR REPLACE FUNCTION public.trg_notify_technician_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tech_name TEXT;
BEGIN
  -- 1. Technician Assignment / Reassignment Notification
  IF NEW.assigned_technician_id IS NOT NULL AND (OLD.assigned_technician_id IS NULL OR NEW.assigned_technician_id IS DISTINCT FROM OLD.assigned_technician_id) THEN
    INSERT INTO public.notifications (lco_id, customer_id, technician_id, recipient_role, category, title, message, type)
    VALUES (
      NEW.lco_id,
      NULL,
      NEW.assigned_technician_id,
      'TECHNICIAN',
      'SERVICE_REQUEST',
      'New Service Request Assigned',
      'You have been assigned to service request ' || NEW.request_id || ' (' || NEW.category || '): "' || NEW.subject || '".',
      'INFO'
    );
  END IF;

  -- 2. Notify LCO Admin when Technician starts work
  IF NEW.status = 'IN_PROGRESS' AND OLD.status != 'IN_PROGRESS' THEN
    SELECT full_name INTO v_tech_name FROM public.technicians WHERE id = NEW.assigned_technician_id;

    INSERT INTO public.notifications (lco_id, customer_id, technician_id, recipient_role, category, title, message, type)
    VALUES (
      NEW.lco_id,
      NULL,
      NULL,
      'LCO_ADMIN',
      'SERVICE_REQUEST',
      'Technician Started Work: ' || NEW.request_id,
      'Technician ' || COALESCE(v_tech_name, 'Assigned') || ' started work on service request ' || NEW.request_id || '.',
      'INFO'
    );
  END IF;

  -- 3. Notify LCO Admin when Technician resolves request
  IF NEW.status = 'RESOLVED' AND OLD.status != 'RESOLVED' THEN
    SELECT full_name INTO v_tech_name FROM public.technicians WHERE id = NEW.assigned_technician_id;

    INSERT INTO public.notifications (lco_id, customer_id, technician_id, recipient_role, category, title, message, type)
    VALUES (
      NEW.lco_id,
      NULL,
      NULL,
      'LCO_ADMIN',
      'SERVICE_REQUEST',
      'Technician Resolved Request: ' || NEW.request_id,
      'Technician ' || COALESCE(v_tech_name, 'Assigned') || ' marked service request ' || NEW.request_id || ' as RESOLVED.',
      'SUCCESS'
    );
  END IF;

  RETURN NEW;
END;
$$;
