-- C1: Certificate Studio — Database Schema
-- Idempotent script for certificate templates, issued certificates, and branding storage.
-- Safe to run multiple times. DO NOT run this script — Wix will run it manually.

-- =============================================================================
-- STORAGE BUCKET FOR SCHOOL BRANDING (signatures, stamps)
-- =============================================================================

DO $$
BEGIN
  -- Create private bucket for school signatures and stamps
  INSERT INTO storage.buckets (id, name, public)
  VALUES ('school-branding', 'school-branding', false)
  ON CONFLICT (id) DO NOTHING;
END $$;

-- Storage policies for school-branding bucket
-- Only authenticated users from the same school can read
-- Only School Directors can upload/update
DROP POLICY IF EXISTS "School staff can read own school branding" ON storage.objects;
CREATE POLICY "School staff can read own school branding"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'school-branding'
  AND (
    -- Extract school_id from path (format: school_id/filename)
    (storage.foldername(name))[1] = (SELECT school_id::text FROM public.profiles WHERE id = auth.uid())
    OR public.is_platform_admin(auth.uid())
  )
);

DROP POLICY IF EXISTS "School directors can upload branding" ON storage.objects;
CREATE POLICY "School directors can upload branding"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'school-branding'
  AND (
    public.is_school_director(auth.uid())
    OR public.is_platform_admin(auth.uid())
  )
  AND (storage.foldername(name))[1] = (SELECT school_id::text FROM public.profiles WHERE id = auth.uid())
);

DROP POLICY IF EXISTS "School directors can update branding" ON storage.objects;
CREATE POLICY "School directors can update branding"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'school-branding'
  AND (
    public.is_school_director(auth.uid())
    OR public.is_platform_admin(auth.uid())
  )
  AND (storage.foldername(name))[1] = (SELECT school_id::text FROM public.profiles WHERE id = auth.uid())
);

DROP POLICY IF EXISTS "School directors can delete branding" ON storage.objects;
CREATE POLICY "School directors can delete branding"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'school-branding'
  AND (
    public.is_school_director(auth.uid())
    OR public.is_platform_admin(auth.uid())
  )
  AND (storage.foldername(name))[1] = (SELECT school_id::text FROM public.profiles WHERE id = auth.uid())
);

-- =============================================================================
-- EXTEND SCHOOL_SETTINGS WITH CERTIFICATE FIELDS
-- =============================================================================

-- Add signature, stamp, and director info to school_settings
DO $$
BEGIN
  -- Signature path (storage path to PNG with transparent background)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'school_settings'
      AND column_name = 'signature_path'
  ) THEN
    ALTER TABLE public.school_settings
    ADD COLUMN signature_path text;
  END IF;

  -- Stamp path (storage path to PNG/scan)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'school_settings'
      AND column_name = 'stamp_path'
  ) THEN
    ALTER TABLE public.school_settings
    ADD COLUMN stamp_path text;
  END IF;

  -- Director name (for certificate signature line)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'school_settings'
      AND column_name = 'director_name'
  ) THEN
    ALTER TABLE public.school_settings
    ADD COLUMN director_name text;
  END IF;

  -- Director title (e.g., "School Director", "Principal")
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'school_settings'
      AND column_name = 'director_title'
  ) THEN
    ALTER TABLE public.school_settings
    ADD COLUMN director_title text DEFAULT 'School Director';
  END IF;

  -- Signature last updated timestamp
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'school_settings'
      AND column_name = 'signature_updated_at'
  ) THEN
    ALTER TABLE public.school_settings
    ADD COLUMN signature_updated_at timestamptz;
  END IF;

  -- Signature last updated by (user_id)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'school_settings'
      AND column_name = 'signature_updated_by'
  ) THEN
    ALTER TABLE public.school_settings
    ADD COLUMN signature_updated_by uuid REFERENCES auth.users(id);
  END IF;
END $$;

COMMENT ON COLUMN public.school_settings.signature_path IS 'Storage path to director signature (PNG with transparent background)';
COMMENT ON COLUMN public.school_settings.stamp_path IS 'Storage path to school stamp/seal (PNG)';
COMMENT ON COLUMN public.school_settings.director_name IS 'Full name of the director for certificate signatures';
COMMENT ON COLUMN public.school_settings.director_title IS 'Title of the director (e.g., School Director, Principal)';

-- =============================================================================
-- CERTIFICATE TEMPLATES
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.certificate_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE DEFAULT public.current_school_id(),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('good_deed', 'student_of_period', 'graduation', 'custom')),
  title text NOT NULL,
  body text NOT NULL,
  accent_color text NOT NULL DEFAULT '#3b82f6',
  border_style text NOT NULL DEFAULT 'classic' CHECK (border_style IN ('classic', 'modern', 'minimal')),
  orientation text NOT NULL DEFAULT 'landscape' CHECK (orientation IN ('landscape', 'portrait')),
  show_signature boolean NOT NULL DEFAULT true,
  show_stamp boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),

  UNIQUE (school_id, name)
);

