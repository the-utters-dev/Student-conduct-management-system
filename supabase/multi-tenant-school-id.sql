-- SCDMS: multi-school data isolation. Run manually; idempotent and additive.
-- Nothing is dropped. Existing rows are assigned to one default school so the
-- current data and permissions keep working exactly as before.

CREATE TABLE IF NOT EXISTS public.schools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.schools TO authenticated;
GRANT ALL ON public.schools TO service_role;
ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;

INSERT INTO public.schools (id, name)
SELECT '00000000-0000-0000-0000-000000000001',
       COALESCE((SELECT school_name FROM public.school_settings WHERE id = 1), 'Northfield Academy')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES public.schools(id)
  DEFAULT '00000000-0000-0000-0000-000000000001';
UPDATE public.profiles SET school_id = '00000000-0000-0000-0000-000000000001' WHERE school_id IS NULL;

-- The signed-in user's school (reads profiles bypassing RLS to avoid recursion).
CREATE OR REPLACE FUNCTION public.current_school_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT school_id FROM public.profiles WHERE id = auth.uid();
$$;
REVOKE EXECUTE ON FUNCTION public.current_school_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_school_id() TO authenticated, service_role;

DROP POLICY IF EXISTS "Members view their school" ON public.schools;
CREATE POLICY "Members view their school" ON public.schools
  FOR SELECT TO authenticated USING (id = public.current_school_id());

-- Add school_id to each tenant table; new rows attach the user's school automatically.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['students','conduct_logs','notification_logs','audit_logs','student_academic_history'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES public.schools(id)', t);
    EXECUTE format('UPDATE public.%I SET school_id = %L WHERE school_id IS NULL', t, '00000000-0000-0000-0000-000000000001');
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN school_id SET DEFAULT public.current_school_id()', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (school_id)', t || '_school_id_idx', t);
    -- RESTRICTIVE: combined with (not replacing) every existing role policy.
    EXECUTE format('DROP POLICY IF EXISTS "Same school only" ON public.%I', t);
    EXECUTE format('CREATE POLICY "Same school only" ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
      USING (school_id = public.current_school_id()) WITH CHECK (school_id = public.current_school_id())', t);
  END LOOP;
END $$;
