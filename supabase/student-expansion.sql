-- SCDMS: guardian records, notification preferences and academic progression.
-- Run manually when ready. Idempotent; does NOT touch roles or existing data.
-- The app works before this is applied (new fields are skipped with a warning).

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS father_name text,
  ADD COLUMN IF NOT EXISTS mother_name text,
  ADD COLUMN IF NOT EXISTS guardian_email text,
  ADD COLUMN IF NOT EXISTS notification_channel text NOT NULL DEFAULT 'sms',
  ADD COLUMN IF NOT EXISTS primary_contact text NOT NULL DEFAULT 'guardian',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS academic_year text;

DO $$ BEGIN
  ALTER TABLE public.students ADD CONSTRAINT students_notification_channel_chk
    CHECK (notification_channel IN ('sms','email','both'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.students ADD CONSTRAINT students_primary_contact_chk
    CHECK (primary_contact IN ('father','mother','guardian'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.students ADD CONSTRAINT students_status_chk
    CHECK (status IN ('active','repeating','graduated'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Existing inactive students keep their state; graduates are inactive.
UPDATE public.students SET status = 'active' WHERE status IS NULL;

-- Search / filter performance for 600+ students.
CREATE INDEX IF NOT EXISTS students_class_level_stream_idx ON public.students (class_level, stream);
CREATE INDEX IF NOT EXISTS students_status_idx ON public.students (status);
CREATE INDEX IF NOT EXISTS students_full_name_idx ON public.students (full_name);
