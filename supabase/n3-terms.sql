-- N3 — Academic Years and Terms (idempotent)
-- Run this after n4c-good-deed-settings.sql
-- This script creates helper functions, academic years, and academic terms tables

-- =============================================================================
-- Helper function: has_school_role
-- =============================================================================
-- Checks if a user has a specific role

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

-- =============================================================================
-- Generic audit_log trigger function
-- =============================================================================
-- Generic trigger function to log INSERT/UPDATE/DELETE operations

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
-- Academic Years table
-- =============================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'academic_years') THEN
    CREATE TABLE public.academic_years (
      id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      school_id uuid NOT NULL DEFAULT public.current_school_id() REFERENCES public.schools(id) ON DELETE CASCADE,
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

-- Ensure only one current year per school
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'academic_years_one_current_per_school'
  ) THEN
    CREATE UNIQUE INDEX academic_years_one_current_per_school
      ON public.academic_years(school_id)
      WHERE is_current = true;
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

-- Read permission for academic_years (all staff can view)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'academic_years'
    AND policyname = 'Staff view academic years'
  ) THEN
    CREATE POLICY "Staff view academic years" ON public.academic_years
      FOR SELECT
      USING (
        public.is_platform_admin(auth.uid())
        OR (
          school_id = public.current_school_id()
          AND public.school_is_active(school_id)
        )
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
      FOR INSERT, UPDATE, DELETE
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
      )
      WITH CHECK (
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
      school_id uuid NOT NULL DEFAULT public.current_school_id() REFERENCES public.schools(id) ON DELETE CASCADE,
      academic_year_id uuid REFERENCES public.academic_years(id) ON DELETE SET NULL,
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
  ELSE
    -- Add academic_year_id column if it doesn't exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
      AND table_name = 'academic_terms'
      AND column_name = 'academic_year_id'
    ) THEN
      ALTER TABLE public.academic_terms
        ADD COLUMN academic_year_id uuid REFERENCES public.academic_years(id) ON DELETE SET NULL;

      CREATE INDEX IF NOT EXISTS idx_academic_terms_year ON public.academic_terms(academic_year_id);
    END IF;
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

-- Drop old policy if it exists
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'academic_terms'
    AND policyname = 'Discipline staff manage terms'
  ) THEN
    DROP POLICY "Discipline staff manage terms" ON public.academic_terms;
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
      )
      WITH CHECK (
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
-- Summary
-- =============================================================================
-- This script creates:
-- 1. has_school_role helper function to check user roles
-- 2. audit_log trigger function for generic audit logging
-- 3. academic_years table with RLS and audit (one current year per school)
-- 4. academic_terms table with RLS and audit (linked to academic_year_id)
-- 5. Appropriate permissions: staff can view, manage_terms permission required for writes
-- All operations are idempotent and safe to run multiple times.
