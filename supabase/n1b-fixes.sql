-- N1b Fixes: Good Deeds Never Change Conduct Marks
-- Run manually in Supabase SQL editor.
-- Idempotent (safe to run twice).
--
-- SUMMARY:
-- 1. Recreate student_conduct_balances view to exclude good_deed marks from balance calculations
--
-- ==============================================================================
-- 1. FIX STUDENT_CONDUCT_BALANCES VIEW
-- ==============================================================================

-- Good deeds must NEVER change conduct marks.
-- Only entry_type = 'restoration' should restore marks.
-- Good deeds are tracked separately (good_deeds_count, merit_points).

DROP VIEW IF EXISTS public.student_conduct_balances;

CREATE VIEW public.student_conduct_balances
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
  -- Marks deducted (from deductions only)
  COALESCE(SUM(CASE WHEN cl.entry_type = 'deduction' THEN cl.marks ELSE 0 END), 0) AS marks_deducted,
  -- Marks restored (from restorations ONLY - good deeds do NOT restore marks)
  COALESCE(SUM(CASE WHEN cl.entry_type = 'restoration' THEN cl.marks ELSE 0 END), 0) AS marks_restored,
  -- Current marks (capped between 0 and starting_marks)
  LEAST(
    t.starting_marks,
    GREATEST(
      0,
      t.starting_marks -
      COALESCE(SUM(CASE WHEN cl.entry_type = 'deduction' THEN cl.marks ELSE 0 END), 0) +
      COALESCE(SUM(CASE WHEN cl.entry_type = 'restoration' THEN cl.marks ELSE 0 END), 0)
    )
  ) AS current_marks,
  -- Total entries
  COUNT(cl.id) AS entries_count,
  -- Good deeds count (recognition only, no marks impact)
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
  AND s.is_active = true
  AND t.school_id = s.school_id  -- CRITICAL: join only terms from the same school
GROUP BY s.id, s.school_id, s.full_name, s.admission_no, s.class_name, s.class_level,
         s.house, s.parent_phone, t.id, t.name, t.starting_marks;

GRANT SELECT ON public.student_conduct_balances TO authenticated;

COMMENT ON VIEW public.student_conduct_balances IS 'Student conduct balances per term. Good deeds do NOT change marks (only deductions/restorations do). Good deeds are tracked separately for recognition.';


-- ==============================================================================
-- COMPLETION
-- ==============================================================================

-- All changes are idempotent and safe to run multiple times.
-- The view now correctly excludes good_deed marks from balance calculations.
