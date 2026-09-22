CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  requested TEXT := COALESCE(NEW.raw_user_meta_data ->> 'user_role', 'school_leader');
  resolved public.app_role;
BEGIN
  INSERT INTO public.profiles (id, full_name, email, job_title)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''),
    NEW.email,
    NEW.raw_user_meta_data ->> 'job_title'
  )
  ON CONFLICT (id) DO NOTHING;

  resolved := CASE
    WHEN requested = 'discipline_admin' THEN 'discipline_admin'::public.app_role
    ELSE 'school_leader'::public.app_role
  END;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, resolved)
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END; $$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
