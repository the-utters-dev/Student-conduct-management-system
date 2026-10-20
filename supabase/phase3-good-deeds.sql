-- SCDMS: Phase 3 — Good Deeds & Positive Recognition
-- Run manually in Supabase SQL editor AFTER phase2b-roles.sql.
-- Idempotent (safe to run twice).
--
-- SUMMARY:
-- 1. Creates good_deed_categories table with RLS policies
-- 2. Extends conduct_logs to support 'good_deed' entries with merit points
-- 3. Seeds default categories for existing schools and new school function
-- 4. Adds good_deed_reward setting to school_settings
-- 5. Updates student_conduct_balances view to include good deeds
-- 6. Audit logging for good deeds (handled by existing triggers)

-- ==============================================================================
-- 1. CREATE GOOD_DEED_CATEGORIES TABLE
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.good_deed_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL DEFAULT public.current_school_id() REFERENCES public.schools(id) ON DELETE CASCADE,
  name text NOT NULL,
  default_marks int NOT NULL DEFAULT 1,
  default_merit_points int NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, name)
);

-- RLS Policies for good_deed_categories
ALTER TABLE public.good_deed_categories ENABLE ROW LEVEL SECURITY;

-- Same school only (RESTRICTIVE)
DROP POLICY IF EXISTS "Same school only" ON public.good_deed_categories;
CREATE POLICY "Same school only" ON public.good_deed_categories AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.is_platform_admin(auth.uid())
    OR (school_id = public.current_school_id() AND public.school_is_active(school_id))
  );

-- Staff can view categories
DROP POLICY IF EXISTS "Staff can view categories" ON public.good_deed_categories;
CREATE POLICY "Staff can view categories" ON public.good_deed_categories
  FOR SELECT TO authenticated
  USING (true);

-- Authorized staff can manage categories
DROP POLICY IF EXISTS "Authorized staff manage categories" ON public.good_deed_categories;
CREATE POLICY "Authorized staff manage categories" ON public.good_deed_categories
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

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.good_deed_categories TO authenticated;

-- ==============================================================================
-- 2. EXTEND CONDUCT_LOGS FOR GOOD DEEDS
-- ==============================================================================

-- Add new columns for good deeds
ALTER TABLE public.conduct_logs ADD COLUMN IF NOT EXISTS good_deed_category_id uuid REFERENCES public.good_deed_categories(id) ON DELETE SET NULL;
ALTER TABLE public.conduct_logs ADD COLUMN IF NOT EXISTS merit_points int NOT NULL DEFAULT 0;

-- Recreate the entry_type check to allow 'good_deed'
ALTER TABLE public.conduct_logs DROP CONSTRAINT IF EXISTS conduct_logs_entry_type_check;
ALTER TABLE public.conduct_logs ADD CONSTRAINT conduct_logs_entry_type_check
  CHECK (entry_type IN ('deduction', 'restoration', 'good_deed'));

-- Update marks check to allow 0 (for recognition-only good deeds)
ALTER TABLE public.conduct_logs DROP CONSTRAINT IF EXISTS conduct_logs_marks_check;
ALTER TABLE public.conduct_logs ADD CONSTRAINT conduct_logs_marks_check
  CHECK (marks >= 0);

-- ==============================================================================
-- 3. SEED DEFAULT CATEGORIES FOR EXISTING SCHOOLS
-- ==============================================================================

-- Seed default categories for existing schools
INSERT INTO public.good_deed_categories (school_id, name, default_marks, default_merit_points)
SELECT
  s.id,
  unnest(ARRAY[
    'Helped a classmate',
    'Honesty (returned lost item)',
    'Cleanliness & order',
    'Leadership',
    'Academic achievement',
    'Sports / arts achievement',
    'Community service',
    'Most improved behaviour',
    'Respect & politeness'
  ]),
  1,
  1
FROM public.schools s
WHERE NOT EXISTS (
  SELECT 1 FROM public.good_deed_categories WHERE school_id = s.id
)
ON CONFLICT (school_id, name) DO NOTHING;

