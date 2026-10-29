-- ==============================================================================
-- P1: Support view audit tagging
-- ==============================================================================
-- When the platform owner works inside a school's workspace (support view), every
-- audit entry should show it was done by the platform owner. The app already adds
-- { "via": "platform_owner" } to the audit rows it writes itself; this trigger also
-- tags rows written by database triggers (terms, offences, categories, roles ...).
--
-- Safe to run more than once. It only adds one new function and one new trigger;
-- no existing function is redefined. Uses public.is_platform_admin(uuid) from
-- setup-full.sql. The app works the same before this script is run.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.tag_platform_owner_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only rows written by a signed-in platform owner are tagged.
  IF auth.uid() IS NULL OR NOT public.is_platform_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  NEW.payload := COALESCE(NEW.payload, '{}'::jsonb) || jsonb_build_object('via', 'platform_owner');

  -- Some older triggers still write the legacy "details" column (see phase3c-fixes.sql).
  -- The column may not exist, so it is reached through jsonb instead of NEW.details.
  IF jsonb_typeof(to_jsonb(NEW) -> 'details') = 'object' THEN
    NEW := jsonb_populate_record(
      NEW,
      jsonb_build_object('details', (to_jsonb(NEW) -> 'details') || jsonb_build_object('via', 'platform_owner'))
    );
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tag_platform_owner_audit IS
  'Adds {"via":"platform_owner"} to audit_logs rows written by the platform owner (support view).';

REVOKE EXECUTE ON FUNCTION public.tag_platform_owner_audit() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS tag_platform_owner_audit ON public.audit_logs;
CREATE TRIGGER tag_platform_owner_audit
  BEFORE INSERT ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.tag_platform_owner_audit();

-- ==============================================================================
-- Verification (run manually after opening a school in support view and
-- recording something there):
--   SELECT created_at, action, school_id, payload->>'via' AS via
--   FROM public.audit_logs ORDER BY created_at DESC LIMIT 10;
-- ==============================================================================
