-- LCO CONNECT — Phase 3 finalisation
-- Run this file once in the Supabase SQL Editor, after the Phase 1 and 2 SQL.
-- It replaces the earlier broad registration policies with least-privilege policies.

-- 1. Schema ---------------------------------------------------------------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_status_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_status_check
  CHECK (status IN ('ACTIVE', 'PENDING', 'REJECTED', 'SUSPENDED'));
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('USER', 'SUPER_ADMIN', 'LCO_ADMIN', 'CUSTOMER', 'TECHNICIAN'));

ALTER TABLE public.lco_applications ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);
ALTER TABLE public.lco_applications ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE public.lco_applications ADD COLUMN IF NOT EXISTS notification_status TEXT NOT NULL DEFAULT 'NONE';
CREATE INDEX IF NOT EXISTS idx_lco_applications_user_id ON public.lco_applications(user_id);

CREATE TABLE IF NOT EXISTS public.application_reviews (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  application_id UUID NOT NULL REFERENCES public.lco_applications(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL REFERENCES auth.users(id),
  decision TEXT NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED', 'UNDER_REVIEW')),
  rejection_reason TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_application_reviews_app_id ON public.application_reviews(application_id);
ALTER TABLE public.verification_documents ADD COLUMN IF NOT EXISTS review_notes TEXT;
UPDATE public.profiles SET status = 'ACTIVE' WHERE status IS NULL OR status = '';

-- 2. Trusted helpers and profile creation --------------------------------
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'SUPER_ADMIN');
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  requested_role TEXT := COALESCE(NEW.raw_user_meta_data->>'role', 'USER');
  profile_role TEXT;
BEGIN
  -- Metadata may create an LCO applicant, but can never create an admin.
  profile_role := CASE
    WHEN requested_role = 'LCO_ADMIN' THEN 'LCO_ADMIN'
    WHEN requested_role IN ('CUSTOMER', 'TECHNICIAN') THEN requested_role
    ELSE 'USER'
  END;
  -- LCO applicants are always pending, irrespective of client metadata.
  INSERT INTO public.profiles (id, email, role, status)
  VALUES (NEW.id, NEW.email, profile_role,
    CASE WHEN profile_role = 'LCO_ADMIN' THEN 'PENDING' ELSE 'ACTIVE' END)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3. Atomic approval / rejection -----------------------------------------
CREATE OR REPLACE FUNCTION public.review_lco_application(
  p_application_id UUID, p_decision TEXT, p_review_notes TEXT DEFAULT NULL,
  p_rejection_reason TEXT DEFAULT NULL
)
RETURNS TABLE (id UUID, application_id TEXT, status TEXT, user_id UUID, email TEXT, business_name TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

  UPDATE public.lco_applications SET
    status = normalized_decision, reviewed_by = auth.uid(), reviewed_at = now(),
    review_notes = NULLIF(trim(p_review_notes), ''),
    rejection_reason = CASE WHEN normalized_decision = 'REJECTED' THEN NULLIF(trim(p_rejection_reason), '') END,
    notification_status = 'PENDING'
  WHERE lco_applications.id = p_application_id;

  -- Legacy applications can lack a linked Auth user. New registrations always
  -- have user_id and their profile is synchronized in this same transaction.
  IF app_row.user_id IS NOT NULL THEN
    UPDATE public.profiles SET role = 'LCO_ADMIN',
      status = CASE WHEN normalized_decision = 'APPROVED' THEN 'ACTIVE' ELSE 'REJECTED' END
    WHERE profiles.id = app_row.user_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Linked profile not found'; END IF;
  END IF;

  INSERT INTO public.application_reviews
    (application_id, reviewer_id, decision, rejection_reason, notes)
  VALUES (p_application_id, auth.uid(), normalized_decision,
    CASE WHEN normalized_decision = 'REJECTED' THEN NULLIF(trim(p_rejection_reason), '') END,
    NULLIF(trim(p_review_notes), ''));

  RETURN QUERY SELECT a.id, a.application_id, a.status, a.user_id, a.email, a.business_name
    FROM public.lco_applications a WHERE a.id = p_application_id;
END;
$$;
REVOKE ALL ON FUNCTION public.review_lco_application(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_lco_application(UUID, TEXT, TEXT, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.is_super_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;

-- 4. Row-level security ---------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lco_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verification_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.application_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins can read all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Super admins can update all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "System insert on profiles" ON public.profiles;
DROP POLICY IF EXISTS "Allow anonymous inserts on lco_applications" ON public.lco_applications;
DROP POLICY IF EXISTS "Allow anonymous reads on lco_applications by application_id" ON public.lco_applications;
DROP POLICY IF EXISTS "Allow authenticated full access on lco_applications" ON public.lco_applications;
DROP POLICY IF EXISTS "Allow authenticated inserts on lco_applications" ON public.lco_applications;
DROP POLICY IF EXISTS "Allow anonymous inserts on verification_documents" ON public.verification_documents;
DROP POLICY IF EXISTS "Allow anonymous reads on verification_documents" ON public.verification_documents;
DROP POLICY IF EXISTS "Allow authenticated full access on verification_documents" ON public.verification_documents;
DROP POLICY IF EXISTS "Allow authenticated inserts on verification_documents" ON public.verification_documents;
DROP POLICY IF EXISTS "Super admins can manage reviews" ON public.application_reviews;

CREATE POLICY "Users can read own profile" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "Super admins can read all profiles" ON public.profiles FOR SELECT TO authenticated USING (public.is_super_admin());
CREATE POLICY "Users can read own applications" ON public.lco_applications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Super admins can read all applications" ON public.lco_applications FOR SELECT TO authenticated USING (public.is_super_admin());
CREATE POLICY "Users can create own pending application" ON public.lco_applications FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND status = 'PENDING');
CREATE POLICY "Users can read own verification documents" ON public.verification_documents FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.lco_applications a WHERE a.id = application_id AND a.user_id = auth.uid()));
CREATE POLICY "Super admins can manage verification documents" ON public.verification_documents FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
CREATE POLICY "Users can add documents to own application" ON public.verification_documents FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.lco_applications a WHERE a.id = application_id AND a.user_id = auth.uid()));
CREATE POLICY "Super admins can read reviews" ON public.application_reviews FOR SELECT TO authenticated USING (public.is_super_admin());

-- 5. Private Storage ------------------------------------------------------
INSERT INTO storage.buckets (id, name, public) VALUES ('verification-documents', 'verification-documents', false)
ON CONFLICT (id) DO UPDATE SET public = false;
DROP POLICY IF EXISTS "Allow anonymous uploads to verification-documents" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated uploads to verification-documents" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated reads on verification-documents" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload verification documents" ON storage.objects;
DROP POLICY IF EXISTS "Super admins can view verification documents" ON storage.objects;
CREATE POLICY "Users upload only to own verification folder" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'verification-documents' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Users read only own verification folder" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'verification-documents' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Super admins read verification documents" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'verification-documents' AND public.is_super_admin());
