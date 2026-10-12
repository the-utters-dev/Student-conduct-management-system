ALTER TABLE public.conduct_logs
  ADD COLUMN IF NOT EXISTS evidence_path text;

ALTER TABLE public.notification_logs
  ADD COLUMN IF NOT EXISTS evidence_image_url text;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'conduct-evidence',
  'conduct-evidence',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png'];

DROP POLICY IF EXISTS "Discipline staff upload school conduct evidence" ON storage.objects;
CREATE POLICY "Discipline staff upload school conduct evidence"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'conduct-evidence'
    AND public.is_discipline_staff(auth.uid())
    AND (storage.foldername(name))[1] = public.current_school_id()::text
  );

DROP POLICY IF EXISTS "Staff read school conduct evidence" ON storage.objects;
CREATE POLICY "Staff read school conduct evidence"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'conduct-evidence'
    AND public.is_staff(auth.uid())
    AND (storage.foldername(name))[1] = public.current_school_id()::text
  );

DROP POLICY IF EXISTS "Discipline staff delete school conduct evidence" ON storage.objects;
CREATE POLICY "Discipline staff delete school conduct evidence"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'conduct-evidence'
    AND public.is_discipline_staff(auth.uid())
    AND (storage.foldername(name))[1] = public.current_school_id()::text
  );
