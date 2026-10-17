-- SCDMS: Phase 1 Foundations — Multi-school safety and correctness.
-- Run manually in Supabase SQL editor. Idempotent (safe to run twice).
-- Requires: supabase/saas-multi-tenant.sql (schools table, helper functions).

-- 1. FIX SECURITY HOLE: promote_students_batch must check caller's school ----------
-- This function is SECURITY DEFINER, so it bypasses RLS. We must manually verify
-- that every student belongs to the caller's school (or caller is platform admin).

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
  -- Check role authorization
  IF NOT (public.has_role(auth.uid(), 'school_leader') OR public.has_role(auth.uid(), 'system_admin')) THEN
    RAISE EXCEPTION 'Only school leaders or administrators can run the rollover';
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

REVOKE EXECUTE ON FUNCTION public.promote_students_batch(text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.promote_students_batch(text, text, jsonb) TO authenticated;


-- 2. MAKE SCHOOL_SETTINGS PER-SCHOOL -----------------------------------------
-- Currently school_settings has CHECK (id = 1), allowing only one row globally.
-- We'll add school_id, remove that constraint, and add new columns.

-- Add school_id column (nullable first, then we'll set defaults and make it unique)
ALTER TABLE public.school_settings ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES public.schools(id);

-- Assign existing row (id=1) to the default school
UPDATE public.school_settings
SET school_id = '00000000-0000-0000-0000-000000000001'
WHERE id = 1 AND school_id IS NULL;

-- Remove the CHECK (id = 1) constraint to allow multiple schools
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

-- Add new columns for school configuration
ALTER TABLE public.school_settings ADD COLUMN IF NOT EXISTS school_type text DEFAULT 'secondary';
ALTER TABLE public.school_settings ADD COLUMN IF NOT EXISTS is_boarding boolean DEFAULT true;
ALTER TABLE public.school_settings ADD COLUMN IF NOT EXISTS max_conduct_marks integer DEFAULT 40;
ALTER TABLE public.school_settings ADD COLUMN IF NOT EXISTS class_levels text[] DEFAULT '{S1,S2,S3,S4,S5,S6}';

-- Add constraints for school_type
ALTER TABLE public.school_settings DROP CONSTRAINT IF EXISTS school_settings_school_type_check;
ALTER TABLE public.school_settings ADD CONSTRAINT school_settings_school_type_check
  CHECK (school_type IN ('nursery', 'primary', 'secondary', 'tvet', 'mixed'));

-- Make school_id unique (one settings row per school)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'school_settings_school_id_key'
    AND conrelid = 'public.school_settings'::regclass
  ) THEN
    ALTER TABLE public.school_settings ADD CONSTRAINT school_settings_school_id_key UNIQUE (school_id);
  END IF;
END $$;

-- Enable RLS on school_settings
ALTER TABLE public.school_settings ENABLE ROW LEVEL SECURITY;

-- RESTRICTIVE policy: same school only
DROP POLICY IF EXISTS "Same school only" ON public.school_settings;
CREATE POLICY "Same school only" ON public.school_settings AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.is_platform_admin(auth.uid())
    OR (school_id = public.current_school_id() AND public.school_is_active(school_id))
  )
  WITH CHECK (
    public.is_platform_admin(auth.uid())
    OR (school_id = public.current_school_id() AND public.school_is_active(school_id))
  );

-- Policy: Leaders and admins can update their school's settings
DROP POLICY IF EXISTS "Leaders manage school settings" ON public.school_settings;
CREATE POLICY "Leaders manage school settings" ON public.school_settings
  FOR UPDATE TO authenticated
  USING (
    (public.has_role(auth.uid(), 'school_leader') OR public.has_role(auth.uid(), 'system_admin'))
    AND (public.is_platform_admin(auth.uid()) OR school_id = public.current_school_id())
  );

