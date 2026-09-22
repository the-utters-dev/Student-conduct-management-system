-- ROLES ------------------------------------------------------------------
CREATE TYPE public.app_role AS ENUM ('discipline_admin', 'school_leader', 'system_admin');

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  email TEXT,
  job_title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.is_discipline_staff(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('discipline_admin', 'system_admin')
  );
$$;

CREATE POLICY "Users can view their own profile" ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = id OR public.has_role(auth.uid(), 'system_admin'));
CREATE POLICY "Users can update their own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can insert their own profile" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can view their own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'system_admin'));

-- TIMESTAMP TRIGGER -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- NEW USER HOOK ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''), NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ACADEMIC TERMS ---------------------------------------------------------
CREATE TABLE public.academic_terms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  starting_marks INTEGER NOT NULL DEFAULT 40,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.academic_terms TO authenticated;
GRANT ALL ON public.academic_terms TO service_role;
ALTER TABLE public.academic_terms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can view terms" ON public.academic_terms
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Discipline staff manage terms" ON public.academic_terms
  FOR ALL TO authenticated USING (public.is_discipline_staff(auth.uid()))
  WITH CHECK (public.is_discipline_staff(auth.uid()));
CREATE TRIGGER update_academic_terms_updated_at BEFORE UPDATE ON public.academic_terms
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- STUDENTS ---------------------------------------------------------------
CREATE TABLE public.students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admission_no TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  class_name TEXT NOT NULL,
  house TEXT,
  gender TEXT,
  parent_name TEXT,
  parent_phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.students TO authenticated;
GRANT ALL ON public.students TO service_role;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can view students" ON public.students
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Discipline staff manage students" ON public.students
  FOR ALL TO authenticated USING (public.is_discipline_staff(auth.uid()))
  WITH CHECK (public.is_discipline_staff(auth.uid()));
CREATE TRIGGER update_students_updated_at BEFORE UPDATE ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- OFFENSES CATALOG -------------------------------------------------------
CREATE TABLE public.offenses_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'minor',
  marks_deducted INTEGER NOT NULL DEFAULT 1,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.offenses_catalog TO authenticated;
GRANT ALL ON public.offenses_catalog TO service_role;
ALTER TABLE public.offenses_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can view offenses" ON public.offenses_catalog
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Discipline staff manage offenses" ON public.offenses_catalog
  FOR ALL TO authenticated USING (public.is_discipline_staff(auth.uid()))
  WITH CHECK (public.is_discipline_staff(auth.uid()));
CREATE TRIGGER update_offenses_catalog_updated_at BEFORE UPDATE ON public.offenses_catalog
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- CONDUCT LOGS -----------------------------------------------------------
CREATE TABLE public.conduct_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  term_id UUID NOT NULL REFERENCES public.academic_terms(id) ON DELETE RESTRICT,
  offense_id UUID REFERENCES public.offenses_catalog(id) ON DELETE SET NULL,
  entry_type TEXT NOT NULL DEFAULT 'deduction',
  marks INTEGER NOT NULL,
  reason TEXT,
  occurred_on DATE NOT NULL DEFAULT CURRENT_DATE,
  recorded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT conduct_logs_entry_type_check CHECK (entry_type IN ('deduction', 'restoration')),
  CONSTRAINT conduct_logs_marks_check CHECK (marks > 0)
);
CREATE INDEX conduct_logs_student_term_idx ON public.conduct_logs (student_id, term_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conduct_logs TO authenticated;
GRANT ALL ON public.conduct_logs TO service_role;
ALTER TABLE public.conduct_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can view conduct logs" ON public.conduct_logs
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Discipline staff record conduct logs" ON public.conduct_logs
  FOR INSERT TO authenticated WITH CHECK (public.is_discipline_staff(auth.uid()));
CREATE POLICY "System admins update conduct logs" ON public.conduct_logs
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'system_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'system_admin'));
CREATE POLICY "System admins delete conduct logs" ON public.conduct_logs
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'system_admin'));
CREATE TRIGGER update_conduct_logs_updated_at BEFORE UPDATE ON public.conduct_logs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- BALANCES VIEW ----------------------------------------------------------
CREATE VIEW public.student_conduct_balances
WITH (security_invoker = true) AS
SELECT
  s.id AS student_id,
  s.admission_no,
  s.full_name,
  s.class_name,
  s.house,
  s.parent_phone,
  t.id AS term_id,
  t.name AS term_name,
  t.starting_marks,
  COALESCE(SUM(CASE WHEN l.entry_type = 'deduction' THEN l.marks ELSE 0 END), 0)::int AS marks_deducted,
  COALESCE(SUM(CASE WHEN l.entry_type = 'restoration' THEN l.marks ELSE 0 END), 0)::int AS marks_restored,
  GREATEST(
    t.starting_marks
      - COALESCE(SUM(CASE WHEN l.entry_type = 'deduction' THEN l.marks ELSE 0 END), 0)
      + COALESCE(SUM(CASE WHEN l.entry_type = 'restoration' THEN l.marks ELSE 0 END), 0),
    0
  )::int AS current_marks,
  COUNT(l.id)::int AS entries_count
