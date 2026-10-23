-- N3 — Academic Years and Terms (idempotent)
-- Run this after n4c-good-deed-settings.sql

-- =============================================================================
-- Academic Years table
-- =============================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'academic_years') THEN
    CREATE TABLE public.academic_years (
      id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
      name text NOT NULL,
      start_date date NOT NULL,
      end_date date NOT NULL,
      is_current boolean DEFAULT false,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now(),
      CONSTRAINT academic_years_school_name_unique UNIQUE (school_id, name),
      CONSTRAINT academic_years_dates_valid CHECK (end_date > start_date)
    );

    CREATE INDEX idx_academic_years_school ON public.academic_years(school_id);
    CREATE INDEX idx_academic_years_current ON public.academic_years(school_id, is_current) WHERE is_current = true;

    COMMENT ON TABLE public.academic_years IS 'School academic years (e.g., 2026/2027)';
  END IF;
END $$;

-- RLS for academic_years
ALTER TABLE public.academic_years ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'academic_years'
    AND policyname = 'Same school only'
  ) THEN
    CREATE POLICY "Same school only" ON public.academic_years
      AS RESTRICTIVE
      USING (
        public.is_platform_admin(auth.uid())
        OR (school_id = public.current_school_id() AND public.school_is_active(school_id))
      );
  END IF;
END $$;

-- Write permission for academic_years (requires manage_terms permission)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'academic_years'
    AND policyname = 'Manage terms permission'
  ) THEN
    CREATE POLICY "Manage terms permission" ON public.academic_years
      FOR ALL
      USING (
        public.is_platform_admin(auth.uid())
        OR (
          school_id = public.current_school_id()
          AND public.school_is_active(school_id)
          AND (
            public.has_school_role(auth.uid(), 'school_director')
            OR public.has_permission(auth.uid(), 'manage_terms')
          )
        )
      );
  END IF;
END $$;

-- =============================================================================
-- Academic Terms table
-- =============================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'academic_terms') THEN
    CREATE TABLE public.academic_terms (
      id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      academic_year_id uuid NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
      school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
      name text NOT NULL,
      start_date date NOT NULL,
      end_date date NOT NULL,
      starting_marks integer NOT NULL DEFAULT 40,
      is_active boolean DEFAULT false,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now(),
      CONSTRAINT academic_terms_school_name_unique UNIQUE (school_id, name),
      CONSTRAINT academic_terms_dates_valid CHECK (end_date > start_date),
      CONSTRAINT academic_terms_starting_marks_range CHECK (starting_marks >= 10 AND starting_marks <= 200)
    );

    CREATE INDEX idx_academic_terms_school ON public.academic_terms(school_id);
    CREATE INDEX idx_academic_terms_year ON public.academic_terms(academic_year_id);
    CREATE INDEX idx_academic_terms_active ON public.academic_terms(school_id, is_active) WHERE is_active = true;

    COMMENT ON TABLE public.academic_terms IS 'School academic terms (e.g., Term 1, Term 2, Term 3)';
  END IF;
END $$;

-- RLS for academic_terms
ALTER TABLE public.academic_terms ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'academic_terms'
    AND policyname = 'Same school only'
  ) THEN
    CREATE POLICY "Same school only" ON public.academic_terms
      AS RESTRICTIVE
      USING (
        public.is_platform_admin(auth.uid())
        OR (school_id = public.current_school_id() AND public.school_is_active(school_id))
      );
  END IF;
END $$;

-- Write permission for academic_terms (requires manage_terms permission)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'academic_terms'
    AND policyname = 'Manage terms permission'
  ) THEN
    CREATE POLICY "Manage terms permission" ON public.academic_terms
      FOR ALL
      USING (
        public.is_platform_admin(auth.uid())
        OR (
          school_id = public.current_school_id()
          AND public.school_is_active(school_id)
          AND (
            public.has_school_role(auth.uid(), 'school_director')
            OR public.has_permission(auth.uid(), 'manage_terms')
          )
        )
      );
  END IF;
END $$;

-- =============================================================================
-- Audit triggers
-- =============================================================================

-- Audit trigger for academic_years
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'audit_academic_years'
    AND tgrelid = 'public.academic_years'::regclass
  ) THEN
    CREATE TRIGGER audit_academic_years
      AFTER INSERT OR UPDATE OR DELETE ON public.academic_years
      FOR EACH ROW EXECUTE FUNCTION public.audit_log();
  END IF;
END $$;

-- Audit trigger for academic_terms
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'audit_academic_terms'
    AND tgrelid = 'public.academic_terms'::regclass
  ) THEN
    CREATE TRIGGER audit_academic_terms
      AFTER INSERT OR UPDATE OR DELETE ON public.academic_terms
      FOR EACH ROW EXECUTE FUNCTION public.audit_log();
  END IF;
END $$;

-- =============================================================================
-- Helper function: has_permission
-- =============================================================================
-- This function checks if a user has a specific permission based on their role

CREATE OR REPLACE FUNCTION public.has_permission(user_id uuid, permission text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  user_school_id uuid;
  user_role text;
  school_permissions jsonb;
  role_permissions jsonb;
BEGIN
  -- Get user's school and role
  SELECT p.school_id INTO user_school_id
  FROM public.profiles p
  WHERE p.id = user_id;

  -- Get user's primary role
  SELECT ur.role INTO user_role
  FROM public.user_roles ur
  WHERE ur.user_id = user_id
  ORDER BY CASE
    WHEN ur.role = 'school_director' THEN 1
    WHEN ur.role = 'master_of_discipline' THEN 2
    WHEN ur.role = 'matron' THEN 3
    WHEN ur.role = 'patron' THEN 4
    ELSE 5
  END
  LIMIT 1;

  -- School directors always have all permissions
  IF user_role IN ('school_director', 'school_leader') THEN
    RETURN true;
  END IF;

  -- Get school permissions
  SELECT ss.permissions INTO school_permissions
  FROM public.school_settings ss
  WHERE ss.school_id = user_school_id;

  -- If no permissions configured, use defaults
  IF school_permissions IS NULL THEN
    -- Default permissions for master_of_discipline
    IF user_role = 'master_of_discipline' THEN
      RETURN permission IN ('delete_students', 'manage_offences', 'view_audit_logs', 'view_reports', 'message_parents', 'send_photos', 'manage_terms', 'school_wide_entries');
    END IF;
    -- Matron and Patron have limited permissions by default
    IF user_role IN ('matron', 'patron') THEN
      RETURN permission IN ('view_reports', 'message_parents', 'send_photos');
    END IF;
    RETURN false;
  END IF;

  -- Check role-specific permissions
  role_permissions := school_permissions -> user_role;
  IF role_permissions IS NULL THEN
    RETURN false;
  END IF;

  RETURN COALESCE((role_permissions ->> permission)::boolean, false);
END;
$$;

COMMENT ON FUNCTION public.has_permission IS 'Check if a user has a specific permission based on their role and school settings';

-- =============================================================================
-- Summary
-- =============================================================================
-- This script creates:
-- 1. academic_years table with RLS and audit
-- 2. academic_terms table with RLS and audit
-- 3. has_permission helper function for permission checking
-- All operations are idempotent and safe to run multiple times.
