-- ============================================
-- LCO CONNECT — Fix: Profiles Table
-- Run this in the Supabase SQL Editor
-- ============================================
-- This script fixes the "Account setup incomplete"
-- error caused by missing profile rows for existing
-- auth.users accounts.
--
-- Root cause: The auto-create trigger was set up
-- AFTER some auth users were already created,
-- so those users never got a profiles row.
-- ============================================


-- ══════════════════════════════════════════════
-- 1. BACKFILL PROFILES FOR ALL EXISTING USERS
-- ══════════════════════════════════════════════
-- Creates profile rows for any auth.users that
-- don't already have one. Default role is 'USER'.
-- Uses ON CONFLICT to safely skip existing rows.

INSERT INTO public.profiles (id, email, role)
SELECT id, email, 'USER'
FROM auth.users
WHERE id NOT IN (SELECT id FROM public.profiles)
ON CONFLICT (id) DO NOTHING;


-- ══════════════════════════════════════════════
-- 2. PROMOTE SUPER ADMIN
-- ══════════════════════════════════════════════
-- Replace 'your-admin@email.com' below with
-- the actual Super Admin email address, then
-- uncomment and run.
--
-- UPDATE public.profiles
-- SET role = 'SUPER_ADMIN'
-- WHERE email = 'your-admin@email.com';


-- ══════════════════════════════════════════════
-- 3. VERIFY THE FIX
-- ══════════════════════════════════════════════
-- Run this query to confirm profiles exist and
-- the Super Admin role is set correctly:

SELECT p.id, p.email, p.role, p.created_at
FROM public.profiles p
ORDER BY p.created_at;


-- ══════════════════════════════════════════════
-- 4. RE-CREATE TRIGGER (idempotent safety)
-- ══════════════════════════════════════════════
-- Ensures the trigger exists for future signups.

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

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();


-- ══════════════════════════════════════════════
-- 5. VERIFY RLS POLICIES EXIST
-- ══════════════════════════════════════════════
-- These should already exist from super-admin.sql.
-- Re-creating with IF NOT EXISTS equivalent via
-- DO block to avoid errors if already present.

DO $$
BEGIN
  -- Check if the self-read policy exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'profiles'
      AND policyname = 'Users can read own profile'
  ) THEN
    CREATE POLICY "Users can read own profile"
      ON public.profiles
      FOR SELECT
      TO authenticated
      USING (id = auth.uid());
  END IF;

  -- Check if the self-insert policy exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'profiles'
      AND policyname = 'System insert on profiles'
  ) THEN
    CREATE POLICY "System insert on profiles"
      ON public.profiles
      FOR INSERT
      TO authenticated
      WITH CHECK (id = auth.uid());
  END IF;
END$$;


-- ══════════════════════════════════════════════
-- DONE
-- ══════════════════════════════════════════════
-- After running this script:
-- 1. Verify the SELECT query in step 3 shows
--    all your users with correct roles.
-- 2. Run the UPDATE in step 2 (uncommented)
--    to promote your Super Admin account.
-- 3. Test login through /pages/login.html.
-- ══════════════════════════════════════════════
