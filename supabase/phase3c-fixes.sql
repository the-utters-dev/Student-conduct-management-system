-- SCDMS: Phase 3c — Critical Fixes for Production Issues
-- Run manually in Supabase SQL editor.
-- Idempotent (safe to run twice).
--
-- SUMMARY:
-- 1. Fix school_settings.id to use sequence instead of DEFAULT 1
-- 2. Fix audit_logs: add details→payload migration, ensure NOT NULL columns have defaults
-- 3. Update all SQL triggers to write complete audit_logs rows (entity_type, action, payload)
-- 4. Add columns for school status tracking if missing

-- ==============================================================================
-- 1. FIX SCHOOL_SETTINGS.ID SEQUENCE DEFAULT
-- ==============================================================================

-- Create sequence if it doesn't exist
CREATE SEQUENCE IF NOT EXISTS public.school_settings_id_seq;

-- Set the sequence to start from the max current ID + 1
SELECT setval('public.school_settings_id_seq', COALESCE((SELECT MAX(id) FROM public.school_settings), 0) + 1, false);

-- Alter the id column to use the sequence as default
ALTER TABLE public.school_settings
  ALTER COLUMN id SET DEFAULT nextval('public.school_settings_id_seq');

-- Drop the old CHECK constraint if it exists (prevents duplicate key errors)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'school_settings_id_check'
    AND conrelid = 'public.school_settings'::regclass
  ) THEN
    ALTER TABLE public.school_settings DROP CONSTRAINT school_settings_id_check;
  END IF;
END $$;


-- ==============================================================================
-- 2. FIX AUDIT_LOGS: ADD MISSING COLUMNS AND DEFAULTS
-- ==============================================================================

-- Add 'details' column if it doesn't exist (temporary column used in live DB)
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS details jsonb;

-- Add 'payload' column if it doesn't exist (the correct column name)
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS payload jsonb DEFAULT '{}'::jsonb;

-- Add 'entity_type' column if missing, with default
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS entity_type text DEFAULT 'system';

-- Add 'entity_id' column if missing (nullable - not all actions have an entity)
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS entity_id uuid;

-- Ensure 'action' column has a default (in case it was missing)
ALTER TABLE public.audit_logs ALTER COLUMN action SET DEFAULT 'UNSPECIFIED';

-- Migrate any data from 'details' to 'payload' if details has content
UPDATE public.audit_logs
SET payload = COALESCE(details, '{}'::jsonb)
WHERE details IS NOT NULL AND details IS DISTINCT FROM '{}'::jsonb
  AND (payload IS NULL OR payload = '{}'::jsonb);

-- Now we can safely drop the 'details' column (after migration)
-- Note: We keep it for now in case there's more data coming in with 'details'
-- The triggers below will use 'payload' only

-- Ensure entity_type is NOT NULL with a default
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'audit_logs'
    AND column_name = 'entity_type'
    AND is_nullable = 'YES'
  ) THEN
    -- Set default for any NULL values first
    UPDATE public.audit_logs SET entity_type = 'system' WHERE entity_type IS NULL;
    -- Then make it NOT NULL
    ALTER TABLE public.audit_logs ALTER COLUMN entity_type SET NOT NULL;
  END IF;
END $$;


-- ==============================================================================
-- 3. UPDATE ALL SQL TRIGGERS TO WRITE COMPLETE AUDIT_LOGS ROWS
-- ==============================================================================

-- 3a. audit_user_roles_changes: Fix to use payload, entity_type, entity_id
CREATE OR REPLACE FUNCTION public.audit_user_roles_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target_school_id uuid;
  action_type text;
  action_payload jsonb;
