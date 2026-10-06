ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text,
  ADD COLUMN IF NOT EXISTS date_of_birth date,
  ADD COLUMN IF NOT EXISTS district text,
  ADD COLUMN IF NOT EXISTS sector text,
  ADD COLUMN IF NOT EXISTS cell text,
  ADD COLUMN IF NOT EXISTS class_level text,
  ADD COLUMN IF NOT EXISTS stream text;

CREATE POLICY "Leaders and admins delete students" ON public.students FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'school_leader') OR public.has_role(auth.uid(), 'system_admin') OR public.is_discipline_staff(auth.uid()));

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text;

CREATE TABLE public.school_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  school_name text NOT NULL DEFAULT 'Northfield Academy',
  logo_url text,
  academic_year text NOT NULL DEFAULT '2026/2027',
  critical_threshold integer NOT NULL DEFAULT 20,
  warning_threshold integer NOT NULL DEFAULT 30,
  notify_on_threshold boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.school_settings TO authenticated;
GRANT ALL ON public.school_settings TO service_role;
ALTER TABLE public.school_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff view school settings" ON public.school_settings FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "Leaders and admins update school settings" ON public.school_settings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'school_leader') OR public.has_role(auth.uid(), 'system_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'school_leader') OR public.has_role(auth.uid(), 'system_admin'));
CREATE TRIGGER update_school_settings_updated_at BEFORE UPDATE ON public.school_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
INSERT INTO public.school_settings (id) VALUES (1) ON CONFLICT DO NOTHING;