-- N1 Bug Fixes and Enhancements
-- Run manually in Supabase SQL editor.
-- Idempotent (safe to run twice).
--
-- SUMMARY:
-- 1. Update conduct-evidence bucket to allow WEBP and support all discipline roles + platform admins
-- 2. Add school logo storage bucket (public)
-- 3. Add maximum conduct marks setting to school_settings
-- 4. Convert good deeds to recognition-only (no marks restoration)
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
DROP POLICY IF EXISTS "Discipline staff upload school conduct evidence" ON storage.objects;
CREATE POLICY "Discipline staff upload school conduct evidence"
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
DROP POLICY IF EXISTS "Staff read school conduct evidence" ON storage.objects;
CREATE POLICY "Staff read school conduct evidence"
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

-- Update delete policy to include platform admins
DROP POLICY IF EXISTS "Discipline staff delete school conduct evidence" ON storage.objects;
CREATE POLICY "Discipline staff delete school conduct evidence"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'conduct-evidence'
    AND (
      public.is_platform_admin(auth.uid())
      OR (
        public.is_discipline_staff(auth.uid())
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

-- Policy: School Directors can upload/update their school's logo
DROP POLICY IF EXISTS "School directors upload logos" ON storage.objects;
CREATE POLICY "School directors upload logos"
  ON storage.objects FOR INSERT TO authenticated
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

-- Policy: Anyone can read logos (public bucket)
DROP POLICY IF EXISTS "Public read logos" ON storage.objects;
CREATE POLICY "Public read logos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'school-logos');

-- Policy: School Directors can delete their school's logo
DROP POLICY IF EXISTS "School directors delete logos" ON storage.objects;
CREATE POLICY "School directors delete logos"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'school-logos'
    AND (
      public.is_platform_admin(auth.uid())
      OR (
        public.is_school_director(auth.uid())
        AND (storage.foldername(name))[1] = public.current_school_id()::text
      )
    )
  );

-- Policy: School Directors can update their school's logo
DROP POLICY IF EXISTS "School directors update logos" ON storage.objects;
CREATE POLICY "School directors update logos"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
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
-- 4. CONVERT GOOD DEEDS TO RECOGNITION-ONLY
-- ==============================================================================

-- Update good_deed_reward enum constraint to replace 'restore_marks' with 'recognition'
-- First, convert all existing 'restore_marks' values to 'recognition'
UPDATE public.good_deed_categories
SET good_deed_reward = 'recognition'
WHERE good_deed_reward = 'restore_marks';

-- Update the check constraint to only allow 'recognition' and 'merit_points'
ALTER TABLE public.good_deed_categories
  DROP CONSTRAINT IF EXISTS good_deed_categories_good_deed_reward_check;

ALTER TABLE public.good_deed_categories
  ADD CONSTRAINT good_deed_categories_good_deed_reward_check
  CHECK (good_deed_reward IN ('recognition', 'merit_points'));

COMMENT ON COLUMN public.good_deed_categories.good_deed_reward IS 'Recognition only or recognition + merit points. Good deeds NEVER restore conduct marks.';

-- Remove marks_restored column from good_deed_categories (no longer used)
-- Keep merit_points column (still used for merit points)
ALTER TABLE public.good_deed_categories
  DROP COLUMN IF EXISTS marks_restored;

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
-- - The updated good_deed_reward constraint (recognition, merit_points only)
