-- N4B — Offence Catalogue Editor (idempotent)
-- Run this manually in Supabase SQL Editor
-- Adds proper offence categories table and audit logging for offence management

-- =============================================================================
-- 1. CREATE OFFENCE_CATEGORIES TABLE
-- =============================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'offence_categories') THEN
    CREATE TABLE public.offence_categories (
      id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      school_id uuid NOT NULL DEFAULT public.current_school_id() REFERENCES public.schools(id) ON DELETE CASCADE,
      name text NOT NULL,
      is_active boolean DEFAULT true,
      sort_order integer DEFAULT 0,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now(),
      CONSTRAINT offence_categories_school_name_unique UNIQUE (school_id, name)
    );

    CREATE INDEX idx_offence_categories_school ON public.offence_categories(school_id);
    CREATE INDEX idx_offence_categories_active ON public.offence_categories(school_id, is_active) WHERE is_active = true;

    COMMENT ON TABLE public.offence_categories IS 'Offence categories per school (e.g., Academic Misconduct, Behavioral Issues)';
  END IF;
END $$;

-- RLS for offence_categories
ALTER TABLE public.offence_categories ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'offence_categories'
    AND policyname = 'Same school only'
  ) THEN
    CREATE POLICY "Same school only" ON public.offence_categories
      AS RESTRICTIVE
      USING (
        public.is_platform_admin(auth.uid())
        OR (school_id = public.current_school_id() AND public.school_is_active(school_id))
      );
  END IF;
END $$;

-- Read permission for offence_categories (all staff can view)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'offence_categories'
    AND policyname = 'Staff view categories'
  ) THEN
    CREATE POLICY "Staff view categories" ON public.offence_categories
      FOR SELECT
      USING (true);
  END IF;
END $$;

-- Write permission for offence_categories (requires manage_offences permission)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'offence_categories'
    AND policyname = 'Manage offences permission'
  ) THEN
    CREATE POLICY "Manage offences permission" ON public.offence_categories
      FOR INSERT, UPDATE, DELETE
      USING (
        public.is_platform_admin(auth.uid())
        OR (
          school_id = public.current_school_id()
          AND public.school_is_active(school_id)
          AND (
            public.is_school_director(auth.uid())
            OR public.has_permission(auth.uid(), 'manage_offences')
          )
        )
      )
      WITH CHECK (
        public.is_platform_admin(auth.uid())
        OR (
          school_id = public.current_school_id()
          AND public.school_is_active(school_id)
          AND (
            public.is_school_director(auth.uid())
            OR public.has_permission(auth.uid(), 'manage_offences')
          )
        )
      );
  END IF;
END $$;

-- =============================================================================
-- 2. SEED DEFAULT CATEGORIES FOR EXISTING SCHOOLS
-- =============================================================================

-- Seed default categories from existing unique values in offenses_catalog
INSERT INTO public.offence_categories (school_id, name, sort_order)
SELECT DISTINCT
  school_id,
  category,
  ROW_NUMBER() OVER (PARTITION BY school_id ORDER BY category)
FROM public.offenses_catalog
WHERE category IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.offence_categories
    WHERE offence_categories.school_id = offenses_catalog.school_id
      AND offence_categories.name = offenses_catalog.category
  )
ON CONFLICT (school_id, name) DO NOTHING;

-- =============================================================================
-- 3. ADD category_id TO offenses_catalog (KEEP category TEXT FOR FALLBACK)
-- =============================================================================

-- Add category_id column (nullable, references offence_categories)
ALTER TABLE public.offenses_catalog
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.offence_categories(id) ON DELETE SET NULL;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_offenses_catalog_category_id ON public.offenses_catalog(category_id);

-- Link existing offenses to categories
UPDATE public.offenses_catalog o
SET category_id = c.id
FROM public.offence_categories c
WHERE o.school_id = c.school_id
  AND o.category = c.name
  AND o.category_id IS NULL;

-- =============================================================================
-- 4. ADD AUDIT TRIGGERS FOR OFFENCES CHANGES
-- =============================================================================

-- Audit trigger for offence_categories
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'audit_offence_categories'
    AND tgrelid = 'public.offence_categories'::regclass
  ) THEN
    CREATE TRIGGER audit_offence_categories
      AFTER INSERT OR UPDATE OR DELETE ON public.offence_categories
      FOR EACH ROW EXECUTE FUNCTION public.audit_log();
  END IF;
END $$;

-- Audit trigger for offenses_catalog
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'audit_offenses_catalog'
    AND tgrelid = 'public.offenses_catalog'::regclass
  ) THEN
    CREATE TRIGGER audit_offenses_catalog
      AFTER INSERT OR UPDATE OR DELETE ON public.offenses_catalog
      FOR EACH ROW EXECUTE FUNCTION public.audit_log();
  END IF;
END $$;

-- =============================================================================
-- 5. HELPER FUNCTION: Check if offence is in use
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_offence_in_use(_offence_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conduct_logs
    WHERE offense_id = _offence_id
  );
$$;

COMMENT ON FUNCTION public.is_offence_in_use IS 'Check if an offence has been used in any conduct logs';

GRANT EXECUTE ON FUNCTION public.is_offence_in_use(uuid) TO authenticated;

-- =============================================================================
-- 6. HELPER FUNCTION: Check if category is in use
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_category_in_use(_category_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.offenses_catalog
    WHERE category_id = _category_id
      AND is_active = true
  );
$$;

COMMENT ON FUNCTION public.is_category_in_use IS 'Check if a category has any active offences';

GRANT EXECUTE ON FUNCTION public.is_category_in_use(uuid) TO authenticated;

-- =============================================================================
-- Summary
-- =============================================================================
-- This script creates:
-- 1. offence_categories table with RLS (UNIQUE per school name, soft delete with is_active)
-- 2. Adds category_id to offenses_catalog (keeps category text as fallback)
-- 3. Seeds categories from existing offenses
-- 4. Links existing offences to categories
-- 5. Adds audit triggers for all offence changes
-- 6. Helper functions to check if offence/category is in use (for safe deletion)
--
-- All operations are idempotent and safe to run multiple times.
