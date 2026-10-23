-- N1 Bug Fixes and Enhancements
-- Run manually in Supabase SQL editor.
-- Idempotent (safe to run twice).
--
-- SUMMARY:
-- 1. Update conduct-evidence bucket to allow WEBP and support all discipline roles + platform admins
-- 2. Add school logo storage bucket (public)
-- 3. Add maximum conduct marks setting to school_settings
-- 4. Add good deed reward type setting to school_settings
--
-- ==============================================================================
-- 1. UPDATE CONDUCT-EVIDENCE BUCKET
-- ==============================================================================

-- Update bucket to allow WEBP (in addition to JPEG/PNG)
-- The app converts all uploads to JPEG, but this allows flexibility
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'conduct-evidence',
  'conduct-evidence',
  false,
  5242880,  -- 5 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- Update upload policy to include all discipline roles + platform admins
DROP POLICY IF EXISTS "n1 evidence upload" ON storage.objects;
CREATE POLICY "n1 evidence upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'conduct-evidence'
    AND (
      public.is_platform_admin(auth.uid())
      OR (
        public.is_discipline_staff(auth.uid())
        AND (storage.foldername(name))[1] = public.current_school_id()::text
      )
    )
  );

-- Update read policy to include platform admins
DROP POLICY IF EXISTS "n1 evidence read" ON storage.objects;
CREATE POLICY "n1 evidence read"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'conduct-evidence'
    AND (
      public.is_platform_admin(auth.uid())
      OR (
        public.is_staff(auth.uid())
        AND (storage.foldername(name))[1] = public.current_school_id()::text
      )
    )
  );


-- ==============================================================================
-- 2. SCHOOL LOGO STORAGE BUCKET
-- ==============================================================================

-- Create public bucket for school logos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'school-logos',
  'school-logos',
  true,  -- Public bucket (logos shown on login, certificates, etc.)
  2097152,  -- 2 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = true,
    file_size_limit = 2097152,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- Policy: Anyone can read logos (public bucket)
DROP POLICY IF EXISTS "n1 logos read" ON storage.objects;
CREATE POLICY "n1 logos read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'school-logos');

-- Policy: School Directors can upload/update/delete their school's logo
DROP POLICY IF EXISTS "n1 logos write" ON storage.objects;
CREATE POLICY "n1 logos write"
  ON storage.objects FOR ALL TO authenticated
  USING (
    bucket_id = 'school-logos'
    AND (
      public.is_platform_admin(auth.uid())
      OR (
        public.is_school_director(auth.uid())
        AND (storage.foldername(name))[1] = public.current_school_id()::text
      )
    )
  )
  WITH CHECK (
    bucket_id = 'school-logos'
    AND (
      public.is_platform_admin(auth.uid())
      OR (
        public.is_school_director(auth.uid())
        AND (storage.foldername(name))[1] = public.current_school_id()::text
      )
    )
  );


-- ==============================================================================
-- 3. MAXIMUM CONDUCT MARKS SETTING
-- ==============================================================================

-- Add logo_url and max_conduct_marks columns to school_settings
ALTER TABLE public.school_settings
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS max_conduct_marks integer DEFAULT 40 CHECK (max_conduct_marks >= 10 AND max_conduct_marks <= 200);

COMMENT ON COLUMN public.school_settings.logo_url IS 'Public URL of the school logo (stored in school-logos bucket)';
COMMENT ON COLUMN public.school_settings.max_conduct_marks IS 'Maximum conduct marks per term (10-200, default 40). Students start each term with this balance.';

-- Set default max_conduct_marks for existing schools
UPDATE public.school_settings
SET max_conduct_marks = 40
WHERE max_conduct_marks IS NULL;


-- ==============================================================================
-- 4. GOOD DEED REWARD TYPE SETTING
-- ==============================================================================

-- Add school-level setting for good deed reward type
ALTER TABLE public.school_settings
  ADD COLUMN IF NOT EXISTS good_deed_reward_type text DEFAULT 'recognition' CHECK (good_deed_reward_type IN ('recognition', 'merit_points'));

COMMENT ON COLUMN public.school_settings.good_deed_reward_type IS 'School-wide setting: good deeds give recognition only, or recognition + merit points';

-- Set default for existing schools
UPDATE public.school_settings
SET good_deed_reward_type = 'recognition'
WHERE good_deed_reward_type IS NULL;


-- ==============================================================================
-- COMPLETION
-- ==============================================================================

-- All changes are idempotent and safe to run multiple times.
-- The app must implement fallbacks for:
-- - logo_url, max_conduct_marks, good_deed_reward_type in school_settings
