CREATE OR REPLACE FUNCTION public.is_audit_viewer(_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('school_leader','system_admin'));
$$;
REVOKE EXECUTE ON FUNCTION public.is_audit_viewer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_audit_viewer(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Staff can view audit logs" ON public.audit_logs;
CREATE POLICY "Leaders and admins view audit logs" ON public.audit_logs FOR SELECT TO authenticated USING (public.is_audit_viewer(auth.uid()));

CREATE POLICY "Audit viewers can view staff profiles" ON public.profiles FOR SELECT TO authenticated USING (public.is_audit_viewer(auth.uid()));
CREATE POLICY "Audit viewers can view staff roles" ON public.user_roles FOR SELECT TO authenticated USING (public.is_audit_viewer(auth.uid()));