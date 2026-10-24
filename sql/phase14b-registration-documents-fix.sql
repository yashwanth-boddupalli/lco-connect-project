-- ══════════════════════════════════════════════════════════════
-- Phase 14B — Registration document upload fix (24 Oct 2026)
--
-- Root cause found live: phase14 sections 3–5 never fully landed.
--   * The helper functions application_is_pending /
--     application_is_pending_uuid did not exist.
--   * The storage.objects policy for anonymous uploads to the
--     verification-documents bucket did not exist at all, so every
--     applicant document upload failed with a row-level security
--     error AFTER the application row had been inserted — leaving
--     a PENDING application with zero documents on every attempt
--     (and one duplicate per retry in the Super Admin queue).
--   * The live anonymous INSERT policies on lco_applications /
--     verification_documents were permissive stubs (WITH CHECK true)
--     instead of the strict phase14 checks.
--
-- This file applies phase14 sections 3–5 exactly as designed, and
-- adds withdraw_application() so the wizard can remove a failed
-- submission (row + document rows + stored files) instead of
-- leaving it behind.
-- ══════════════════════════════════════════════════════════════


-- ── A. Pending-application helpers (phase14 section 3) ──

CREATE OR REPLACE FUNCTION public.application_is_pending(p_application_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.lco_applications
    WHERE upper(application_id) = upper(trim(p_application_id))
      AND status = 'PENDING'
      AND user_id IS NULL
  );
$$;

REVOKE ALL ON FUNCTION public.application_is_pending(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.application_is_pending(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.application_is_pending_uuid(p_application_uuid UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.lco_applications
    WHERE id = p_application_uuid
      AND status = 'PENDING'
      AND user_id IS NULL
  );
$$;

REVOKE ALL ON FUNCTION public.application_is_pending_uuid(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.application_is_pending_uuid(UUID) TO anon, authenticated;


-- ── B. Strict anonymous INSERT policies (phase14 section 4) ──

DROP POLICY IF EXISTS "Allow anonymous inserts on lco_applications" ON public.lco_applications;
CREATE POLICY "Allow anonymous inserts on lco_applications"
  ON public.lco_applications
  FOR INSERT TO anon
  WITH CHECK (
    status = 'PENDING'
    AND user_id IS NULL
    AND reviewed_by IS NULL
    AND reviewed_at IS NULL
    AND review_notes IS NULL
    AND rejection_reason IS NULL
  );

DROP POLICY IF EXISTS "Allow anonymous inserts on verification_documents" ON public.verification_documents;
CREATE POLICY "Allow anonymous inserts on verification_documents"
  ON public.verification_documents
  FOR INSERT TO anon
  WITH CHECK (
    public.application_is_pending_uuid(application_id)
    AND status = 'PENDING'
    AND reviewed_by IS NULL
    AND reviewed_at IS NULL
    AND review_notes IS NULL
  );


-- ── C. Anonymous storage uploads (phase14 section 5) ──

DROP POLICY IF EXISTS "Anonymous application uploads to verification-documents" ON storage.objects;
CREATE POLICY "Anonymous application uploads to verification-documents"
  ON storage.objects
  FOR INSERT TO anon
  WITH CHECK (
    bucket_id = 'verification-documents'
    AND (storage.foldername(name))[1] = 'applications'
    AND public.application_is_pending((storage.foldername(name))[2])
  );


-- ── D. Withdraw a failed submission ──
-- Called by the registration wizard when anything fails after the
-- application row was created. Removes the document rows and the
-- application row, but ONLY for an application that is still
-- PENDING and not yet linked to an account — anything already
-- reviewed or activated can never be withdrawn this way.
-- Note: Supabase blocks direct SQL deletes on storage.objects
-- ("Use the Storage API instead"), so the uploaded file bytes of a
-- withdrawn application stay in the bucket as invisible orphans —
-- no document row points at them, so they never surface anywhere.

CREATE OR REPLACE FUNCTION public.withdraw_application(p_application_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uuid UUID;
  v_application_id TEXT;
BEGIN
  SELECT id, application_id INTO v_uuid, v_application_id
  FROM public.lco_applications
  WHERE upper(application_id) = upper(trim(p_application_id))
    AND status = 'PENDING'
    AND user_id IS NULL;

  IF v_uuid IS NULL THEN
    RETURN FALSE;
  END IF;

  DELETE FROM public.verification_documents
  WHERE application_id = v_uuid;

  DELETE FROM public.lco_applications
  WHERE id = v_uuid;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.withdraw_application(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.withdraw_application(TEXT) TO anon, authenticated;


-- ── E. Public status lookup (phase14 section 6) ──
-- Also never applied live: get_application_status did not exist at
-- all, so pages/application-status.html showed "No Application
-- Found" for EVERY valid application ID (found live 24 Oct 2026
-- with a real submission, LCO-2026-0013).

CREATE OR REPLACE FUNCTION public.get_application_status(p_application_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_application_id TEXT;
  v_business_name TEXT;
  v_status TEXT;
  v_submitted_at TIMESTAMPTZ;
  v_invitation_status TEXT;
BEGIN
  SELECT application_id, business_name, status, created_at, invitation_status
  INTO v_application_id, v_business_name, v_status, v_submitted_at, v_invitation_status
  FROM public.lco_applications
  WHERE upper(application_id) = upper(trim(p_application_id))
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'application_id', v_application_id,
    'business_name', v_business_name,
    'status', v_status,
    'submitted_at', v_submitted_at,
    'invitation_status', v_invitation_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_application_status(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_application_status(TEXT) TO anon, authenticated;


-- ── F. Invitation tracking columns (phase14 section 1) ──
-- Also never applied live: lco_applications had no invitation_status
-- column, which broke get_application_status (section E) and would
-- break the send-lco-invitation function the same way.

ALTER TABLE public.lco_applications
  ADD COLUMN IF NOT EXISTS invitation_status TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE public.lco_applications
  ADD COLUMN IF NOT EXISTS invitation_sent_at TIMESTAMPTZ;
ALTER TABLE public.lco_applications
  ADD COLUMN IF NOT EXISTS last_invitation_attempt TIMESTAMPTZ;

ALTER TABLE public.lco_applications
  DROP CONSTRAINT IF EXISTS lco_applications_invitation_status_check;
ALTER TABLE public.lco_applications
  ADD CONSTRAINT lco_applications_invitation_status_check
  CHECK (invitation_status IN ('PENDING', 'INVITED', 'ACTIVATED', 'FAILED'));


-- ── G. Activation linking (phase14 section 7) ──
-- Also missing live (link_customer_account and
-- link_technician_account exist; the LCO one did not). Called from
-- pages/activate-lco.html after the invite sets the password —
-- without it, LCO activation could never complete.

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
