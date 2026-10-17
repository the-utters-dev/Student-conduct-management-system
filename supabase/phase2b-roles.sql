-- SCDMS: Phase 2b — Role-Based Access Control for Rwandan schools.
-- Run manually in Supabase SQL editor AFTER phase2a-roles-enum.sql.
-- Idempotent (safe to run twice).
--
-- SUMMARY:
-- 1. Migrates existing users from old roles to new roles
-- 2. Updates helper functions for the new role structure
-- 3. Adds gender-based scope policies (matrons see only girls, patrons see only boys)
-- 4. Adds school_settings columns for custom role titles and permissions
-- 5. Implements permission-based access control
-- 6. Updates sign-up flow to require invitation for staff
-- 7. Adds audit logging for role and permission changes
-- 8. Makes system_admin a platform owner (no school_id required)

-- ==============================================================================
-- 1. MIGRATE EXISTING USERS TO NEW ROLES
-- ==============================================================================

-- Insert new role rows for users with old roles (preserving all data)
INSERT INTO public.user_roles (user_id, role)
SELECT user_id, 'school_director'::public.app_role
FROM public.user_roles
WHERE role = 'school_leader'
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
SELECT user_id, 'master_of_discipline'::public.app_role
FROM public.user_roles
WHERE role = 'discipline_admin'
ON CONFLICT (user_id, role) DO NOTHING;

-- Delete old role rows (keeping enum values for backwards compatibility in helpers)
DELETE FROM public.user_roles WHERE role = 'school_leader';
DELETE FROM public.user_roles WHERE role = 'discipline_admin';

-- For system_admin users, set school_id to NULL (they are platform owners, not school staff)
UPDATE public.profiles
SET school_id = NULL
WHERE id IN (SELECT user_id FROM public.user_roles WHERE role = 'system_admin');

-- For system_admin users, remove any other roles they might have
DELETE FROM public.user_roles
WHERE user_id IN (SELECT user_id FROM public.user_roles WHERE role = 'system_admin')
  AND role <> 'system_admin';


-- ==============================================================================
-- 2. UPDATE HELPER FUNCTIONS
-- ==============================================================================

-- Update current_school_id to handle NULL for platform admins
CREATE OR REPLACE FUNCTION public.current_school_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT school_id FROM public.profiles WHERE id = auth.uid();
$$;

-- is_platform_admin remains the same (already correct)
-- No changes needed

-- Update is_discipline_staff to include all discipline roles + legacy
CREATE OR REPLACE FUNCTION public.is_discipline_staff(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('master_of_discipline', 'matron', 'patron', 'school_director', 'system_admin',
                   'discipline_admin')  -- legacy for safety
  );
$$;

