CREATE TABLE public.notification_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conduct_log_id UUID REFERENCES public.conduct_logs(id) ON DELETE SET NULL,
  student_id UUID REFERENCES public.students(id) ON DELETE SET NULL,
  recipient_phone TEXT,
  message_body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped')),
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.notification_logs TO authenticated;
GRANT ALL ON public.notification_logs TO service_role;
ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view notifications" ON public.notification_logs
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Discipline staff can queue notifications" ON public.notification_logs
  FOR INSERT TO authenticated WITH CHECK (public.is_discipline_staff(auth.uid()));
CREATE POLICY "System admins can update notifications" ON public.notification_logs
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'system_admin'));

CREATE INDEX idx_notification_logs_status ON public.notification_logs(status, created_at DESC);

CREATE TABLE public.audit_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view audit logs" ON public.audit_logs
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Users can record their own audit entries" ON public.audit_logs
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE INDEX idx_audit_logs_created_at ON public.audit_logs(created_at DESC);