-- Function to seed good deed categories for new schools
CREATE OR REPLACE FUNCTION public.seed_good_deed_categories_for_school(school_uuid uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.good_deed_categories (school_id, name, default_marks, default_merit_points)
  VALUES
    (school_uuid, 'Helped a classmate', 1, 1),
    (school_uuid, 'Honesty (returned lost item)', 1, 1),
    (school_uuid, 'Cleanliness & order', 1, 1),
    (school_uuid, 'Leadership', 1, 1),
    (school_uuid, 'Academic achievement', 1, 1),
    (school_uuid, 'Sports / arts achievement', 1, 1),
    (school_uuid, 'Community service', 1, 1),
    (school_uuid, 'Most improved behaviour', 1, 1),
    (school_uuid, 'Respect & politeness', 1, 1)
  ON CONFLICT (school_id, name) DO NOTHING;
END $$;

REVOKE EXECUTE ON FUNCTION public.seed_good_deed_categories_for_school(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seed_good_deed_categories_for_school(uuid) TO authenticated, service_role;

-- ==============================================================================
-- 4. ADD GOOD_DEED_REWARD TO SCHOOL_SETTINGS
-- ==============================================================================

ALTER TABLE public.school_settings ADD COLUMN IF NOT EXISTS good_deed_reward text DEFAULT 'restore_marks';
ALTER TABLE public.school_settings DROP CONSTRAINT IF EXISTS school_settings_good_deed_reward_check;
ALTER TABLE public.school_settings ADD CONSTRAINT school_settings_good_deed_reward_check
  CHECK (good_deed_reward IN ('recognition', 'restore_marks', 'merit_points'));

-- ==============================================================================
-- 5. RECREATE STUDENT_CONDUCT_BALANCES VIEW
-- ==============================================================================

DROP VIEW IF EXISTS public.student_conduct_balances;

CREATE VIEW public.student_conduct_balances
WITH (security_invoker = true) AS
SELECT
  s.id AS student_id,
  s.full_name,
  s.admission_no,
  s.class_name,
  s.parent_phone,
  t.id AS term_id,
  t.name AS term_name,
  t.starting_marks,
  -- Marks deducted (from deductions)
  COALESCE(SUM(CASE WHEN cl.entry_type = 'deduction' THEN cl.marks ELSE 0 END), 0) AS marks_deducted,
  -- Marks restored (from restorations + good deeds that restore marks)
  COALESCE(SUM(CASE WHEN cl.entry_type = 'restoration' THEN cl.marks ELSE 0 END), 0) +
  COALESCE(SUM(CASE WHEN cl.entry_type = 'good_deed' THEN cl.marks ELSE 0 END), 0) AS marks_restored,
  -- Current marks (capped between 0 and starting_marks)
  LEAST(
    t.starting_marks,
    GREATEST(
      0,
      t.starting_marks -
      COALESCE(SUM(CASE WHEN cl.entry_type = 'deduction' THEN cl.marks ELSE 0 END), 0) +
      COALESCE(SUM(CASE WHEN cl.entry_type = 'restoration' THEN cl.marks ELSE 0 END), 0) +
      COALESCE(SUM(CASE WHEN cl.entry_type = 'good_deed' THEN cl.marks ELSE 0 END), 0)
    )
  ) AS current_marks,
  -- Total entries
  COUNT(cl.id) AS entries_count,
  -- Good deeds count
  COALESCE(SUM(CASE WHEN cl.entry_type = 'good_deed' THEN 1 ELSE 0 END), 0) AS good_deeds_count,
  -- Merit points total
  COALESCE(SUM(cl.merit_points), 0) AS merit_points
FROM public.students s
CROSS JOIN public.academic_terms t
LEFT JOIN public.conduct_logs cl
  ON cl.student_id = s.id
  AND cl.term_id = t.id
  AND cl.school_id = s.school_id
WHERE t.is_active = true
  AND s.school_id = t.school_id
GROUP BY s.id, s.full_name, s.admission_no, s.class_name, s.parent_phone, t.id, t.name, t.starting_marks;

-- Grants for the view
GRANT SELECT ON public.student_conduct_balances TO authenticated;

-- ==============================================================================
-- 6. AUDIT LOGGING FOR GOOD DEEDS
-- ==============================================================================

-- Good deeds are logged by the app when creating entries
-- The existing audit_logs table and triggers handle this
-- No additional triggers needed here

-- ==============================================================================
-- COMPLETION
-- ==============================================================================

-- The migration is complete. The app must implement fallbacks for missing columns:
-- - good_deed_category_id, merit_points in conduct_logs
-- - good_deed_reward in school_settings
-- - good_deeds_count, merit_points in student_conduct_balances view
