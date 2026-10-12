ALTER TABLE public.conduct_logs
  ADD COLUMN IF NOT EXISTS evidence_path text,
  ADD COLUMN IF NOT EXISTS evidence_url text;

NOTIFY pgrst, 'reload schema';
