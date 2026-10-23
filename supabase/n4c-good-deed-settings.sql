-- N4C: Good Deed Settings — Category Management & Audit
-- Run manually in Supabase SQL editor.
-- Idempotent (safe to run twice).
--
-- SUMMARY:
-- 1. Add audit trail for good_deed_categories changes
-- 2. Create helper functions for category management
-- 3. Grant appropriate permissions
--
-- ==============================================================================
-- 1. AUDIT TRAIL FOR GOOD DEED CATEGORIES
-- ==============================================================================

-- Check if category_audit_logs table exists before creating
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_tables
    WHERE schemaname = 'public'
    AND tablename = 'category_audit_logs'
  ) THEN
    CREATE TABLE public.category_audit_logs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
      category_id uuid REFERENCES public.good_deed_categories(id) ON DELETE CASCADE,
      action text NOT NULL CHECK (action IN ('created', 'updated', 'activated', 'deactivated', 'deleted')),
      old_values jsonb,
      new_values jsonb,
      changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
      changed_at timestamptz NOT NULL DEFAULT now(),
      notes text
    );

    -- Index for performance
    CREATE INDEX IF NOT EXISTS idx_category_audit_school ON public.category_audit_logs(school_id);
    CREATE INDEX IF NOT EXISTS idx_category_audit_category ON public.category_audit_logs(category_id);
    CREATE INDEX IF NOT EXISTS idx_category_audit_changed_at ON public.category_audit_logs(changed_at DESC);

    -- RLS policies
    ALTER TABLE public.category_audit_logs ENABLE ROW LEVEL SECURITY;

    -- RESTRICTIVE: Same school only
    CREATE POLICY "Same school only" ON public.category_audit_logs
      AS RESTRICTIVE
      FOR ALL
      USING (
        public.is_platform_admin(auth.uid()) OR
        (school_id = public.current_school_id() AND public.school_is_active(school_id))
      );

    -- SELECT: Only authorized staff can view audit logs
    CREATE POLICY "Authorized staff can view audit logs" ON public.category_audit_logs
      FOR SELECT
      USING (
        public.is_school_director(auth.uid()) OR
        public.has_permission(auth.uid(), 'view_audit_logs') OR
        public.has_permission(auth.uid(), 'manage_offences')
      );

    -- INSERT: Only authorized staff can create audit entries (via trigger/function)
    CREATE POLICY "Authorized staff can create audit logs" ON public.category_audit_logs
      FOR INSERT
      WITH CHECK (
        public.is_school_director(auth.uid()) OR
        public.has_permission(auth.uid(), 'manage_offences')
      );

    GRANT SELECT, INSERT ON public.category_audit_logs TO authenticated;

    COMMENT ON TABLE public.category_audit_logs IS 'Audit trail for good deed category changes. Tracks who changed what and when.';
  END IF;
END $$;

-- ==============================================================================
-- 2. HELPER FUNCTION: LOG CATEGORY CHANGE
-- ==============================================================================

-- Function to log category changes
-- Usage: SELECT log_category_change(category_id, 'updated', old_json, new_json, 'Changed default points');
CREATE OR REPLACE FUNCTION public.log_category_change(
  p_category_id uuid,
  p_action text,
  p_old_values jsonb DEFAULT NULL,
  p_new_values jsonb DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_school_id uuid;
  v_audit_id uuid;
BEGIN
  -- Get school_id from category (or use current_school_id for deleted categories)
  IF p_category_id IS NOT NULL THEN
    SELECT school_id INTO v_school_id
    FROM public.good_deed_categories
    WHERE id = p_category_id;
  END IF;

  -- Fallback to current school if category not found
  IF v_school_id IS NULL THEN
    v_school_id := public.current_school_id();
  END IF;

  -- Verify caller is from the same school (SECURITY CHECK)
  IF v_school_id != public.current_school_id() AND NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Cannot log changes for another school';
  END IF;

  -- Insert audit log
  INSERT INTO public.category_audit_logs (
    school_id,
    category_id,
    action,
    old_values,
    new_values,
    changed_by,
    notes
  )
  VALUES (
    v_school_id,
    p_category_id,
    p_action,
    p_old_values,
    p_new_values,
    auth.uid(),
    p_notes
  )
  RETURNING id INTO v_audit_id;

  RETURN v_audit_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_category_change TO authenticated;

COMMENT ON FUNCTION public.log_category_change IS 'Logs a good deed category change to the audit trail. SECURITY DEFINER: checks school isolation.';

-- ==============================================================================
-- 3. TRIGGER: AUTO-AUDIT CATEGORY UPDATES
-- ==============================================================================

-- Trigger function to automatically log updates to categories
CREATE OR REPLACE FUNCTION public.audit_category_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_old_values jsonb;
  v_new_values jsonb;
  v_action text;
BEGIN
  -- Determine action
  IF TG_OP = 'INSERT' THEN
    v_action := 'created';
    v_new_values := to_jsonb(NEW);
    v_old_values := NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Check if it's an activation/deactivation
    IF OLD.is_active = true AND NEW.is_active = false THEN
      v_action := 'deactivated';
    ELSIF OLD.is_active = false AND NEW.is_active = true THEN
      v_action := 'activated';
    ELSE
      v_action := 'updated';
    END IF;
    v_old_values := to_jsonb(OLD);
    v_new_values := to_jsonb(NEW);
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'deleted';
    v_old_values := to_jsonb(OLD);
    v_new_values := NULL;
  END IF;

  -- Log the change
  PERFORM public.log_category_change(
    COALESCE(NEW.id, OLD.id),
    v_action,
    v_old_values,
    v_new_values,
    NULL
  );

  -- Return appropriate row
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS audit_good_deed_category_changes ON public.good_deed_categories;

-- Create trigger
CREATE TRIGGER audit_good_deed_category_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.good_deed_categories
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_category_changes();

COMMENT ON FUNCTION public.audit_category_changes IS 'Trigger function that automatically logs all changes to good_deed_categories.';

-- ==============================================================================
-- COMPLETION
-- ==============================================================================

-- All changes are idempotent and safe to run multiple times.
-- The audit system will track all category management actions.
