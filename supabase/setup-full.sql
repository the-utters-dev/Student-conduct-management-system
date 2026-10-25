-- SCDMS: Complete Database Setup (idempotent)
-- This file contains all helper functions and core schema definitions
-- Safe to run multiple times. Run this before any phase/feature-specific scripts.

-- =============================================================================
-- HELPER FUNCTIONS (must be defined before use in RLS policies)
-- =============================================================================

-- Get current user's school_id
CREATE OR REPLACE FUNCTION public.current_school_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT school_id FROM public.profiles WHERE id = auth.uid();
$$;

COMMENT ON FUNCTION public.current_school_id IS 'Get the school_id of the current authenticated user';

-- Check if user is a platform admin
CREATE OR REPLACE FUNCTION public.is_platform_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role = 'system_admin'
  );
$$;

COMMENT ON FUNCTION public.is_platform_admin IS 'Check if a user is a platform administrator';

-- Check if school is active
CREATE OR REPLACE FUNCTION public.school_is_active(_school_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.schools
    WHERE id = _school_id
      AND status = 'active'
  );
$$;

COMMENT ON FUNCTION public.school_is_active IS 'Check if a school is currently active';

-- Check if user has a specific role
CREATE OR REPLACE FUNCTION public.has_school_role(_user_id uuid, _role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role::text = _role
  );
$$;

COMMENT ON FUNCTION public.has_school_role IS 'Check if a user has a specific role';

-- Check if user is a school director
CREATE OR REPLACE FUNCTION public.is_school_director(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('school_director', 'school_leader')  -- legacy for safety
  );
$$;

COMMENT ON FUNCTION public.is_school_director IS 'Check if a user is a school director';

-- Check if user is discipline staff
CREATE OR REPLACE FUNCTION public.is_discipline_staff(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('master_of_discipline', 'matron', 'patron', 'school_director', 'system_admin',
                   'discipline_admin')  -- legacy for safety
  );
$$;

COMMENT ON FUNCTION public.is_discipline_staff IS 'Check if a user is discipline staff';

-- Check if user has a specific permission
CREATE OR REPLACE FUNCTION public.has_permission(_user_id uuid, _permission_key text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_school_id uuid;
  user_role text;
  school_permissions jsonb;
  role_permissions jsonb;
BEGIN
  -- Platform admin and school director always have all permissions
  IF public.is_platform_admin(_user_id) OR public.is_school_director(_user_id) THEN
    RETURN true;
  END IF;

  -- Get user's school
  SELECT school_id INTO user_school_id FROM public.profiles WHERE id = _user_id;
  IF user_school_id IS NULL THEN
    RETURN false;
  END IF;

  -- Get user's primary discipline role (matron, patron, master_of_discipline)
  SELECT role::text INTO user_role
  FROM public.user_roles
  WHERE user_id = _user_id
    AND role IN ('master_of_discipline', 'matron', 'patron')
  LIMIT 1;

  IF user_role IS NULL THEN
    RETURN false;
  END IF;

  -- Get school's permissions
  SELECT permissions INTO school_permissions
  FROM public.school_settings
  WHERE school_id = user_school_id;

  IF school_permissions IS NULL THEN
    -- No permissions configured, use defaults
    RETURN CASE user_role
      WHEN 'master_of_discipline' THEN _permission_key IN ('delete_students', 'manage_offences', 'view_audit_logs', 'view_reports', 'message_parents', 'send_photos', 'manage_terms', 'school_wide_entries')
      WHEN 'matron' THEN _permission_key IN ('view_reports', 'message_parents', 'send_photos')
      WHEN 'patron' THEN _permission_key IN ('view_reports', 'message_parents', 'send_photos')
      ELSE false
    END;
  END IF;

  -- Get role-specific permissions
  role_permissions := school_permissions -> user_role;
  IF role_permissions IS NULL THEN
    RETURN false;
  END IF;

  -- Check the specific permission
  RETURN COALESCE((role_permissions ->> _permission_key)::boolean, false);
END;
$$;

COMMENT ON FUNCTION public.has_permission IS 'Check if a user has a specific permission based on their role and school settings';

-- Automatically update updated_at timestamp on row updates
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.set_updated_at IS 'Automatically update updated_at timestamp on row updates';

-- Generic audit_log trigger function
CREATE OR REPLACE FUNCTION public.audit_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  school_id_val uuid;
  action_val text;
  details_val jsonb;
BEGIN
  -- Determine school_id from NEW or OLD record
  IF TG_OP = 'DELETE' THEN
    school_id_val := OLD.school_id;
  ELSE
    school_id_val := NEW.school_id;
  END IF;

  -- Determine action
  action_val := lower(TG_OP) || '_' || TG_TABLE_NAME;

  -- Build details JSON
  IF TG_OP = 'DELETE' THEN
    details_val := jsonb_build_object(
      'operation', TG_OP,
      'table', TG_TABLE_NAME,
      'old', to_jsonb(OLD)
    );
  ELSIF TG_OP = 'UPDATE' THEN
    details_val := jsonb_build_object(
      'operation', TG_OP,
      'table', TG_TABLE_NAME,
      'old', to_jsonb(OLD),
      'new', to_jsonb(NEW)
    );
  ELSE -- INSERT
    details_val := jsonb_build_object(
      'operation', TG_OP,
      'table', TG_TABLE_NAME,
      'new', to_jsonb(NEW)
    );
  END IF;

  -- Insert audit log
  INSERT INTO public.audit_logs (school_id, user_id, action, details)
  VALUES (school_id_val, auth.uid(), action_val, details_val);

  -- Return appropriate record
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.audit_log IS 'Generic trigger function for audit logging';

-- =============================================================================
-- GRANT PERMISSIONS ON HELPER FUNCTIONS
-- =============================================================================

REVOKE EXECUTE ON FUNCTION public.current_school_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_platform_admin(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.school_is_active(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_school_role(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_school_director(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_discipline_staff(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_permission(uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.current_school_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_platform_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.school_is_active(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_school_role(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_school_director(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_discipline_staff(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_permission(uuid, text) TO authenticated, service_role;

-- =============================================================================
-- Summary
-- =============================================================================
-- This script defines all core helper functions used throughout the database:
-- 1. current_school_id() - Get current user's school
-- 2. is_platform_admin() - Check if user is system_admin
-- 3. school_is_active() - Check if school status is active
-- 4. has_school_role() - Check if user has a specific role
-- 5. is_school_director() - Check if user is school director
-- 6. is_discipline_staff() - Check if user is discipline staff
-- 7. has_permission() - Check user permissions based on school settings
-- 8. audit_log() - Generic audit logging trigger function
--
-- All functions are idempotent and safe to run multiple times.
