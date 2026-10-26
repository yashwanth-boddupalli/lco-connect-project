-- ════════════════════════════════════════════════════════════════════
-- phase15 — Audit fix round, 26 Oct 2026 (branch develop1)
-- Source: ~/workspace/lco-connect-audit/2026-10-26-full-bug-audit.md
--
-- Sections:
--   LNK-03  link_lco_account: already-activated guard (canonical body =
--           phase14b + guard; the live def had no ACTIVATED check)
--   LNK-04/08 link_customer_account: canonical hardened body =
--           remediation-security-fixes.sql (the LIVE def was an old
--           short version: no already_activated, never set ACTIVATED)
--   LNK-04/08 link_technician_account: canonical body =
--           phase13-batch13c (matches live; re-asserted so the repo has
--           exactly one current definition per link RPC)
--   SA-03   review_lco_application: approval document gate (body =
--           phase13c + gate)
--   CT-C1   notifications: create the customer INSERT policy from
--           remediation-security-fixes.sql (it was never applied live —
--           pg_policies showed NO customer INSERT policy at all)
--   LCO-M1  record_customer_payment: new atomic RPC
--   PUB-M6  check_pending_application: new duplicate-check RPC
--
-- Every statement is idempotent (CREATE OR REPLACE / DROP IF EXISTS).
-- ════════════════════════════════════════════════════════════════════


-- ── LNK-03: link_lco_account (phase14b canonical + already-activated guard) ──

