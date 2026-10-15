-- SCDMS: SaaS multi-tenancy, subscriptions, evidence photos, parent messaging.
-- Run manually. Idempotent and additive: nothing is dropped except policies this
-- script itself (re)creates. Supersedes supabase/multi-tenant-school-id.sql
-- (safe to run either or both). Existing rows go to one default school.

-- 1. Schools + subscriptions -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.schools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.schools ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'trial';
ALTER TABLE public.schools ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE public.schools ADD COLUMN IF NOT EXISTS trial_ends_at date;
ALTER TABLE public.schools ADD COLUMN IF NOT EXISTS student_limit integer;
ALTER TABLE public.schools DROP CONSTRAINT IF EXISTS schools_plan_check;
ALTER TABLE public.schools ADD CONSTRAINT schools_plan_check
  CHECK (plan IN ('trial','basic','pro','enterprise'));
ALTER TABLE public.schools DROP CONSTRAINT IF EXISTS schools_status_check;
ALTER TABLE public.schools ADD CONSTRAINT schools_status_check
  CHECK (status IN ('active','suspended','cancelled'));

GRANT SELECT, INSERT, UPDATE ON public.schools TO authenticated;
GRANT ALL ON public.schools TO service_role;
ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;

INSERT INTO public.schools (id, name, plan)
SELECT '00000000-0000-0000-0000-000000000001',
       COALESCE((SELECT school_name FROM public.school_settings WHERE id = 1), 'Northfield Academy'),
       'pro'
ON CONFLICT (id) DO NOTHING;

-- 2. Staff belong to a school ---------------------------------------------------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES public.schools(id);
UPDATE public.profiles SET school_id = '00000000-0000-0000-0000-000000000001' WHERE school_id IS NULL;
-- New sign-ups start with NO school until a platform administrator assigns one.
ALTER TABLE public.profiles ALTER COLUMN school_id DROP DEFAULT;

-- 3. Helper functions -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_school_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT school_id FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_platform_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'system_admin');
$$;

CREATE OR REPLACE FUNCTION public.school_is_active(_school_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.schools WHERE id = _school_id AND status = 'active');
$$;

REVOKE EXECUTE ON FUNCTION public.current_school_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_platform_admin(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.school_is_active(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_school_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_platform_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.school_is_active(uuid) TO authenticated, service_role;

-- Staff cannot move themselves to another school.
CREATE OR REPLACE FUNCTION public.protect_profile_school()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.school_id IS DISTINCT FROM OLD.school_id
     AND auth.uid() IS NOT NULL
     AND NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only platform administrators can change a staff member''s school';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS protect_profile_school ON public.profiles;
CREATE TRIGGER protect_profile_school BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_school();

-- 4. Schools policies -------------------------------------------------------------
DROP POLICY IF EXISTS "Members view their school" ON public.schools;
CREATE POLICY "Members view their school" ON public.schools
  FOR SELECT TO authenticated USING (id = public.current_school_id());
DROP POLICY IF EXISTS "Platform admins manage schools" ON public.schools;
CREATE POLICY "Platform admins manage schools" ON public.schools
  FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

-- Profiles: only your own, your school's staff, or everything for platform admins.
DROP POLICY IF EXISTS "Same school profiles only" ON public.profiles;
CREATE POLICY "Same school profiles only" ON public.profiles AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (id = auth.uid() OR public.is_platform_admin(auth.uid()) OR school_id = public.current_school_id())
  WITH CHECK (id = auth.uid() OR public.is_platform_admin(auth.uid()));
DROP POLICY IF EXISTS "Platform admins manage profiles" ON public.profiles;
CREATE POLICY "Platform admins manage profiles" ON public.profiles
  FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

-- 5. Evidence + messaging columns -----------------------------------------------
ALTER TABLE public.conduct_logs ADD COLUMN IF NOT EXISTS evidence_path text;
ALTER TABLE public.conduct_logs ADD COLUMN IF NOT EXISTS evidence_url text;
ALTER TABLE public.notification_logs ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'sms';
ALTER TABLE public.notification_logs DROP CONSTRAINT IF EXISTS notification_logs_channel_check;
ALTER TABLE public.notification_logs ADD CONSTRAINT notification_logs_channel_check
  CHECK (channel IN ('sms','whatsapp','email'));
ALTER TABLE public.notification_logs DROP CONSTRAINT IF EXISTS notification_logs_status_check;
ALTER TABLE public.notification_logs ADD CONSTRAINT notification_logs_status_check
  CHECK (status IN ('draft','pending','sent','failed','skipped'));

-- 6. Tenant isolation on every school-owned table -------------------------------
-- Note: offences and terms keep their existing UNIQUE codes globally; a second
-- school may need different codes until those are made unique per school.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['students','conduct_logs','notification_logs','audit_logs',
                           'student_academic_history','offenses_catalog','academic_terms'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES public.schools(id)', t);
    EXECUTE format('UPDATE public.%I SET school_id = %L WHERE school_id IS NULL', t, '00000000-0000-0000-0000-000000000001');
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN school_id SET DEFAULT public.current_school_id()', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (school_id)', t || '_school_id_idx', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    -- RESTRICTIVE: combined with (not replacing) every existing role policy.
    EXECUTE format('DROP POLICY IF EXISTS "Same school only" ON public.%I', t);
    EXECUTE format($p$CREATE POLICY "Same school only" ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
      USING (public.is_platform_admin(auth.uid())
             OR (school_id = public.current_school_id() AND public.school_is_active(school_id)))
      WITH CHECK (public.is_platform_admin(auth.uid())
             OR (school_id = public.current_school_id() AND public.school_is_active(school_id)))$p$, t);
  END LOOP;
END $$;

-- Balances view must respect the caller's row rules.
DO $$ BEGIN
  IF to_regclass('public.student_conduct_balances') IS NOT NULL THEN
    EXECUTE 'ALTER VIEW public.student_conduct_balances SET (security_invoker = true)';
  END IF;
END $$;

-- Staff may save message drafts / queue messages (leaders included).
DROP POLICY IF EXISTS "Staff can draft notifications" ON public.notification_logs;
CREATE POLICY "Staff can draft notifications" ON public.notification_logs
  FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()) AND status = 'draft');

-- 7. Evidence storage (private bucket, files under <school_id>/...) ---------------
-- Bucket itself is created separately (private, id conduct-evidence).

DROP POLICY IF EXISTS "Staff upload evidence for their school" ON storage.objects;
CREATE POLICY "Staff upload evidence for their school" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'conduct-evidence'
              AND public.is_discipline_staff(auth.uid())
              AND (storage.foldername(name))[1] = public.current_school_id()::text);
DROP POLICY IF EXISTS "Staff read evidence for their school" ON storage.objects;
CREATE POLICY "Staff read evidence for their school" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'conduct-evidence'
         AND (public.is_platform_admin(auth.uid())
              OR (storage.foldername(name))[1] = public.current_school_id()::text));