FROM public.students s
CROSS JOIN public.academic_terms t
LEFT JOIN public.conduct_logs l ON l.student_id = s.id AND l.term_id = t.id
WHERE t.is_active = true
GROUP BY s.id, s.admission_no, s.full_name, s.class_name, s.house, s.parent_phone, t.id, t.name, t.starting_marks;

GRANT SELECT ON public.student_conduct_balances TO authenticated;
GRANT ALL ON public.student_conduct_balances TO service_role;

-- SEED DATA --------------------------------------------------------------
INSERT INTO public.academic_terms (name, start_date, end_date, starting_marks, is_active)
VALUES ('Term 3 2026', '2026-09-01', '2026-12-04', 40, true);

INSERT INTO public.offenses_catalog (code, title, category, severity, marks_deducted, description) VALUES
('OFF-001', 'Classroom disruption', 'Disruption', 'minor', 2, 'Talking, noise or distracting others during a lesson'),
('OFF-002', 'Improper uniform', 'Uniform', 'minor', 1, 'Incomplete or incorrect school uniform'),
('OFF-003', 'Late arrival', 'Lateness', 'minor', 1, 'Arriving late to school or to a lesson'),
('OFF-004', 'Disrespect to staff', 'Respect', 'major', 5, 'Rude or defiant behaviour towards a staff member'),
('OFF-005', 'Bullying', 'Respect', 'severe', 8, 'Verbal or physical bullying of another student'),
('OFF-006', 'Missing assignment', 'Academic', 'minor', 2, 'Failure to submit required work on time'),
('OFF-007', 'Leaving campus without permission', 'Safety', 'major', 6, 'Unauthorised absence from school grounds');

INSERT INTO public.students (admission_no, full_name, class_name, house, gender, parent_name, parent_phone) VALUES
('NA-1001', 'Jordan Okafor', 'Year 10B', 'Kestrel', 'male', 'Ada Okafor', '+254700111201'),
('NA-1002', 'Priya Raman', 'Year 11A', 'Falcon', 'female', 'Suresh Raman', '+254700111202'),
('NA-1003', 'Marcus Cole', 'Year 9C', 'Heron', 'male', 'Diane Cole', '+254700111203'),
('NA-1004', 'Amina Yusuf', 'Year 10B', 'Falcon', 'female', 'Hassan Yusuf', '+254700111204'),
('NA-1005', 'Ethan Mwangi', 'Year 12A', 'Kestrel', 'male', 'Grace Mwangi', '+254700111205'),
('NA-1006', 'Lerato Dube', 'Year 9A', 'Heron', 'female', 'Thabo Dube', '+254700111206'),
('NA-1007', 'Samuel Otieno', 'Year 11C', 'Osprey', 'male', 'Mary Otieno', '+254700111207'),
('NA-1008', 'Chloe Bennett', 'Year 10A', 'Osprey', 'female', 'Paul Bennett', '+254700111208'),
('NA-1009', 'Nadia Farah', 'Year 12B', 'Falcon', 'female', 'Omar Farah', '+254700111209'),
('NA-1010', 'Tobias Nkemdirim', 'Year 9B', 'Kestrel', 'male', 'Ijeoma Nkemdirim', '+254700111210');

INSERT INTO public.conduct_logs (student_id, term_id, offense_id, entry_type, marks, reason, occurred_on)
SELECT s.id, t.id, o.id, 'deduction', o.marks_deducted, o.title || ' recorded by duty patron', CURRENT_DATE - 3
FROM public.students s
CROSS JOIN (SELECT id FROM public.academic_terms WHERE is_active LIMIT 1) t
JOIN public.offenses_catalog o ON o.code = 'OFF-001'
WHERE s.admission_no IN ('NA-1001', 'NA-1004', 'NA-1007');

INSERT INTO public.conduct_logs (student_id, term_id, offense_id, entry_type, marks, reason, occurred_on)
SELECT s.id, t.id, o.id, 'deduction', o.marks_deducted, o.title || ' recorded at morning assembly', CURRENT_DATE - 1
FROM public.students s
CROSS JOIN (SELECT id FROM public.academic_terms WHERE is_active LIMIT 1) t
JOIN public.offenses_catalog o ON o.code = 'OFF-002'
WHERE s.admission_no IN ('NA-1002', 'NA-1009');

INSERT INTO public.conduct_logs (student_id, term_id, offense_id, entry_type, marks, reason, occurred_on)
SELECT s.id, t.id, NULL, 'restoration', 2, 'Completed restorative conversation and community service', CURRENT_DATE
FROM public.students s
CROSS JOIN (SELECT id FROM public.academic_terms WHERE is_active LIMIT 1) t
WHERE s.admission_no IN ('NA-1003', 'NA-1001');
