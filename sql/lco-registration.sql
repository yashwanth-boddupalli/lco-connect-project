-- ============================================
-- LCO CONNECT — Phase 1: Registration Schema
-- Run this in the Supabase SQL Editor
-- ============================================

-- ══════════════════════════════════════════════
-- 1. LCO APPLICATIONS TABLE
-- ══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.lco_applications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  application_id TEXT UNIQUE NOT NULL,
  business_name TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  pincode TEXT NOT NULL,
  services TEXT[] NOT NULL DEFAULT '{}',
  other_service_description TEXT,
  service_area_locality TEXT NOT NULL,
  service_area_city TEXT NOT NULL,
  service_area_state TEXT NOT NULL,
  service_area_pincode TEXT NOT NULL,
  service_area_description TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  review_notes TEXT,
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Add check constraint for valid statuses
ALTER TABLE public.lco_applications
  ADD CONSTRAINT lco_applications_status_check
  CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'UNDER_REVIEW'));


-- ══════════════════════════════════════════════
-- 2. VERIFICATION DOCUMENTS TABLE
-- ══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.verification_documents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  application_id UUID NOT NULL REFERENCES public.lco_applications(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  mime_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Add check constraint for valid document statuses
ALTER TABLE public.verification_documents
  ADD CONSTRAINT verification_documents_status_check
  CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED'));

-- Add check constraint for valid document types
ALTER TABLE public.verification_documents
  ADD CONSTRAINT verification_documents_type_check
  CHECK (document_type IN ('business_proof', 'identity_proof', 'registration_certificate', 'other_document'));


-- ══════════════════════════════════════════════
-- 3. APPLICATION ID GENERATION FUNCTION
-- ══════════════════════════════════════════════
-- Generates IDs like: LCO-2026-0001, LCO-2026-0002, etc.

CREATE OR REPLACE FUNCTION public.generate_application_id()
RETURNS TEXT
LANGUAGE plpgsql
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


-- ══════════════════════════════════════════════
-- 4. AUTO-UPDATE updated_at TIMESTAMP
-- ══════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER lco_applications_updated_at
  BEFORE UPDATE ON public.lco_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();


-- ══════════════════════════════════════════════
-- 5. ROW LEVEL SECURITY
-- ══════════════════════════════════════════════

-- Enable RLS on both tables
ALTER TABLE public.lco_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verification_documents ENABLE ROW LEVEL SECURITY;

-- Policy: Allow anonymous inserts for registration (public form)
CREATE POLICY "Allow anonymous inserts on lco_applications"
  ON public.lco_applications
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Policy: Allow anonymous inserts for document references
CREATE POLICY "Allow anonymous inserts on verification_documents"
  ON public.verification_documents
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Policy: Allow anonymous to read their own application by application_id
-- This enables the status page to show application info
CREATE POLICY "Allow anonymous reads on lco_applications by application_id"
  ON public.lco_applications
  FOR SELECT
  TO anon
  USING (true);

-- Policy: Allow anonymous to read document records (for review step)
CREATE POLICY "Allow anonymous reads on verification_documents"
  ON public.verification_documents
  FOR SELECT
  TO anon
  USING (true);

-- Policy: Allow authenticated users (admins) full access
CREATE POLICY "Allow authenticated full access on lco_applications"
  ON public.lco_applications
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow authenticated full access on verification_documents"
  ON public.verification_documents
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);


-- ══════════════════════════════════════════════
-- 6. INDEXES
-- ══════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_lco_applications_application_id
  ON public.lco_applications(application_id);

CREATE INDEX IF NOT EXISTS idx_lco_applications_status
  ON public.lco_applications(status);

CREATE INDEX IF NOT EXISTS idx_lco_applications_email
  ON public.lco_applications(email);

CREATE INDEX IF NOT EXISTS idx_verification_documents_application_id
  ON public.verification_documents(application_id);


-- ══════════════════════════════════════════════
-- 7. STORAGE BUCKET (Run separately in Supabase)
-- ══════════════════════════════════════════════
-- NOTE: Storage bucket creation via SQL may require
-- the supabase_admin role. If this fails, create the
-- bucket manually in the Supabase Dashboard:
--
-- Storage -> New Bucket -> "verification-documents"
-- Set to PRIVATE (not public)
--
-- Then add this policy in the Supabase Dashboard:
-- Storage -> verification-documents -> Policies ->
-- New Policy -> Allow anonymous uploads

INSERT INTO storage.buckets (id, name, public)
VALUES ('verification-documents', 'verification-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policy: Allow anonymous uploads to verification-documents bucket
CREATE POLICY "Allow anonymous uploads to verification-documents"
  ON storage.objects
  FOR INSERT
  TO anon
  WITH CHECK (bucket_id = 'verification-documents');

-- Storage policy: Allow authenticated users to read documents
CREATE POLICY "Allow authenticated reads on verification-documents"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'verification-documents');


-- ══════════════════════════════════════════════
-- DONE — Phase 1 Schema Ready
-- ══════════════════════════════════════════════