COMMENT ON TABLE public.certificate_templates IS 'Certificate templates for each school';
COMMENT ON COLUMN public.certificate_templates.kind IS 'Type of certificate: good_deed, student_of_period, graduation, or custom';
COMMENT ON COLUMN public.certificate_templates.title IS 'Certificate title (supports placeholders)';
COMMENT ON COLUMN public.certificate_templates.body IS 'Certificate body text (supports placeholders like {student_name}, {class}, etc.)';
COMMENT ON COLUMN public.certificate_templates.accent_color IS 'Hex color for certificate accents';
COMMENT ON COLUMN public.certificate_templates.border_style IS 'Visual style: classic (double border), modern (gradient), minimal (simple line)';

-- Enable RLS
ALTER TABLE public.certificate_templates ENABLE ROW LEVEL SECURITY;

-- RLS policy: Same school only
DROP POLICY IF EXISTS "Same school only" ON public.certificate_templates;
CREATE POLICY "Same school only"
ON public.certificate_templates
AS RESTRICTIVE
TO authenticated
USING (
  public.is_platform_admin(auth.uid())
  OR (school_id = public.current_school_id() AND public.school_is_active(school_id))
);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS set_updated_at_certificate_templates ON public.certificate_templates;
CREATE TRIGGER set_updated_at_certificate_templates
  BEFORE UPDATE ON public.certificate_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- ISSUED CERTIFICATES REGISTER
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.issued_certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE DEFAULT public.current_school_id(),
  template_id uuid NOT NULL REFERENCES public.certificate_templates(id) ON DELETE RESTRICT,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE RESTRICT,
  conduct_log_id uuid REFERENCES public.conduct_logs(id) ON DELETE SET NULL,
  serial_no text NOT NULL,
  verification_code text NOT NULL,
  issued_by uuid NOT NULL REFERENCES auth.users(id),
  issued_at timestamptz NOT NULL DEFAULT now(),
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id),
  revocation_reason text,

  UNIQUE (serial_no),
  UNIQUE (verification_code),
  CONSTRAINT valid_serial CHECK (serial_no ~ '^[A-Z0-9-]{10,}$')
);

COMMENT ON TABLE public.issued_certificates IS 'Register of all issued certificates with verification codes';
COMMENT ON COLUMN public.issued_certificates.serial_no IS 'Unique serial number (e.g., EPN-2026-000123)';
COMMENT ON COLUMN public.issued_certificates.verification_code IS 'Random code for QR verification (12+ characters)';
COMMENT ON COLUMN public.issued_certificates.data IS 'Snapshot of certificate data at issue time (student name, template, etc.)';
COMMENT ON COLUMN public.issued_certificates.revoked_at IS 'When the certificate was revoked (null = valid)';

-- Enable RLS
ALTER TABLE public.issued_certificates ENABLE ROW LEVEL SECURITY;

-- RLS policy: Same school only
DROP POLICY IF EXISTS "Same school only" ON public.issued_certificates;
CREATE POLICY "Same school only"
ON public.issued_certificates
AS RESTRICTIVE
TO authenticated
USING (
  public.is_platform_admin(auth.uid())
  OR (school_id = public.current_school_id() AND public.school_is_active(school_id))
);

-- Trigger for updated_at (if we add it later)
-- CREATE TRIGGER set_updated_at_issued_certificates
--   BEFORE UPDATE ON public.issued_certificates
--   FOR EACH ROW
--   EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- HELPER FUNCTIONS FOR CERTIFICATE OPERATIONS
-- =============================================================================