-- Policy: Leaders and admins can insert settings for their school
DROP POLICY IF EXISTS "Leaders insert school settings" ON public.school_settings;
CREATE POLICY "Leaders insert school settings" ON public.school_settings
  FOR INSERT TO authenticated
  WITH CHECK (
    (public.has_role(auth.uid(), 'school_leader') OR public.has_role(auth.uid(), 'system_admin'))
    AND (public.is_platform_admin(auth.uid()) OR school_id = public.current_school_id())
  );


-- 3. MAKE UNIQUENESS PER-SCHOOL ----------------------------------------------
-- admission_no and offense codes should be unique per school, not globally.

-- Find and drop the global uniqueness constraint on students.admission_no
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.students'::regclass
    AND contype = 'u'
    AND array_length(conkey, 1) = 1
    AND EXISTS (
      SELECT 1 FROM pg_attribute
      WHERE attrelid = 'public.students'::regclass
        AND attname = 'admission_no'
        AND attnum = ANY(conkey)
    );

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.students DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

-- Create per-school uniqueness constraint for admission_no
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'students_school_id_admission_no_key'
    AND conrelid = 'public.students'::regclass
  ) THEN
    ALTER TABLE public.students ADD CONSTRAINT students_school_id_admission_no_key
      UNIQUE (school_id, admission_no);
  END IF;
END $$;

-- Find and drop the global uniqueness constraint on offenses_catalog.code
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.offenses_catalog'::regclass
    AND contype = 'u'
    AND array_length(conkey, 1) = 1
    AND EXISTS (
      SELECT 1 FROM pg_attribute
      WHERE attrelid = 'public.offenses_catalog'::regclass
        AND attname = 'code'
        AND attnum = ANY(conkey)
    );

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.offenses_catalog DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

-- Create per-school uniqueness constraint for offense code
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'offenses_catalog_school_id_code_key'
    AND conrelid = 'public.offenses_catalog'::regclass
  ) THEN
    ALTER TABLE public.offenses_catalog ADD CONSTRAINT offenses_catalog_school_id_code_key
      UNIQUE (school_id, code);
  END IF;
END $$;


-- 4. ONE ACTIVE TERM PER SCHOOL -----------------------------------------------
-- Create a partial unique index so only one term can be active per school.

DROP INDEX IF EXISTS academic_terms_one_active_per_school_idx;
CREATE UNIQUE INDEX academic_terms_one_active_per_school_idx
  ON public.academic_terms (school_id)
  WHERE is_active = true;


-- 5. RECREATE student_conduct_balances VIEW -----------------------------------
-- The view must join students with terms from the SAME school.
-- Add school_id, class_level, stream to output for class reports.

CREATE OR REPLACE VIEW public.student_conduct_balances
WITH (security_invoker = true) AS
SELECT
  s.id AS student_id,
  s.school_id,
  s.full_name,
  s.admission_no,
  s.class_name,
  s.class_level,
  CASE
    WHEN s.class_name ~ '[A-Z]$' THEN substring(s.class_name from '[A-Z]$')
    ELSE NULL
  END AS stream,
  s.house,
  s.parent_phone,
  t.id AS term_id,
  t.name AS term_name,
  t.starting_marks,
  COALESCE(SUM(CASE WHEN cl.entry_type = 'deduction' THEN cl.marks ELSE 0 END), 0) AS marks_deducted,
  COALESCE(SUM(CASE WHEN cl.entry_type = 'restoration' THEN cl.marks ELSE 0 END), 0) AS marks_restored,
  t.starting_marks - COALESCE(SUM(CASE WHEN cl.entry_type = 'deduction' THEN cl.marks ELSE 0 END), 0)
    + COALESCE(SUM(CASE WHEN cl.entry_type = 'restoration' THEN cl.marks ELSE 0 END), 0) AS current_marks,
  COUNT(cl.id) AS entries_count
FROM public.students s
CROSS JOIN public.academic_terms t
LEFT JOIN public.conduct_logs cl ON cl.student_id = s.id AND cl.term_id = t.id
WHERE t.is_active = true
  AND s.is_active = true
  AND t.school_id = s.school_id  -- CRITICAL: join only terms from the same school
