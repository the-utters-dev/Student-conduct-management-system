-- SCDMS: Bootstrap Platform Administrator
-- Run this AFTER signing up with your email address in the app.
-- This script gives you system_admin role and links you to the default school.
-- Idempotent (safe to run multiple times).

-- ============================================================================
-- CONFIGURATION: Replace this email with YOUR email address
-- ============================================================================

DO $$
DECLARE
  admin_email text := 'abayikunda8@gmail.com';  -- ← CHANGE THIS TO YOUR EMAIL
  admin_user_id uuid;
  default_school_id uuid := '00000000-0000-0000-0000-000000000001';
BEGIN
  -- Find the user by email in auth.users
  SELECT id INTO admin_user_id
  FROM auth.users
  WHERE email = admin_email;

  -- Exit if user not found
  IF admin_user_id IS NULL THEN
    RAISE EXCEPTION 'User with email "%" not found. Sign up first, then run this script.', admin_email;
  END IF;

  RAISE NOTICE 'Found user: % (ID: %)', admin_email, admin_user_id;

  -- Assign system_admin role (idempotent)
  INSERT INTO public.user_roles (user_id, role)
  VALUES (admin_user_id, 'system_admin')
  ON CONFLICT (user_id, role) DO NOTHING;

  RAISE NOTICE 'Assigned system_admin role';

  -- Link to default school (Northfield Academy)
  UPDATE public.profiles
  SET school_id = default_school_id
  WHERE id = admin_user_id;

  RAISE NOTICE 'Linked to default school (ID: %)', default_school_id;

  RAISE NOTICE '✓ Bootstrap complete! % is now a platform administrator.', admin_email;
END $$;
