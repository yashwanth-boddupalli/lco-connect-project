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
-- application row was created. Removes the stored files, the
-- document rows and the application row, but ONLY for an application
-- that is still PENDING and not yet linked to an account — anything
-- already reviewed or activated can never be withdrawn this way.

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

  DELETE FROM storage.objects
  WHERE bucket_id = 'verification-documents'
    AND name LIKE 'applications/' || v_application_id || '/%';

  DELETE FROM public.verification_documents
  WHERE application_id = v_uuid;

  DELETE FROM public.lco_applications
  WHERE id = v_uuid;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.withdraw_application(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.withdraw_application(TEXT) TO anon, authenticated;
