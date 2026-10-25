-- C2: Certificate Studio — Finish (Real QR, Issuing, Register, Templates, Bulk S6)
-- Idempotent script for completing the certificate system.
-- Safe to run multiple times. DO NOT run this script — Wix will run it manually.
--
-- This script is intentionally minimal because C1 already created the core schema.
-- C2 is primarily UI/frontend work. This script adds any missing helper functions
-- and ensures the schema is production-ready.

-- =============================================================================
-- ENSURE ALL C1 OBJECTS EXIST (Defensive Checks)
-- =============================================================================

-- Verify that certificate_templates table exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'certificate_templates'
  ) THEN
    RAISE EXCEPTION 'certificate_templates table not found. Please run c1-certificates.sql first.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'issued_certificates'
  ) THEN
    RAISE EXCEPTION 'issued_certificates table not found. Please run c1-certificates.sql first.';
  END IF;
END $$;

-- =============================================================================
-- ADDITIONAL HELPER FUNCTIONS (Optional Enhancements)
-- =============================================================================

-- Function to get all issued certificates for a school with student details
-- This is useful for the issued certificates register UI
CREATE OR REPLACE FUNCTION public.get_school_issued_certificates(
  _school_id uuid,
  _limit integer DEFAULT 100,
  _offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  serial_no text,
  verification_code text,
  issued_at timestamptz,
  revoked_at timestamptz,
  revocation_reason text,
  student_name text,
  student_admission_no text,
  template_name text,
  certificate_data jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verify caller belongs to the school (RLS bypass check)
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND school_id = _school_id
  ) AND NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: You do not belong to this school.';
  END IF;

  RETURN QUERY
  SELECT
    ic.id,
    ic.serial_no,
    ic.verification_code,
    ic.issued_at,
    ic.revoked_at,
    ic.revocation_reason,
    (ic.data->>'student_name')::text AS student_name,
    (ic.data->>'admission_no')::text AS student_admission_no,
    ct.name AS template_name,
    ic.data AS certificate_data
  FROM public.issued_certificates ic
  LEFT JOIN public.certificate_templates ct ON ct.id = ic.template_id
  WHERE ic.school_id = _school_id
  ORDER BY ic.issued_at DESC
  LIMIT _limit
  OFFSET _offset;
END;
$$;

COMMENT ON FUNCTION public.get_school_issued_certificates IS 'Retrieve issued certificates for a school (with student and template info)';

GRANT EXECUTE ON FUNCTION public.get_school_issued_certificates(uuid, integer, integer) TO authenticated;

-- =============================================================================
-- INDEX OPTIMIZATIONS FOR CERTIFICATE QUERIES
-- =============================================================================

-- Index for fast lookup by verification code (public verification page)
CREATE INDEX IF NOT EXISTS idx_issued_certificates_verification_code
  ON public.issued_certificates (verification_code)
  WHERE revoked_at IS NULL;

-- Index for fast lookup by serial number (search in register)
CREATE INDEX IF NOT EXISTS idx_issued_certificates_serial_no
  ON public.issued_certificates (serial_no);

-- Index for fast lookup by student (student's certificate history)
CREATE INDEX IF NOT EXISTS idx_issued_certificates_student_id
  ON public.issued_certificates (student_id, issued_at DESC);

-- Index for fast lookup by template (template usage reports)
CREATE INDEX IF NOT EXISTS idx_issued_certificates_template_id
  ON public.issued_certificates (template_id, issued_at DESC);

-- Index for fast lookup of active templates
CREATE INDEX IF NOT EXISTS idx_certificate_templates_active
  ON public.certificate_templates (school_id, is_active, kind)
  WHERE is_active = true;

-- =============================================================================
-- AUDIT TRIGGERS (Optional: Track template changes)
-- =============================================================================

-- Audit log for template edits (useful for compliance/tracking)
CREATE OR REPLACE FUNCTION public.audit_certificate_template_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    INSERT INTO public.audit_logs (
      school_id,
      user_id,
      action,
      entity_type,
      entity_id,
      payload
    )
    VALUES (
      NEW.school_id,
      auth.uid(),
      'UPDATE_CERTIFICATE_TEMPLATE',
      'certificate_template',
      NEW.id,
      jsonb_build_object(
        'old_name', OLD.name,
        'new_name', NEW.name,
        'old_active', OLD.is_active,
        'new_active', NEW.is_active
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_certificate_template_updates ON public.certificate_templates;
CREATE TRIGGER audit_certificate_template_updates
  AFTER UPDATE ON public.certificate_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_certificate_template_changes();

-- =============================================================================
-- VALIDATION: Ensure critical standing check exists (for S6 graduation)
-- =============================================================================

-- Check if critical_standing column exists on students table
-- (This is used for S6 graduation eligibility)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'students'
      AND column_name = 'critical_standing'
  ) THEN
    -- Add critical_standing column if it doesn't exist
    ALTER TABLE public.students
    ADD COLUMN critical_standing boolean DEFAULT false;

    COMMENT ON COLUMN public.students.critical_standing IS 'True if student is on critical standing (excludes from graduation certificates)';
  END IF;
END $$;

-- =============================================================================
-- ENSURE UNIQUENESS CONSTRAINTS ARE CORRECT
-- =============================================================================

-- Verify that serial_no is globally unique (across all schools)
-- This is critical for certificate authenticity
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'issued_certificates_serial_no_key'
      AND table_name = 'issued_certificates'
  ) THEN
    RAISE EXCEPTION 'Missing UNIQUE constraint on serial_no. Please check c1-certificates.sql.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'issued_certificates_verification_code_key'
      AND table_name = 'issued_certificates'
  ) THEN
    RAISE EXCEPTION 'Missing UNIQUE constraint on verification_code. Please check c1-certificates.sql.';
  END IF;
END $$;

-- =============================================================================
-- SUMMARY
-- =============================================================================
-- This script completes the certificate system by:
-- 1. Verifying that C1 schema exists
-- 2. Adding helper function for issued certificates register (get_school_issued_certificates)
-- 3. Creating performance indexes for verification, serial lookup, and student/template queries
-- 4. Adding audit trigger for template changes
-- 5. Ensuring critical_standing column exists on students table (for S6 graduation eligibility)
-- 6. Validating uniqueness constraints on serial_no and verification_code
--
-- The certificate system is now fully operational and production-ready.
-- All QR codes, issuing logic, template editor, and bulk S6 graduation features
-- are implemented in the frontend (TypeScript/React).
--
-- Safe to run multiple times (idempotent).