-- New: is_school_director
CREATE OR REPLACE FUNCTION public.is_school_director(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('school_director', 'school_leader')  -- legacy for safety
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_school_director(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_school_director(uuid) TO authenticated, service_role;

-- New: is_audit_viewer
CREATE OR REPLACE FUNCTION public.is_audit_viewer(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('school_director', 'master_of_discipline', 'system_admin')
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_audit_viewer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_audit_viewer(uuid) TO authenticated, service_role;

-- New: staff_gender_scope - returns 'Female' for matrons only, 'Male' for patrons only, NULL otherwise
CREATE OR REPLACE FUNCTION public.staff_gender_scope(_user_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    -- If user has matron role only (no other discipline roles), return 'Female'
    WHEN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'matron')
     AND NOT EXISTS (
       SELECT 1 FROM public.user_roles
       WHERE user_id = _user_id
         AND role IN ('master_of_discipline', 'patron', 'school_director', 'system_admin')
     ) THEN 'Female'
    -- If user has patron role only (no other discipline roles), return 'Male'
    WHEN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'patron')
     AND NOT EXISTS (
       SELECT 1 FROM public.user_roles
       WHERE user_id = _user_id
         AND role IN ('master_of_discipline', 'matron', 'school_director', 'system_admin')
     ) THEN 'Male'
    -- Otherwise NULL (whole school access)
    ELSE NULL
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.staff_gender_scope(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_gender_scope(uuid) TO authenticated, service_role;

-- New: can_access_student - checks if a student is visible to current user based on gender scope
-- SECURITY DEFINER so it can check the scope regardless of RLS
CREATE OR REPLACE FUNCTION public.can_access_student(_student_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  scope text;
  student_gender text;
BEGIN
  -- Platform admin can see everything
  IF public.is_platform_admin(auth.uid()) THEN
    RETURN true;
  END IF;

  -- Get caller's gender scope
  scope := public.staff_gender_scope(auth.uid());

  -- If no scope restriction (NULL), can see all students
  IF scope IS NULL THEN
    RETURN true;
  END IF;

  -- Get student's gender (use service role to bypass RLS during this check)
  SELECT gender INTO student_gender
  FROM public.students
  WHERE id = _student_id;

  -- If student has no gender or empty gender, visible to everyone (so no student is invisible)
  IF student_gender IS NULL OR student_gender = '' THEN
    RETURN true;
  END IF;

  -- Otherwise, must match scope
  RETURN student_gender = scope;
END $$;

REVOKE EXECUTE ON FUNCTION public.can_access_student(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_student(uuid) TO authenticated, service_role;


-- ==============================================================================
-- 3. ADD RESTRICTIVE GENDER SCOPE POLICIES
-- ==============================================================================

-- Students: restrict by gender scope
DROP POLICY IF EXISTS "Gender scope restriction" ON public.students;
CREATE POLICY "Gender scope restriction" ON public.students AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.staff_gender_scope(auth.uid()) IS NULL
    OR gender IS NULL
    OR gender = ''
    OR gender = public.staff_gender_scope(auth.uid())
  );

-- Conduct logs: restrict by student access
DROP POLICY IF EXISTS "Gender scope restriction" ON public.conduct_logs;
CREATE POLICY "Gender scope restriction" ON public.conduct_logs AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (public.can_access_student(student_id))
  WITH CHECK (public.can_access_student(student_id));

-- Notification logs: restrict by student access
DROP POLICY IF EXISTS "Gender scope restriction" ON public.notification_logs;
CREATE POLICY "Gender scope restriction" ON public.notification_logs AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (public.can_access_student(student_id))
  WITH CHECK (public.can_access_student(student_id));

-- Note: student_conduct_balances view has security_invoker = true,
-- so it automatically respects the RLS policies on students and conduct_logs.
-- No additional changes needed for the view.


-- ==============================================================================
-- 4. UPDATE EXISTING POLICIES TO USE NEW HELPER FUNCTIONS
-- ==============================================================================

-- Find and update policies that check for school_leader or discipline_admin

-- Update promote_students_batch function
CREATE OR REPLACE FUNCTION public.promote_students_batch(
  p_from_year text,
  p_to_year text,
  p_items jsonb
)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  it jsonb;
  n integer := 0;
  caller_school_id uuid;
  student_school_id uuid;
  is_admin boolean;
BEGIN
  -- Check role authorization: school_director or system_admin
  IF NOT (public.is_school_director(auth.uid()) OR public.is_platform_admin(auth.uid())) THEN
    RAISE EXCEPTION 'Only school directors or platform administrators can run the rollover';
  END IF;

  -- Get caller's school and admin status
  caller_school_id := public.current_school_id();
  is_admin := public.is_platform_admin(auth.uid());

  -- Reject if caller's school is not active (unless platform admin)
  IF NOT is_admin AND NOT public.school_is_active(caller_school_id) THEN
    RAISE EXCEPTION 'Cannot perform rollover: your school is not active';
  END IF;

  -- Process each student
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    -- Get the student's school_id
    SELECT school_id INTO student_school_id
    FROM public.students
    WHERE id = (it->>'student_id')::uuid;

    -- Security check: student must belong to caller's school (unless platform admin)
    IF NOT is_admin AND (student_school_id IS NULL OR student_school_id <> caller_school_id) THEN
      RAISE EXCEPTION 'Access denied: student % does not belong to your school', it->>'student_id';
    END IF;

    -- Record history
    INSERT INTO public.student_academic_history (student_id, academic_year, grade_level, class_name, status)
    SELECT id, p_from_year, COALESCE(grade_level, class_level), class_name, status
    FROM public.students
    WHERE id = (it->>'student_id')::uuid;

    -- Update student
    UPDATE public.students SET
      academic_year = p_to_year,
      grade_level = COALESCE(it->>'grade_level', grade_level),
      class_level = COALESCE(it->>'grade_level', class_level),
      class_name = COALESCE(it->>'class_name', class_name),
      status = CASE it->>'action'
        WHEN 'graduate' THEN 'graduated'
        WHEN 'repeat' THEN 'repeating'
        ELSE 'active'
      END,
      is_active = (it->>'action') <> 'graduate'
    WHERE id = (it->>'student_id')::uuid;

    n := n + 1;
  END LOOP;

  RETURN n;
END $$;

-- Update school_settings policies
DROP POLICY IF EXISTS "Leaders manage school settings" ON public.school_settings;
CREATE POLICY "Leaders manage school settings" ON public.school_settings
  FOR UPDATE TO authenticated
  USING (
    (public.is_school_director(auth.uid()) OR public.is_platform_admin(auth.uid()))
    AND (public.is_platform_admin(auth.uid()) OR school_id = public.current_school_id())
  );

DROP POLICY IF EXISTS "Leaders insert school settings" ON public.school_settings;
CREATE POLICY "Leaders insert school settings" ON public.school_settings
  FOR INSERT TO authenticated
  WITH CHECK (
    (public.is_school_director(auth.uid()) OR public.is_platform_admin(auth.uid()))
    AND (public.is_platform_admin(auth.uid()) OR school_id = public.current_school_id())
  );


-- ==============================================================================
-- 5. ADD SCHOOL_SETTINGS COLUMNS FOR PERMISSIONS AND CUSTOM ROLE TITLES
-- ==============================================================================

-- Add role_titles column for custom display names
ALTER TABLE public.school_settings ADD COLUMN IF NOT EXISTS role_titles jsonb DEFAULT '{}'::jsonb;

-- Add permissions column with default permissions
ALTER TABLE public.school_settings ADD COLUMN IF NOT EXISTS permissions jsonb DEFAULT jsonb_build_object(
  'master_of_discipline', jsonb_build_object(
    'delete_students', true,
    'manage_offences', true,
    'view_audit_logs', true,
    'view_reports', true,
    'message_parents', true,
    'send_photos', true
  ),
  'matron', jsonb_build_object(
    'delete_students', false,
    'manage_offences', false,
    'view_audit_logs', false,
    'view_reports', true,
    'message_parents', true,
    'send_photos', true
  ),
  'patron', jsonb_build_object(
    'delete_students', false,
    'manage_offences', false,
    'view_audit_logs', false,
    'view_reports', true,
    'message_parents', true,
    'send_photos', true
  )
);

-- New: has_permission function - checks if user has a specific permission
CREATE OR REPLACE FUNCTION public.has_permission(_user_id uuid, _permission_key text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
      WHEN 'master_of_discipline' THEN true
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
END $$;

REVOKE EXECUTE ON FUNCTION public.has_permission(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_permission(uuid, text) TO authenticated, service_role;

-- Update DELETE policy on students to require delete_students permission
DROP POLICY IF EXISTS "Discipline staff manage students" ON public.students;
CREATE POLICY "Discipline staff can insert/update students" ON public.students
  FOR ALL TO authenticated
  USING (public.is_discipline_staff(auth.uid()))
  WITH CHECK (public.is_discipline_staff(auth.uid()));

DROP POLICY IF EXISTS "Permission required to delete students" ON public.students;
CREATE POLICY "Permission required to delete students" ON public.students
  FOR DELETE TO authenticated
  USING (
    public.is_platform_admin(auth.uid())
    OR public.is_school_director(auth.uid())
    OR public.has_permission(auth.uid(), 'delete_students')
  );

-- Update SELECT policy on audit_logs to require view_audit_logs permission
DROP POLICY IF EXISTS "Audit viewers can view logs" ON public.audit_logs;
CREATE POLICY "Audit viewers can view logs" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (
    public.is_platform_admin(auth.uid())
    OR public.is_audit_viewer(auth.uid())
    OR public.has_permission(auth.uid(), 'view_audit_logs')
  );

-- Update manage_offences permission for offenses_catalog
DROP POLICY IF EXISTS "Discipline staff manage offenses" ON public.offenses_catalog;
CREATE POLICY "Authorized staff manage offenses" ON public.offenses_catalog
  FOR ALL TO authenticated
  USING (
    public.is_platform_admin(auth.uid())
    OR public.is_school_director(auth.uid())
    OR public.has_permission(auth.uid(), 'manage_offences')
  )
  WITH CHECK (
    public.is_platform_admin(auth.uid())
    OR public.is_school_director(auth.uid())
    OR public.has_permission(auth.uid(), 'manage_offences')
  );


-- ==============================================================================
-- 6. UPDATE SIGN-UP FLOW: NO ROLE/SCHOOL FOR SELF-SIGN-UPS
-- ==============================================================================

-- Update handle_new_user to NOT assign a role or school to self-sign-ups
-- Only invited users get their role from invite metadata
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  invited_role text;
BEGIN
  -- Create profile
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''), NEW.email)
  ON CONFLICT (id) DO NOTHING;

  -- Check if this is an invited user (has role in metadata)
  invited_role := NEW.raw_user_meta_data ->> 'role';

  -- Only assign role if invited and role is a valid school role (never system_admin)
  IF invited_role IS NOT NULL
     AND invited_role IN ('school_director', 'master_of_discipline', 'matron', 'patron') THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, invited_role::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING;

    -- Also assign school from metadata if present
    IF NEW.raw_user_meta_data ? 'school_id' THEN
      UPDATE public.profiles
      SET school_id = (NEW.raw_user_meta_data ->> 'school_id')::uuid
      WHERE id = NEW.id;
    END IF;
  END IF;
  -- Otherwise: self-sign-up gets NO role and NO school (waits for director to assign)

  RETURN NEW;
END $$;


-- ==============================================================================
-- 7. AUDIT LOGGING FOR ROLE AND PERMISSION CHANGES
-- ==============================================================================

-- Function to log user_roles changes
CREATE OR REPLACE FUNCTION public.audit_user_roles_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target_school_id uuid;
  action_details jsonb;
BEGIN
  -- Get the school of the affected user
  SELECT school_id INTO target_school_id FROM public.profiles WHERE id = COALESCE(NEW.user_id, OLD.user_id);

  -- Build action details
  IF TG_OP = 'INSERT' THEN
    action_details := jsonb_build_object(
      'operation', 'role_assigned',
      'user_id', NEW.user_id,
      'role', NEW.role
    );
  ELSIF TG_OP = 'DELETE' THEN
    action_details := jsonb_build_object(
      'operation', 'role_removed',
      'user_id', OLD.user_id,
      'role', OLD.role
    );
  ELSE
    RETURN NEW;
  END IF;

  -- Insert audit log
  INSERT INTO public.audit_logs (school_id, user_id, action, details)
  VALUES (
    target_school_id,
    auth.uid(),
    CASE TG_OP
      WHEN 'INSERT' THEN 'assign_role'
      WHEN 'DELETE' THEN 'remove_role'
    END,
    action_details
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END $$;

DROP TRIGGER IF EXISTS audit_user_roles_trigger ON public.user_roles;
CREATE TRIGGER audit_user_roles_trigger
  AFTER INSERT OR DELETE ON public.user_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_user_roles_changes();

-- Function to log school_settings permission/title changes
CREATE OR REPLACE FUNCTION public.audit_school_settings_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  action_details jsonb;
BEGIN
  -- Only log if permissions or role_titles changed
  IF NEW.permissions IS DISTINCT FROM OLD.permissions
     OR NEW.role_titles IS DISTINCT FROM OLD.role_titles THEN

    action_details := jsonb_build_object(
      'old_permissions', OLD.permissions,
      'new_permissions', NEW.permissions,
      'old_role_titles', OLD.role_titles,
      'new_role_titles', NEW.role_titles
    );

    INSERT INTO public.audit_logs (school_id, user_id, action, details)
    VALUES (
      NEW.school_id,
      auth.uid(),
      'update_permissions',
      action_details
    );
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS audit_school_settings_trigger ON public.school_settings;
CREATE TRIGGER audit_school_settings_trigger
  AFTER UPDATE ON public.school_settings
  FOR EACH ROW
  WHEN (NEW.permissions IS DISTINCT FROM OLD.permissions OR NEW.role_titles IS DISTINCT FROM OLD.role_titles)
  EXECUTE FUNCTION public.audit_school_settings_changes();


-- ==============================================================================
-- 8. PLATFORM OWNER (system_admin) SPECIAL RULES
-- ==============================================================================

-- Allow profiles.school_id to be NULL for system_admin
-- (This was already done in section 1, but let's ensure it's clear)

-- Update the "Members view their school" policy to handle NULL school_id for platform admins
DROP POLICY IF EXISTS "Members view their school" ON public.schools;
CREATE POLICY "Members view their school" ON public.schools
  FOR SELECT TO authenticated
  USING (
    id = public.current_school_id()
    OR public.is_platform_admin(auth.uid())
  );

-- Update same school profiles policy to handle platform admins without school
DROP POLICY IF EXISTS "Same school profiles only" ON public.profiles;
CREATE POLICY "Same school profiles only" ON public.profiles AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    id = auth.uid()
    OR public.is_platform_admin(auth.uid())
    OR school_id = public.current_school_id()
  )
  WITH CHECK (
    id = auth.uid()
    OR public.is_platform_admin(auth.uid())
  );

-- Add column to track school status changes
ALTER TABLE public.schools ADD COLUMN IF NOT EXISTS status_reason text;
ALTER TABLE public.schools ADD COLUMN IF NOT EXISTS status_changed_at timestamptz;
ALTER TABLE public.schools ADD COLUMN IF NOT EXISTS status_changed_by uuid REFERENCES auth.users(id);

-- Function to log school status changes
CREATE OR REPLACE FUNCTION public.audit_school_status_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    -- Update metadata
    NEW.status_changed_at := now();
    NEW.status_changed_by := auth.uid();

    -- Log to audit_logs
    INSERT INTO public.audit_logs (school_id, user_id, action, details)
    VALUES (
      NEW.id,
      auth.uid(),
      'school_status_change',
      jsonb_build_object(
        'old_status', OLD.status,
        'new_status', NEW.status,
        'reason', NEW.status_reason
      )
    );
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS audit_school_status_trigger ON public.schools;
CREATE TRIGGER audit_school_status_trigger
  BEFORE UPDATE ON public.schools
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION public.audit_school_status_changes();

-- ==============================================================================
-- COMPLETION
-- ==============================================================================

-- The migration is complete. The app must implement fallbacks for missing columns:
-- - role_titles, permissions in school_settings
-- - status_reason, status_changed_at, status_changed_by in schools
-- - The new enum values (school_director, master_of_discipline, matron, patron)
