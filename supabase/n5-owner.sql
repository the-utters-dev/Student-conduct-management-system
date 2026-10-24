-- N5 — Platform Owner: Workspace for Each School (idempotent)
-- Run this manually in Supabase SQL Editor
-- Creates school_payments and school_support_notes tables for platform owner only

-- =============================================================================
-- 1. CREATE school_payments TABLE
-- =============================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'school_payments') THEN
    CREATE TABLE public.school_payments (
      id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
      payment_date date NOT NULL,
      amount numeric(12, 2) NOT NULL CHECK (amount > 0),
      method text NOT NULL CHECK (method IN ('MTN MoMo', 'Airtel Money', 'Bank', 'Cash')),
      reference text,
      period_covered text,
      note text,
      recorded_by uuid NOT NULL REFERENCES auth.users(id),
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );

    CREATE INDEX idx_school_payments_school ON public.school_payments(school_id);
    CREATE INDEX idx_school_payments_date ON public.school_payments(payment_date DESC);

    COMMENT ON TABLE public.school_payments IS 'Payment log for school subscriptions (platform owner only)';
  END IF;
END $$;

-- RLS for school_payments (platform owner only)
ALTER TABLE public.school_payments ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'school_payments'
    AND policyname = 'Platform owner only'
  ) THEN
    CREATE POLICY "Platform owner only" ON public.school_payments
      AS RESTRICTIVE
      USING (public.is_platform_admin(auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'school_payments'
    AND policyname = 'Platform owner can manage payments'
  ) THEN
    CREATE POLICY "Platform owner can manage payments" ON public.school_payments
      FOR ALL
      USING (public.is_platform_admin(auth.uid()))
      WITH CHECK (public.is_platform_admin(auth.uid()));
  END IF;
END $$;

-- =============================================================================
-- 2. CREATE school_support_notes TABLE
-- =============================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'school_support_notes') THEN
    CREATE TABLE public.school_support_notes (
      id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
      subject text NOT NULL,
      status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
      note text NOT NULL,
      created_by uuid NOT NULL REFERENCES auth.users(id),
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );

    CREATE INDEX idx_school_support_notes_school ON public.school_support_notes(school_id);
    CREATE INDEX idx_school_support_notes_status ON public.school_support_notes(school_id, status);
    CREATE INDEX idx_school_support_notes_created ON public.school_support_notes(created_at DESC);

    COMMENT ON TABLE public.school_support_notes IS 'Support requests and notes for schools (platform owner only)';
  END IF;
END $$;

-- RLS for school_support_notes (platform owner only)
ALTER TABLE public.school_support_notes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'school_support_notes'
    AND policyname = 'Platform owner only'
  ) THEN
    CREATE POLICY "Platform owner only" ON public.school_support_notes
      AS RESTRICTIVE
      USING (public.is_platform_admin(auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'school_support_notes'
    AND policyname = 'Platform owner can manage support notes'
  ) THEN
    CREATE POLICY "Platform owner can manage support notes" ON public.school_support_notes
      FOR ALL
      USING (public.is_platform_admin(auth.uid()))
      WITH CHECK (public.is_platform_admin(auth.uid()));
  END IF;
END $$;

-- =============================================================================
-- 3. AUDIT TRIGGERS
-- =============================================================================

-- Audit trigger for school_payments
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'audit_school_payments'
    AND tgrelid = 'public.school_payments'::regclass
  ) THEN
    CREATE TRIGGER audit_school_payments
      AFTER INSERT OR UPDATE OR DELETE ON public.school_payments
      FOR EACH ROW EXECUTE FUNCTION public.audit_log();
  END IF;
END $$;

-- Audit trigger for school_support_notes
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'audit_school_support_notes'
    AND tgrelid = 'public.school_support_notes'::regclass
  ) THEN
    CREATE TRIGGER audit_school_support_notes
      AFTER INSERT OR UPDATE OR DELETE ON public.school_support_notes
      FOR EACH ROW EXECUTE FUNCTION public.audit_log();
  END IF;
END $$;

-- =============================================================================
-- 4. UPDATED_AT TRIGGERS
-- =============================================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_updated_at_school_payments'
    AND tgrelid = 'public.school_payments'::regclass
  ) THEN
    CREATE TRIGGER set_updated_at_school_payments
      BEFORE UPDATE ON public.school_payments
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_updated_at_school_support_notes'
    AND tgrelid = 'public.school_support_notes'::regclass
  ) THEN
    CREATE TRIGGER set_updated_at_school_support_notes
      BEFORE UPDATE ON public.school_support_notes
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- =============================================================================
-- Summary
-- =============================================================================
-- This script creates:
-- 1. school_payments table for recording subscription payments (platform owner only)
-- 2. school_support_notes table for support requests and notes (platform owner only)
-- 3. RLS policies restricting access to platform admins only
-- 4. Audit triggers for all changes
-- 5. Updated_at triggers for automatic timestamp updates
--
-- All operations are idempotent and safe to run multiple times.