BEGIN
  -- Get the school of the affected user
  SELECT school_id INTO target_school_id FROM public.profiles WHERE id = COALESCE(NEW.user_id, OLD.user_id);

  -- Build action type and payload
  IF TG_OP = 'INSERT' THEN
    action_type := 'ASSIGN_ROLE';
    action_payload := jsonb_build_object(
      'operation', 'role_assigned',
      'user_id', NEW.user_id,
      'role', NEW.role
    );
  ELSIF TG_OP = 'DELETE' THEN
    action_type := 'REMOVE_ROLE';
    action_payload := jsonb_build_object(
      'operation', 'role_removed',
      'user_id', OLD.user_id,
      'role', OLD.role
    );
  ELSE
    RETURN NEW;
  END IF;

  -- Insert complete audit log row
  INSERT INTO public.audit_logs (
    school_id,
    user_id,
    action,
    entity_type,
    entity_id,
    payload
  ) VALUES (
    target_school_id,
    COALESCE(auth.uid(), COALESCE(NEW.user_id, OLD.user_id)),  -- Fallback for system operations
    action_type,
    'user_role',
    COALESCE(NEW.user_id, OLD.user_id),
    action_payload
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


-- 3b. audit_school_settings_changes: Fix to use payload, entity_type, entity_id
CREATE OR REPLACE FUNCTION public.audit_school_settings_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  action_payload jsonb;
BEGIN
  -- Only log if permissions or role_titles changed
  IF NEW.permissions IS DISTINCT FROM OLD.permissions
     OR NEW.role_titles IS DISTINCT FROM OLD.role_titles THEN

    action_payload := jsonb_build_object(
      'old_permissions', OLD.permissions,
      'new_permissions', NEW.permissions,
      'old_role_titles', OLD.role_titles,
      'new_role_titles', NEW.role_titles
    );

    INSERT INTO public.audit_logs (
      school_id,
      user_id,
      action,
      entity_type,
      entity_id,
      payload
    ) VALUES (
      NEW.school_id,
      COALESCE(auth.uid(), NEW.school_id),  -- Fallback for system operations
      'UPDATE_PERMISSIONS',
      'school_settings',
      NEW.id::uuid,  -- Cast id to uuid for entity_id
      action_payload
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


-- 3c. audit_school_status_changes: Fix to use payload, entity_type, entity_id
CREATE OR REPLACE FUNCTION public.audit_school_status_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    -- Update status tracking columns
    NEW.status_changed_at := now();
    NEW.status_changed_by := auth.uid();

    -- Insert complete audit log
    INSERT INTO public.audit_logs (
      school_id,
      user_id,
      action,
      entity_type,
      entity_id,
      payload
    ) VALUES (
      NEW.id,
      COALESCE(auth.uid(), NEW.id),  -- Fallback for system operations
      'SCHOOL_STATUS_CHANGE',
      'school',
      NEW.id,
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
-- 4. ADD SCHOOL STATUS TRACKING COLUMNS IF MISSING
-- ==============================================================================

ALTER TABLE public.schools ADD COLUMN IF NOT EXISTS status_reason text;
ALTER TABLE public.schools ADD COLUMN IF NOT EXISTS status_changed_at timestamptz;
ALTER TABLE public.schools ADD COLUMN IF NOT EXISTS status_changed_by uuid REFERENCES auth.users(id);


-- ==============================================================================
-- 5. ENSURE AUDIT_LOGS RLS IS PROPERLY CONFIGURED
-- ==============================================================================

-- Ensure RLS is enabled
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Recreate policies to ensure they're correct
DROP POLICY IF EXISTS "Same school only" ON public.audit_logs;
CREATE POLICY "Same school only" ON public.audit_logs AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.is_platform_admin(auth.uid())
    OR (school_id = public.current_school_id() AND public.school_is_active(school_id))
  );

DROP POLICY IF EXISTS "Audit viewers can read" ON public.audit_logs;
CREATE POLICY "Audit viewers can read" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (
    public.is_platform_admin(auth.uid())
    OR public.is_audit_viewer(auth.uid())
    OR public.has_permission(auth.uid(), 'view_audit_logs')
  );


-- ==============================================================================
-- VERIFICATION QUERIES (Run these manually to verify fixes)
-- ==============================================================================

-- Check school_settings sequence is working:
-- SELECT currval('public.school_settings_id_seq');

-- Check audit_logs columns exist:
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'audit_logs'
-- ORDER BY ordinal_position;

-- Check for any audit_logs with missing entity_type:
-- SELECT COUNT(*) FROM public.audit_logs WHERE entity_type IS NULL;

-- Check school status tracking columns:
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'schools'
-- AND column_name IN ('status_reason', 'status_changed_at', 'status_changed_by');
