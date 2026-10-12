ALTER TABLE public.conduct_logs
  ADD COLUMN IF NOT EXISTS evidence_url text;
