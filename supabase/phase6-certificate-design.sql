-- Extended certificate design options. Safe to run more than once.
ALTER TABLE public.certificate_templates
  ADD COLUMN IF NOT EXISTS secondary_color text NOT NULL DEFAULT '#b89155',
  ADD COLUMN IF NOT EXISTS header_text text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS show_qr boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS signature_position text NOT NULL DEFAULT 'left',
  ADD COLUMN IF NOT EXISTS stamp_position text NOT NULL DEFAULT 'center',
  ADD COLUMN IF NOT EXISTS qr_position text NOT NULL DEFAULT 'right';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'certificate_templates_signature_position_check'
      AND conrelid = 'public.certificate_templates'::regclass
  ) THEN
    ALTER TABLE public.certificate_templates
      ADD CONSTRAINT certificate_templates_signature_position_check
      CHECK (signature_position IN ('left', 'center', 'right'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'certificate_templates_stamp_position_check'
      AND conrelid = 'public.certificate_templates'::regclass
  ) THEN
    ALTER TABLE public.certificate_templates
      ADD CONSTRAINT certificate_templates_stamp_position_check
      CHECK (stamp_position IN ('left', 'center', 'right'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'certificate_templates_qr_position_check'
      AND conrelid = 'public.certificate_templates'::regclass
  ) THEN
    ALTER TABLE public.certificate_templates
      ADD CONSTRAINT certificate_templates_qr_position_check
      CHECK (qr_position IN ('left', 'center', 'right'));
  END IF;
END
$$;

COMMENT ON COLUMN public.certificate_templates.secondary_color IS 'Secondary accent color for the certificate design';
COMMENT ON COLUMN public.certificate_templates.header_text IS 'Custom school or certificate header text';
