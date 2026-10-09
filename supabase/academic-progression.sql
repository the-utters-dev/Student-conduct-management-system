-- SCDMS: academic history + atomic year-end rollover. Run manually; idempotent.
-- Additive only: no existing tables, columns, roles or data are removed.
-- Requires supabase/student-expansion.sql (status, academic_year columns).

ALTER TABLE public.students ADD COLUMN IF NOT EXISTS grade_level text;
UPDATE public.students SET grade_level = class_level WHERE grade_level IS NULL AND class_level IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.student_academic_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  academic_year text NOT NULL,
  grade_level text,
  class_name text,
  status text,
  promoted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.student_academic_history TO authenticated;
GRANT ALL ON public.student_academic_history TO service_role;
ALTER TABLE public.student_academic_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff view academic history" ON public.student_academic_history;
CREATE POLICY "Staff view academic history" ON public.student_academic_history
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
DROP POLICY IF EXISTS "Leaders and admins record history" ON public.student_academic_history;
CREATE POLICY "Leaders and admins record history" ON public.student_academic_history
  FOR INSERT TO authenticated WITH CHECK (
    public.has_role(auth.uid(),'school_leader') OR public.has_role(auth.uid(),'system_admin'));
CREATE INDEX IF NOT EXISTS sah_student_idx ON public.student_academic_history (student_id, academic_year);

-- p_items: [{ "student_id": uuid, "action": "promote"|"repeat"|"graduate",
--             "grade_level": "S2", "class_name": "S2 A" }]
CREATE OR REPLACE FUNCTION public.promote_students_batch(p_from_year text, p_to_year text, p_items jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE it jsonb; n integer := 0;
BEGIN
  IF NOT (public.has_role(auth.uid(),'school_leader') OR public.has_role(auth.uid(),'system_admin')) THEN
    RAISE EXCEPTION 'Only school leaders or administrators can run the rollover';
  END IF;
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO public.student_academic_history (student_id, academic_year, grade_level, class_name, status)
    SELECT id, p_from_year, COALESCE(grade_level, class_level), class_name, status
    FROM public.students WHERE id = (it->>'student_id')::uuid;

    UPDATE public.students SET
      academic_year = p_to_year,
      grade_level = COALESCE(it->>'grade_level', grade_level),
      class_level = COALESCE(it->>'grade_level', class_level),
      class_name  = COALESCE(it->>'class_name', class_name),
      status = CASE it->>'action' WHEN 'graduate' THEN 'graduated' WHEN 'repeat' THEN 'repeating' ELSE 'active' END,
      is_active = (it->>'action') <> 'graduate'
    WHERE id = (it->>'student_id')::uuid;
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION public.promote_students_batch(text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.promote_students_batch(text, text, jsonb) TO authenticated;
