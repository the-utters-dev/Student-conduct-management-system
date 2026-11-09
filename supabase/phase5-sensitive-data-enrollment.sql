-- Phase 5: sensitive student data and verifiable enrollment documents.
-- Run manually in the Supabase SQL editor. Safe to run more than once.
-- Requires the multi-tenant, role, academic-term, and certificate-branding foundations.

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS sensitive_notes text,
  ADD COLUMN IF NOT EXISTS grade_level text;

UPDATE public.students
SET grade_level = class_level
WHERE grade_level IS NULL
  AND class_level IS NOT NULL;

ALTER TABLE public.school_settings
  ADD COLUMN IF NOT EXISTS contact_email text;

-- Existing role settings remain intact; a missing toggle is always treated as false.
UPDATE public.school_settings
SET permissions =
  COALESCE(permissions, '{}'::jsonb)
  || jsonb_build_object(
    'master_of_discipline',
    COALESCE(permissions -> 'master_of_discipline', '{}'::jsonb)
      || jsonb_build_object(
        'can_view_sensitive_data',
        COALESCE(permissions #> '{master_of_discipline,can_view_sensitive_data}', 'false'::jsonb)
      ),
    'matron',
    COALESCE(permissions -> 'matron', '{}'::jsonb)
      || jsonb_build_object(
        'can_view_sensitive_data',
        COALESCE(permissions #> '{matron,can_view_sensitive_data}', 'false'::jsonb)
      ),
    'patron',
    COALESCE(permissions -> 'patron', '{}'::jsonb)
      || jsonb_build_object(
        'can_view_sensitive_data',
        COALESCE(permissions #> '{patron,can_view_sensitive_data}', 'false'::jsonb)
      )
  );

-- PostgreSQL has no column-scoped RLS. Remove table-level SELECT, INSERT,
-- and UPDATE and grant every existing student column except
-- sensitive_notes. Authorized access to the private column is only through the
-- permission-checked RPCs below.
REVOKE SELECT, INSERT, UPDATE ON TABLE public.students FROM PUBLIC, anon, authenticated;
REVOKE SELECT (sensitive_notes), INSERT (sensitive_notes), UPDATE (sensitive_notes)
  ON TABLE public.students FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  selectable_columns text;
BEGIN
  SELECT string_agg(format('%I', column_name), ', ' ORDER BY ordinal_position)
  INTO selectable_columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'students'
    AND column_name <> 'sensitive_notes';

  IF selectable_columns IS NOT NULL THEN
    EXECUTE format(
      'GRANT SELECT (%s) ON TABLE public.students TO authenticated',
      selectable_columns
    );
    EXECUTE format(
      'GRANT INSERT (%s) ON TABLE public.students TO authenticated',
      selectable_columns
    );
    EXECUTE format(
      'GRANT UPDATE (%s) ON TABLE public.students TO authenticated',
      selectable_columns
    );
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.get_student_sensitive_notes(_student_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  student_school_id uuid;
  notes text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;

  IF NOT (
    public.is_platform_admin(auth.uid())
    OR public.is_school_director(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.profiles AS p
      JOIN public.user_roles AS ur ON ur.user_id = p.id
      JOIN public.school_settings AS ss ON ss.school_id = p.school_id
      WHERE p.id = auth.uid()
        AND ur.role IN ('master_of_discipline', 'matron', 'patron')
        AND COALESCE(
          (ss.permissions #>> ARRAY[ur.role::text, 'can_view_sensitive_data'])::boolean,
          false
        )
    )
  ) THEN
    RAISE EXCEPTION 'You do not have permission to view confidential student notes';
  END IF;

  SELECT s.school_id
  INTO student_school_id
  FROM public.students AS s
  WHERE s.id = _student_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student not found';
  END IF;

  IF NOT public.is_platform_admin(auth.uid())
     AND (student_school_id IS NULL
       OR student_school_id <> public.current_school_id()
       OR NOT public.school_is_active(student_school_id)
       OR NOT public.can_access_student(_student_id)) THEN
    RAISE EXCEPTION 'Access denied for this school';
  END IF;

  SELECT s.sensitive_notes INTO notes
  FROM public.students AS s
  WHERE s.id = _student_id;

  RETURN notes;
END
$$;

REVOKE EXECUTE ON FUNCTION public.get_student_sensitive_notes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_student_sensitive_notes(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_student_sensitive_notes(
  _student_id uuid,
  _sensitive_notes text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  student_school_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;

  IF NOT (
    public.is_platform_admin(auth.uid())
    OR public.is_school_director(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.profiles AS p
      JOIN public.user_roles AS ur ON ur.user_id = p.id
      JOIN public.school_settings AS ss ON ss.school_id = p.school_id
      WHERE p.id = auth.uid()
        AND ur.role IN ('master_of_discipline', 'matron', 'patron')
        AND COALESCE(
          (ss.permissions #>> ARRAY[ur.role::text, 'can_view_sensitive_data'])::boolean,
          false
        )
    )
  ) THEN
    RAISE EXCEPTION 'You do not have permission to update confidential student notes';
  END IF;

  SELECT s.school_id INTO student_school_id
  FROM public.students AS s
  WHERE s.id = _student_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student not found';
  END IF;

  IF NOT public.is_platform_admin(auth.uid())
     AND (student_school_id IS NULL
       OR student_school_id <> public.current_school_id()
       OR NOT public.school_is_active(student_school_id)
       OR NOT public.can_access_student(_student_id)) THEN
    RAISE EXCEPTION 'Access denied for this school';
  END IF;

  UPDATE public.students
  SET sensitive_notes = _sensitive_notes
  WHERE id = _student_id;
END
$$;

REVOKE EXECUTE ON FUNCTION public.set_student_sensitive_notes(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_student_sensitive_notes(uuid, text) TO authenticated;

CREATE TABLE IF NOT EXISTS public.student_enrollment_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_code uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
  student_id uuid REFERENCES public.students(id) ON DELETE SET NULL,
  snapshot jsonb NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS student_enrollment_documents_school_created_idx
  ON public.student_enrollment_documents (school_id, created_at DESC);

ALTER TABLE public.student_enrollment_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Same school only" ON public.student_enrollment_documents;
CREATE POLICY "Same school only"
  ON public.student_enrollment_documents
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.is_platform_admin(auth.uid())
    OR (
      school_id = public.current_school_id()
      AND public.school_is_active(school_id)
    )
  )
  WITH CHECK (
    public.is_platform_admin(auth.uid())
    OR (
      school_id = public.current_school_id()
      AND public.school_is_active(school_id)
    )
  );

DROP POLICY IF EXISTS "School staff can view enrollment documents" ON public.student_enrollment_documents;
CREATE POLICY "School staff can view enrollment documents"
  ON public.student_enrollment_documents
  FOR SELECT TO authenticated
  USING (
    public.is_platform_admin(auth.uid())
    OR (
      public.is_staff(auth.uid())
      AND school_id = public.current_school_id()
      AND public.school_is_active(school_id)
    )
  );

REVOKE ALL ON TABLE public.student_enrollment_documents FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.student_enrollment_documents TO authenticated;
GRANT ALL ON TABLE public.student_enrollment_documents TO service_role;

CREATE OR REPLACE FUNCTION public.create_student_enrollment_document(_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  student_school_id uuid;
  target_student_id uuid;
  student_admission_no text;
  student_full_name text;
  student_class_name text;
  student_grade_level text;
  student_class_level text;
  settings_row public.school_settings%ROWTYPE;
  school_row public.schools%ROWTYPE;
  caller_school_id uuid;
  current_score integer;
  conduct_status text;
  doc_code uuid := gen_random_uuid();
  generated_at timestamptz := now();
  document_snapshot jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;

  IF NOT public.is_platform_admin(auth.uid()) AND NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Only school staff can generate enrollment documents';
  END IF;

  SELECT
    s.school_id,
    s.id,
    s.admission_no,
    s.full_name,
    s.class_name,
    s.grade_level,
    s.class_level
  INTO
    student_school_id,
    target_student_id,
    student_admission_no,
    student_full_name,
    student_class_name,
    student_grade_level,
    student_class_level
  FROM public.students AS s
  WHERE s.id = _student_id;

  IF NOT FOUND OR student_school_id IS NULL THEN
    RAISE EXCEPTION 'Student not found in a school';
  END IF;

  caller_school_id := public.current_school_id();
  IF NOT public.is_platform_admin(auth.uid())
     AND (
       student_school_id <> caller_school_id
       OR NOT public.school_is_active(student_school_id)
       OR NOT public.can_access_student(_student_id)
     ) THEN
    RAISE EXCEPTION 'Access denied for this school';
  END IF;

  SELECT ss.* INTO settings_row
  FROM public.school_settings AS ss
  WHERE ss.school_id = student_school_id;

  SELECT sc.* INTO school_row
  FROM public.schools AS sc
  WHERE sc.id = student_school_id;

  SELECT b.current_marks INTO current_score
  FROM public.student_conduct_balances AS b
  WHERE b.student_id = target_student_id
  LIMIT 1;

  IF current_score IS NULL THEN
    conduct_status := 'No active term';
  ELSIF current_score <= COALESCE(settings_row.critical_threshold, 20) THEN
    conduct_status := 'Critical';
  ELSIF current_score <= COALESCE(settings_row.warning_threshold, 30) THEN
    conduct_status := 'Warning';
  ELSE
    conduct_status := 'Good standing';
  END IF;

  document_snapshot := jsonb_build_object(
    'doc_code', doc_code,
    'generated_at', generated_at,
    'school_id', student_school_id,
    'school_name', COALESCE(settings_row.school_name, school_row.name),
    'school_email', settings_row.contact_email,
    'school_logo_url', settings_row.logo_url,
    'director_name', settings_row.director_name,
    'director_title', settings_row.director_title,
    'signature_path', settings_row.signature_path,
    'stamp_path', settings_row.stamp_path,
    'student_id', target_student_id,
    'full_name', student_full_name,
    'admission_no', student_admission_no,
    'class_name', student_class_name,
    'academic_grade', COALESCE(student_grade_level, student_class_level),
    'current_conduct_score', current_score,
    'conduct_status', conduct_status
  );

  INSERT INTO public.student_enrollment_documents (
    doc_code,
    school_id,
    target_student_id,
    snapshot,
    created_by,
    created_at
  )
  VALUES (
    doc_code,
    student_school_id,
    target_student_id,
    document_snapshot,
    auth.uid(),
    generated_at
  );

  RETURN document_snapshot;
END
$$;

REVOKE EXECUTE ON FUNCTION public.create_student_enrollment_document(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_student_enrollment_document(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.verify_student_enrollment_document(_doc_code uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT (d.snapshot - 'signature_path' - 'stamp_path' - 'school_id' - 'student_id')
    || jsonb_build_object('is_valid', true)
  FROM public.student_enrollment_documents AS d
  WHERE d.doc_code = _doc_code
  LIMIT 1
$$;

REVOKE EXECUTE ON FUNCTION public.verify_student_enrollment_document(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_student_enrollment_document(uuid) TO anon, authenticated;

COMMENT ON COLUMN public.students.sensitive_notes IS
  'Confidential health, emergency treatment, and special-care information; use permission-checked RPCs to access.';
COMMENT ON TABLE public.student_enrollment_documents IS
  'Immutable enrollment document snapshots with unguessable public verification codes.';
