CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id);
$$;
REVOKE EXECUTE ON FUNCTION public.is_staff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Staff can view notifications" ON public.notification_logs;
CREATE POLICY "Staff can view notifications" ON public.notification_logs FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
DROP POLICY IF EXISTS "Staff can view students" ON public.students;
CREATE POLICY "Staff can view students" ON public.students FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
DROP POLICY IF EXISTS "Staff can view conduct logs" ON public.conduct_logs;
CREATE POLICY "Staff can view conduct logs" ON public.conduct_logs FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
DROP POLICY IF EXISTS "Staff can view offenses" ON public.offenses_catalog;
CREATE POLICY "Staff can view offenses" ON public.offenses_catalog FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
DROP POLICY IF EXISTS "Staff can view terms" ON public.academic_terms;
CREATE POLICY "Staff can view terms" ON public.academic_terms FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));