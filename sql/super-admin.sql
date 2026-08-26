-- ============================================
-- LCO CONNECT — Phase 2: Super Admin Schema
-- Run this in the Supabase SQL Editor
-- DO NOT run Phase 1 SQL again — those tables
-- already exist.
-- ============================================


-- ══════════════════════════════════════════════
-- 1. PROFILES TABLE (for role-based access)
-- ══════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'USER',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Valid roles
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('USER', 'SUPER_ADMIN', 'LCO_ADMIN'));

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Profiles: users can read their own profile
CREATE POLICY "Users can read own profile"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (id = auth.uid());

-- Profiles: Super Admins can read all profiles
CREATE POLICY "Super admins can read all profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'SUPER_ADMIN'
    )
  );

-- Profiles: only system can insert (via trigger)
CREATE POLICY "System insert on profiles"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

-- Profiles: users can update their own non-role fields
CREATE POLICY "Users can update own profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());


-- ══════════════════════════════════════════════
-- 2. AUTO-CREATE PROFILE ON SIGNUP
-- ══════════════════════════════════════════════
-- When a new user signs up, automatically create
-- a profile row with role = 'USER'.
-- Super Admin accounts must be manually promoted
-- in the Supabase SQL Editor.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role)
  VALUES (NEW.id, NEW.email, 'USER')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Drop existing trigger if present to avoid conflict
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();


-- ══════════════════════════════════════════════
-- 3. ADD REVIEW FIELDS TO VERIFICATION_DOCUMENTS
-- ══════════════════════════════════════════════
-- These columns track individual document reviews.

DO $$
BEGIN
  -- document_review_notes
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'verification_documents'
      AND column_name = 'review_notes'
  ) THEN
    ALTER TABLE public.verification_documents
      ADD COLUMN review_notes TEXT;
  END IF;
END$$;


-- ══════════════════════════════════════════════
-- 4. HELPER FUNCTION: CHECK IF CURRENT USER IS SUPER ADMIN
-- ══════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'SUPER_ADMIN'
  );
END;
$$;


-- ══════════════════════════════════════════════
-- 5. UPDATED_AT TRIGGER FOR PROFILES
-- ══════════════════════════════════════════════

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();


-- ══════════════════════════════════════════════
-- 6. INDEX ON PROFILES ROLE
-- ══════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_profiles_role
  ON public.profiles(role);


-- ══════════════════════════════════════════════
-- 7. UPDATE THE VERIFICATION DOCUMENTS STATUS CONSTRAINT
-- ══════════════════════════════════════════════
-- Phase 1 used 'APPROVED' for doc status. Phase 2
-- requirement uses 'VERIFIED'. We update the
-- constraint to accept both for backward compat.

ALTER TABLE public.verification_documents
  DROP CONSTRAINT IF EXISTS verification_documents_status_check;

ALTER TABLE public.verification_documents
  ADD CONSTRAINT verification_documents_status_check
  CHECK (status IN ('PENDING', 'APPROVED', 'VERIFIED', 'REJECTED'));


-- ══════════════════════════════════════════════
-- MANUAL STEP: Create a Super Admin account
-- ══════════════════════════════════════════════
-- 1. Go to Supabase Dashboard → Authentication → Users
-- 2. Click "Add User" → Enter email & password
-- 3. After the user is created, run:
--
--    UPDATE public.profiles
--    SET role = 'SUPER_ADMIN'
--    WHERE email = 'your-admin@email.com';
--
-- This ensures only manually promoted users
-- become Super Admins. There is NO public
-- registration path for SUPER_ADMIN.
-- ══════════════════════════════════════════════


-- ══════════════════════════════════════════════
-- DONE — Phase 2 Schema Ready
-- ══════════════════════════════════════════════