GROUP BY s.id, s.school_id, s.full_name, s.admission_no, s.class_name, s.class_level,
         s.house, s.parent_phone, t.id, t.name, t.starting_marks;

GRANT SELECT ON public.student_conduct_balances TO authenticated;


-- 6. AUTO-SEED NEW SCHOOLS ----------------------------------------------------
-- When a school is created, automatically create:
-- (a) school_settings row
-- (b) one active term with sensible defaults
-- (c) default offense catalog copied from default school

CREATE OR REPLACE FUNCTION public.seed_new_school()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  default_school_id uuid := '00000000-0000-0000-0000-000000000001';
  new_term_start date;
  new_term_end date;
BEGIN
  -- (a) Create school_settings
  INSERT INTO public.school_settings (school_id, school_name, academic_year, critical_threshold, warning_threshold, notify_on_threshold)
  VALUES (NEW.id, NEW.name, '2026/2027', 20, 30, true)
  ON CONFLICT (school_id) DO NOTHING;

  -- (b) Create one active term
  -- Default: current date to 3 months from now
  new_term_start := CURRENT_DATE;
  new_term_end := CURRENT_DATE + INTERVAL '3 months';

  INSERT INTO public.academic_terms (school_id, name, start_date, end_date, starting_marks, is_active)
  VALUES (NEW.id, 'Term 1', new_term_start, new_term_end, 40, true)
  ON CONFLICT DO NOTHING;

  -- (c) Copy default offenses from the default school
  INSERT INTO public.offenses_catalog (school_id, code, title, category, severity, marks_deducted, is_active)
  SELECT NEW.id, code, title, category, severity, marks_deducted, is_active
  FROM public.offenses_catalog
  WHERE school_id = default_school_id
  ON CONFLICT (school_id, code) DO NOTHING;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS seed_new_school_trigger ON public.schools;
CREATE TRIGGER seed_new_school_trigger
  AFTER INSERT ON public.schools
  FOR EACH ROW
  EXECUTE FUNCTION public.seed_new_school();

-- Also seed any existing schools that don't have settings/terms/offenses yet
DO $$
DECLARE
  school_rec record;
  default_school_id uuid := '00000000-0000-0000-0000-000000000001';
  new_term_start date;
  new_term_end date;
BEGIN
  FOR school_rec IN
    SELECT id, name
    FROM public.schools
    WHERE id <> default_school_id
      AND NOT EXISTS (SELECT 1 FROM public.school_settings WHERE school_id = school_rec.id)
  LOOP
    -- Create settings
    INSERT INTO public.school_settings (school_id, school_name, academic_year, critical_threshold, warning_threshold, notify_on_threshold)
    VALUES (school_rec.id, school_rec.name, '2026/2027', 20, 30, true)
    ON CONFLICT (school_id) DO NOTHING;

    -- Create term (only if no active term exists for this school)
    IF NOT EXISTS (SELECT 1 FROM public.academic_terms WHERE school_id = school_rec.id AND is_active = true) THEN
      new_term_start := CURRENT_DATE;
      new_term_end := CURRENT_DATE + INTERVAL '3 months';

      INSERT INTO public.academic_terms (school_id, name, start_date, end_date, starting_marks, is_active)
      VALUES (school_rec.id, 'Term 1', new_term_start, new_term_end, 40, true)
      ON CONFLICT DO NOTHING;
    END IF;

    -- Copy offenses (only if school has none)
    IF NOT EXISTS (SELECT 1 FROM public.offenses_catalog WHERE school_id = school_rec.id) THEN
      INSERT INTO public.offenses_catalog (school_id, code, title, category, severity, marks_deducted, is_active)
      SELECT school_rec.id, code, title, category, severity, marks_deducted, is_active
      FROM public.offenses_catalogy
      WHERE school_id = default_school_id
      ON CONFLICT (school_id, code) DO NOTHING;
    END IF;
  END LOOP;
END $$;