CREATE OR REPLACE FUNCTION public.link_lco_account(p_application_id TEXT, p_email TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_app public.lco_applications%ROWTYPE;
  v_email TEXT := lower(trim(p_email));
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_app
  FROM public.lco_applications
  WHERE upper(application_id) = upper(trim(p_application_id))
    AND lower(email) = v_email;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found for this email';
  END IF;

  IF v_app.status <> 'APPROVED' THEN
    RAISE EXCEPTION 'Application is not approved';
  END IF;

  IF v_app.user_id IS NOT NULL AND v_app.user_id <> v_user_id THEN
    RAISE EXCEPTION 'Application is already linked to a different account';
  END IF;

  -- phase15 (LNK-03): an already-activated application is terminal.
  -- The same user re-running activation is a safe no-op (the page reads
  -- already_activated and shows "already activated" instead of letting a
  -- second submit overwrite the password); anyone else is rejected below
  -- by the existing different-user check / the ACTIVATED raise here.
  IF v_app.invitation_status = 'ACTIVATED' AND v_app.user_id IS NOT DISTINCT FROM v_user_id THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already_activated', true,
      'application_id', v_app.application_id,
      'business_name', v_app.business_name
    );
  END IF;

  IF v_app.invitation_status = 'ACTIVATED' THEN
    RAISE EXCEPTION 'Application is already activated';
  END IF;

  UPDATE public.lco_applications
  SET user_id = v_user_id,
      invitation_status = 'ACTIVATED',
      updated_at = now()
  WHERE id = v_app.id;

  INSERT INTO public.profiles (id, email, role, status)
  VALUES (v_user_id, v_email, 'LCO_ADMIN', 'ACTIVE')
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        role = 'LCO_ADMIN',
        status = 'ACTIVE';

  RETURN jsonb_build_object(
    'ok', true,
    'application_id', v_app.application_id,
    'business_name', v_app.business_name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.link_lco_account(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_lco_account(TEXT, TEXT) TO authenticated;


-- ── LNK-04/08: link_customer_account (remediation canonical) ──

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
  v_auth_email TEXT;
  v_customer public.customers%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF coalesce(trim(p_customer_id), '') = '' OR coalesce(trim(p_email), '') = '' THEN
    RAISE EXCEPTION 'Customer ID and email are required.';
  END IF;

  -- Resolve authenticated email from JWT / auth.users
  v_auth_email := COALESCE(
    NULLIF(trim(auth.jwt() ->> 'email'), ''),
    (SELECT email FROM auth.users WHERE id = v_user_id)
  );

  IF v_auth_email IS NULL THEN
    RAISE EXCEPTION 'Unable to verify authenticated email.';
  END IF;

  -- Strict AND match on human customer_id + registered email (no OR fallback)
  SELECT * INTO v_customer
  FROM public.customers
  WHERE UPPER(TRIM(customer_id)) = UPPER(TRIM(p_customer_id))
    AND LOWER(TRIM(email)) = LOWER(TRIM(p_email));

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer record not found. Please verify your Customer ID and Email.';
  END IF;

  -- Authenticated user must own the registered email on the customer row
  IF LOWER(TRIM(v_auth_email)) <> LOWER(TRIM(v_customer.email)) THEN
    RAISE EXCEPTION 'Authenticated email does not match the registered customer email.';
  END IF;

  IF LOWER(TRIM(p_email)) <> LOWER(TRIM(v_customer.email)) THEN
    RAISE EXCEPTION 'Email does not match the customer record.';
  END IF;

  -- Idempotent: same user re-completing activation
  IF v_customer.invitation_status = 'ACTIVATED'
     AND v_customer.user_id IS NOT DISTINCT FROM v_user_id THEN
    UPDATE public.profiles
    SET role = 'CUSTOMER', status = 'ACTIVE'
    WHERE id = v_user_id
      AND role IN ('USER', 'CUSTOMER');

    RETURN jsonb_build_object(
      'success', true,
      'customer_id', v_customer.customer_id,
      'full_name', v_customer.full_name,
      'already_activated', true
    );
  END IF;

  IF v_customer.invitation_status = 'DISABLED' THEN
    RAISE EXCEPTION 'This customer account has been disabled.';
  END IF;

  IF v_customer.user_id IS NOT NULL AND v_customer.user_id <> v_user_id THEN
    RAISE EXCEPTION 'This customer account has already been activated.';
  END IF;

  IF v_customer.invitation_status = 'ACTIVATED' THEN
    RAISE EXCEPTION 'This customer account has already been activated.';
  END IF;

  -- Must have received an invitation email (server-side invite flow)
  IF v_customer.invitation_status NOT IN ('INVITED', 'FAILED') THEN
    RAISE EXCEPTION 'Customer invitation required before activation.';
  END IF;

  -- Do not overwrite privileged roles
  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id;
  IF FOUND AND v_profile.role NOT IN ('USER', 'CUSTOMER') THEN
    RAISE EXCEPTION 'This account cannot be linked as a customer.';
  END IF;

  -- Link auth user; preserve lco_id and customer_id (tenant ownership unchanged)
  UPDATE public.customers
  SET user_id = v_user_id,
      invitation_status = 'ACTIVATED',
      updated_at = now()
  WHERE id = v_customer.id;

  UPDATE public.profiles
  SET role = 'CUSTOMER',
      status = 'ACTIVE'
  WHERE id = v_user_id
    AND role IN ('USER', 'CUSTOMER');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unable to activate customer profile.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.notifications
    WHERE customer_id = v_customer.id
      AND title = 'Welcome to Customer Portal!'
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


-- ── LNK-04/08: link_technician_account (phase13c canonical) ──

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

  IF NOT EXISTS (
    SELECT 1 FROM public.notifications
    WHERE title = 'Welcome to Technician Portal!'
      AND message LIKE '%' || v_tech.technician_id || '%'
  ) THEN
    INSERT INTO public.notifications (lco_id, customer_id, title, message, type)
    VALUES (
      v_tech.lco_id,
      NULL,
      'Welcome to Technician Portal!',
      'Your technician account (' || v_tech.technician_id || ') has been activated. You can now view and manage your assigned service requests.',
      'SUCCESS'
    );
  END IF;

  -- Write Audit Log (Internal call within owner-privileged transaction)
  PERFORM public.write_audit_log(
    p_action => 'TECHNICIAN_ACCOUNT_ACTIVATED',
    p_category => 'TECHNICIAN',
    p_severity => 'INFO',
    p_entity_type => 'technicians',
    p_entity_id => v_tech.technician_id,
    p_description => 'Technician account activated for ' || v_tech.full_name || ' (' || v_tech.technician_id || ')',
    p_metadata => jsonb_build_object(
      'technician_id', v_tech.technician_id,
      'full_name', v_tech.full_name,
      'email', v_tech.email
    ),
    p_lco_id => v_tech.lco_id
  );

  RETURN jsonb_build_object(
    'success', true,
    'technician_id', v_tech.technician_id,
    'full_name', v_tech.full_name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.link_technician_account(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_technician_account(TEXT, TEXT) TO authenticated;


-- ── SA-03: review_lco_application (phase13c canonical + document gate) ──

CREATE OR REPLACE FUNCTION public.review_lco_application(
  p_application_id UUID,
  p_decision TEXT,
  p_review_notes TEXT DEFAULT NULL,
  p_rejection_reason TEXT DEFAULT NULL
)
RETURNS TABLE (id UUID, application_id TEXT, status TEXT, user_id UUID, email TEXT, business_name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  app_row public.lco_applications%ROWTYPE;
  normalized_decision TEXT := upper(trim(p_decision));
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only a Super Admin can review LCO applications';
  END IF;

  IF normalized_decision NOT IN ('APPROVED', 'REJECTED') THEN
    RAISE EXCEPTION 'Decision must be APPROVED or REJECTED';
  END IF;

  IF normalized_decision = 'REJECTED' AND coalesce(trim(p_rejection_reason), '') = '' THEN
    RAISE EXCEPTION 'A rejection reason is required';
  END IF;

  SELECT * INTO app_row FROM public.lco_applications
  WHERE lco_applications.id = p_application_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Application not found'; END IF;

  IF app_row.status NOT IN ('PENDING', 'UNDER_REVIEW') THEN
    RAISE EXCEPTION 'Only pending applications can be reviewed';
  END IF;

  -- phase15 (SA-03): approval requires the mandatory documents VERIFIED
  -- (business_proof + identity_proof, the pair the registration wizard
  -- requires). Mirrors the gate in the Super Admin UI.
  IF normalized_decision = 'APPROVED' THEN
    IF EXISTS (
      SELECT 1
      FROM (VALUES ('business_proof'), ('identity_proof')) AS req(document_type)
      WHERE NOT EXISTS (
        SELECT 1 FROM public.verification_documents d
        WHERE d.application_id = p_application_id
          AND d.document_type = req.document_type
          AND d.status = 'VERIFIED'
      )
    ) THEN
      RAISE EXCEPTION 'Required documents are not verified: Business Proof and Identity Proof must both be VERIFIED before approval';
    END IF;
  END IF;

  UPDATE public.lco_applications SET
    status = normalized_decision,
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    review_notes = NULLIF(trim(p_review_notes), ''),
    rejection_reason = CASE WHEN normalized_decision = 'REJECTED' THEN NULLIF(trim(p_rejection_reason), '') END,
    notification_status = 'PENDING'
  WHERE lco_applications.id = p_application_id;

  IF app_row.user_id IS NOT NULL THEN
    UPDATE public.profiles SET
      role = 'LCO_ADMIN',
      status = CASE WHEN normalized_decision = 'APPROVED' THEN 'ACTIVE' ELSE 'REJECTED' END
    WHERE profiles.id = app_row.user_id;

    IF NOT FOUND THEN RAISE EXCEPTION 'Linked profile not found'; END IF;
  END IF;

  INSERT INTO public.application_reviews
    (application_id, reviewer_id, decision, rejection_reason, notes)
  VALUES (
    p_application_id, auth.uid(), normalized_decision,
    CASE WHEN normalized_decision = 'REJECTED' THEN NULLIF(trim(p_rejection_reason), '') END,
    NULLIF(trim(p_review_notes), '')
  );

  -- Write Audit Log (Internal call within owner-privileged transaction)
  PERFORM public.write_audit_log(
    p_action => CASE WHEN normalized_decision = 'APPROVED' THEN 'GOVERNANCE_LCO_APPROVED' ELSE 'GOVERNANCE_LCO_REJECTED' END,
    p_category => 'GOVERNANCE',
    p_severity => CASE WHEN normalized_decision = 'APPROVED' THEN 'INFO' ELSE 'WARNING' END,
    p_entity_type => 'lco_applications',
    p_entity_id => app_row.application_id,
    p_description => 'Super Admin ' || CASE WHEN normalized_decision = 'APPROVED' THEN 'approved' ELSE 'rejected' END || ' LCO application ' || app_row.application_id || ' (' || app_row.business_name || ')',
    p_metadata => jsonb_build_object(
      'application_id', app_row.application_id,
      'business_name', app_row.business_name,
      'decision', normalized_decision,
      'rejection_reason', p_rejection_reason,
      'review_notes', p_review_notes
    ),
    p_lco_id => app_row.id
  );

  RETURN QUERY SELECT a.id, a.application_id, a.status, a.user_id, a.email, a.business_name
    FROM public.lco_applications a WHERE a.id = p_application_id;
END;
$$;

REVOKE ALL ON FUNCTION public.review_lco_application(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_lco_application(UUID, TEXT, TEXT, TEXT) TO authenticated;


-- ── CT-C1: customer INSERT policy on notifications (from remediation; missing live) ──

DROP POLICY IF EXISTS "Customer can insert plan request notifications" ON public.notifications;
CREATE POLICY "Customer can insert plan request notifications"
  ON public.notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (
    customer_id = public.get_customer_id()
    AND lco_id = public.get_customer_lco_id()
    AND type IN ('INFO', 'WARNING', 'SUCCESS', 'SYSTEM')
  );


-- ══════════════════════════════════════════════
-- LCO-M1. Atomic Record Payment (replaces the client's two-write flow:
-- payment INSERT + bill UPDATE in one transaction, so a partial failure
-- can no longer strand a payment or invite a double-recording retry)
-- ══════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.record_customer_payment(
  p_bill_id UUID,
  p_amount NUMERIC,
  p_payment_method TEXT,
  p_payment_date TIMESTAMPTZ DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_transaction_reference TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lco_id UUID := public.get_lco_id();
  v_bill public.customer_bills%ROWTYPE;
  v_payment_number TEXT;
  v_new_paid NUMERIC;
  v_new_status TEXT;
BEGIN
  IF auth.uid() IS NULL OR v_lco_id IS NULL THEN
    RAISE EXCEPTION 'Only an approved LCO can record payments';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero';
  END IF;

  SELECT * INTO v_bill
  FROM public.customer_bills
  WHERE id = p_bill_id AND lco_id = v_lco_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill not found';
  END IF;

  IF v_bill.status = 'PAID' THEN
    RAISE EXCEPTION 'Bill is already fully paid';
  END IF;

  IF v_bill.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'Cannot record a payment against a cancelled bill';
  END IF;

  IF p_amount > (v_bill.amount - COALESCE(v_bill.paid_amount, 0)) + 0.001 THEN
    RAISE EXCEPTION 'Payment amount cannot exceed the outstanding balance';
  END IF;

  v_payment_number := public.generate_payment_number();

  INSERT INTO public.customer_payments (
    payment_number, lco_id, customer_id, bill_id, amount, payment_method,
    payment_date, transaction_reference, notes, recorded_by, gateway
  ) VALUES (
    v_payment_number, v_lco_id, v_bill.customer_id, v_bill.id, p_amount,
    p_payment_method, COALESCE(p_payment_date, now()),
    COALESCE(NULLIF(trim(p_transaction_reference), ''),
             'MANUAL_' || (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT::TEXT),
    p_notes, auth.uid(), NULL
  );

  v_new_paid := LEAST(COALESCE(v_bill.paid_amount, 0) + p_amount, v_bill.amount);
  v_new_status := CASE
    WHEN v_new_paid >= v_bill.amount THEN 'PAID'
    WHEN v_bill.due_date < CURRENT_DATE THEN 'OVERDUE'
    ELSE 'PENDING'
  END;

  UPDATE public.customer_bills
  SET paid_amount = v_new_paid, status = v_new_status, updated_at = now()
  WHERE id = v_bill.id;

  RETURN jsonb_build_object(
    'ok', true,
    'payment_number', v_payment_number,
    'bill_status', v_new_status,
    'paid_amount', v_new_paid
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_customer_payment(UUID, NUMERIC, TEXT, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_customer_payment(UUID, NUMERIC, TEXT, TIMESTAMPTZ, TEXT, TEXT) TO authenticated;


-- ══════════════════════════════════════════════
-- PUB-M6. Duplicate-application pre-check for the public registration
-- wizard: returns the existing PENDING / UNDER_REVIEW application (if
-- any) for the same email or phone, so the wizard can point the
-- applicant at the status page instead of filing a duplicate.
-- ══════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.check_pending_application(
  p_email TEXT,
  p_phone TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app public.lco_applications%ROWTYPE;
BEGIN
  IF coalesce(trim(p_email), '') = '' AND coalesce(trim(p_phone), '') = '' THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT * INTO v_app
  FROM public.lco_applications
  WHERE status IN ('PENDING', 'UNDER_REVIEW')
    AND (
      lower(email) = lower(trim(p_email))
      OR (p_phone IS NOT NULL AND trim(p_phone) <> '' AND phone = trim(p_phone))
    )
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'application_id', v_app.application_id,
    'status', v_app.status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.check_pending_application(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_pending_application(TEXT, TEXT) TO anon, authenticated;
