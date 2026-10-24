-- ============================================
-- LCO CONNECT — Phase 14 Wave B: Registration Workflow
-- apply → approve → password-setup (activation invite)
--
-- Run AFTER all earlier migrations in the Supabase SQL Editor.
-- Idempotent: safe to re-run (IF NOT EXISTS / OR REPLACE /
-- DROP ... IF EXISTS throughout).
-- ============================================

-- ══════════════════════════════════════════════
-- 1. INVITATION TRACKING COLUMNS
-- ══════════════════════════════════════════════
-- invitation_status lifecycle:
--   PENDING   → application approved, invite not yet sent
--   INVITED   → activation email sent, awaiting password setup
--   ACTIVATED → LCO set a password via activate-lco.html
--   FAILED    → invite generation / delivery failed

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


-- ══════════════════════════════════════════════
-- 2. generate_application_id — anon-safe
-- ══════════════════════════════════════════════
-- Registration is now anonymous (no auth user at submit time),
-- so the ID generator must be callable by anon. It only returns
-- a computed next-ID string — no row data leaks — so running it
-- as SECURITY DEFINER is safe.

CREATE OR REPLACE FUNCTION public.generate_application_id()
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

  -- Count existing applications this year and get next sequence
  SELECT COALESCE(MAX(
    CAST(SPLIT_PART(application_id, '-', 3) AS INT)
  ), 0) + 1
  INTO next_seq
  FROM public.lco_applications
  WHERE application_id LIKE 'LCO-' || current_year || '-%';

  new_id := 'LCO-' || current_year || '-' || LPAD(next_seq::TEXT, 4, '0');

  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_application_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_application_id() TO anon, authenticated;


-- ══════════════════════════════════════════════
-- 3. PENDING-APPLICATION HELPERS
-- ══════════════════════════════════════════════
-- SECURITY DEFINER so RLS policies can verify "still pending and
-- unlinked" without granting anon any SELECT on the tables.

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

-- UUID variant for the verification_documents INSERT policy
-- (the documents table references lco_applications by UUID).
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


-- ══════════════════════════════════════════════
-- 4. ANONYMOUS REGISTRATION POLICIES
-- ══════════════════════════════════════════════
-- Strict WITH CHECK: anon may only create PENDING, unlinked
-- applications and PENDING document rows for them. Review-side
-- fields are forced NULL so applicants can't self-approve.

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


-- ══════════════════════════════════════════════
-- 5. ANONYMOUS STORAGE UPLOADS
-- ══════════════════════════════════════════════
-- Anonymous applicants upload to applications/<application_id>/<docType>/.
-- The policy binds the upload to a still-pending, unlinked application
-- row via application_is_pending — the path alone is NOT the boundary.

DROP POLICY IF EXISTS "Anonymous application uploads to verification-documents" ON storage.objects;
CREATE POLICY "Anonymous application uploads to verification-documents"
  ON storage.objects
  FOR INSERT TO anon
  WITH CHECK (
    bucket_id = 'verification-documents'
    AND (storage.foldername(name))[1] = 'applications'
    AND public.application_is_pending((storage.foldername(name))[2])
  );


-- ══════════════════════════════════════════════
-- 6. PUBLIC STATUS LOOKUP (no PII)
-- ══════════════════════════════════════════════
-- Powers pages/application-status.html. Returns only the fields a
-- stranger is allowed to see: never email, phone, or address.

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


-- ══════════════════════════════════════════════
-- 7. ACTIVATION LINKING
-- ══════════════════════════════════════════════
-- Called from pages/activate-lco.html AFTER the invite link created
-- the auth user and the LCO set their password. Links the auth user
-- to their APPROVED application and flips the auto-created
-- handle_new_user() profile (LCO_ADMIN / PENDING) to ACTIVE.
-- Authenticated users only; the email+application-id pair must match.

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


-- ══════════════════════════════════════════════
-- 8. review_lco_application — NO CHANGE NEEDED
-- ══════════════════════════════════════════════
-- The approval RPC only syncs profiles when app_row.user_id IS NOT
-- NULL (phase3-verification.sql). New application-first rows carry
-- NULL user_id, so approval skips the profile sync entirely and the
-- account is created later by the invite → activate flow.

-- DONE — Wave B schema ready