-- Generate next serial number for a school
CREATE OR REPLACE FUNCTION public.generate_certificate_serial(
  _school_id uuid,
  _prefix text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  school_prefix text;
  year_part text;
  next_num integer;
  serial text;
BEGIN
  -- Get school's abbreviation or use provided prefix
  IF _prefix IS NULL THEN
    SELECT COALESCE(
      (SELECT LEFT(UPPER(REGEXP_REPLACE(school_name, '[^A-Z0-9]', '', 'g')), 3)
       FROM public.school_settings WHERE school_id = _school_id),
      'SCH'
    ) INTO school_prefix;
  ELSE
    school_prefix := _prefix;
  END IF;

  -- Year part
  year_part := EXTRACT(YEAR FROM now())::text;

  -- Get next number for this school and year
  SELECT COALESCE(MAX(
    NULLIF(REGEXP_REPLACE(
      serial_no,
      '^' || school_prefix || '-' || year_part || '-',
      ''
    ), '')::integer
  ), 0) + 1
  INTO next_num
  FROM public.issued_certificates
  WHERE school_id = _school_id
    AND serial_no LIKE school_prefix || '-' || year_part || '-%';

  -- Format: PREFIX-YYYY-NNNNNN
  serial := school_prefix || '-' || year_part || '-' || LPAD(next_num::text, 6, '0');

  RETURN serial;
END;
$$;

COMMENT ON FUNCTION public.generate_certificate_serial IS 'Generate next unique serial number for certificates';

-- Generate random verification code
CREATE OR REPLACE FUNCTION public.generate_verification_code()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- Exclude ambiguous chars
  code text := '';
  i integer;
BEGIN
  FOR i IN 1..12 LOOP
    code := code || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
  END LOOP;
  RETURN code;
END;
$$;

COMMENT ON FUNCTION public.generate_verification_code IS 'Generate random 12-character verification code for QR codes';

-- Check certificate validity (public function for verification page)
CREATE OR REPLACE FUNCTION public.verify_certificate(_verification_code text)
RETURNS TABLE (
  is_valid boolean,
  school_name text,
  student_name text,
  certificate_title text,
  issued_date timestamptz,
  status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    (ic.revoked_at IS NULL) AS is_valid,
    (ic.data->>'school_name')::text AS school_name,
    (ic.data->>'student_name')::text AS student_name,
    (ic.data->>'certificate_title')::text AS certificate_title,
    ic.issued_at,
    CASE
      WHEN ic.revoked_at IS NOT NULL THEN 'revoked'
      ELSE 'valid'
    END AS status
  FROM public.issued_certificates ic
  WHERE ic.verification_code = _verification_code;

  -- Return empty row with is_valid = false if not found
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, null::text, null::text, null::text, null::timestamptz, 'not_found'::text;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.verify_certificate IS 'Public function to verify certificate by code (returns limited info)';

-- Grant public access to verify function
REVOKE EXECUTE ON FUNCTION public.verify_certificate(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_certificate(text) TO anon, authenticated;

-- Grant authenticated access to serial generator
GRANT EXECUTE ON FUNCTION public.generate_certificate_serial(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.generate_verification_code() TO authenticated, service_role;

-- =============================================================================
-- SEED DEFAULT TEMPLATES FOR EXISTING SCHOOLS
-- =============================================================================

-- Seed 3 default templates for each school that doesn't have templates yet
DO $$
DECLARE
  school_rec RECORD;
BEGIN
  FOR school_rec IN SELECT id FROM public.schools WHERE status = 'active' LOOP
    -- Check if school already has templates
    IF NOT EXISTS (SELECT 1 FROM public.certificate_templates WHERE school_id = school_rec.id) THEN
      -- Insert 3 default templates
      INSERT INTO public.certificate_templates (school_id, name, kind, title, body, accent_color, border_style, show_signature, show_stamp)
      VALUES
        (
          school_rec.id,
          'Certificate of Good Conduct',
          'good_deed',
          'Certificate of Good Conduct',
          E'This is to certify that\n\n{student_name}\n\nof {class}\n\nhas been recognised for demonstrating\n\n{category}\n\non {date}\n\nThis certificate is awarded in recognition of exemplary conduct and positive behaviour. We commend this student for their outstanding character and encourage them to continue setting a positive example for their peers.',
          '#10b981',
          'classic',
          true,
          true
        ),
        (
          school_rec.id,
          'Student of the Month',
          'student_of_period',
          'Student of the Month',
          E'This is to certify that\n\n{student_name}\n\nof {class}\n\nhas been awarded Student of the Month for {term}\n\nConducted Score: {conduct_score}/{max_marks}\n\nThis student has demonstrated exceptional conduct, leadership, and positive behaviour throughout the period. They serve as an outstanding role model for their peers.',
          '#3b82f6',
          'modern',
          true,
          true
        ),
        (
          school_rec.id,
          'S6 Graduation — Certificate of Exemplary Conduct',
          'graduation',
          'Certificate of Exemplary Conduct',
          E'This is to certify that\n\n{student_name}\n\nAdmission No: {admission_no}\n\nhas completed Senior Six ({academic_year}) at {school_name} with exemplary conduct and discipline.\n\nFinal Conduct Score: {conduct_score}/{max_marks}\n\nThis student has maintained outstanding behaviour throughout their time at our school and is commended for their integrity, respect, and positive influence on the school community.',
          '#8b5cf6',
          'classic',
          true,
          true
        );
    END IF;
  END LOOP;
END $$;

-- =============================================================================
-- SUMMARY
-- =============================================================================
-- This script creates:
-- 1. Storage bucket 'school-branding' (private) with RLS policies
-- 2. Extended school_settings with signature_path, stamp_path, director_name, director_title
-- 3. certificate_templates table (school-owned, RLS enabled)
-- 4. issued_certificates table (register of all issued certificates with QR codes)
-- 5. Helper functions: generate_certificate_serial, generate_verification_code, verify_certificate
-- 6. Seeds 3 default templates for each active school
--
-- Safe to run multiple times (idempotent). All operations use IF NOT EXISTS or ON CONFLICT DO NOTHING.
