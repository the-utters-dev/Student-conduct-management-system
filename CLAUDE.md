# Track-Teacher (SCDMS) — Project Rules

## What this is
A multi-tenant SaaS for school conduct & discipline management, sold to Rwandan schools
(nursery, primary, secondary; day and boarding) on a per-term subscription.
Owner: Wix (freelance developer). Currency: RWF. Languages: English now; Kinyarwanda/French later.

## Stack
- TanStack Start + TanStack Router (file routes in src/routes), React 19, TypeScript
- TanStack Query for data, Tailwind CSS v4, shadcn/ui components in src/components/ui
- Supabase (Postgres + RLS + Storage + Auth). Client: src/integrations/supabase/client.ts
- Server functions: createServerFn in src/lib/*.functions.ts, protected with requireSupabaseAuth.
  The service-role client (client.server.ts) is ONLY imported dynamically inside server handlers.
- Project is synced with Lovable. Never force-push, rebase or amend pushed commits.

## Multi-tenancy rules (critical — never break these)
- Every school-owned table has school_id uuid referencing public.schools(id), defaulting to public.current_school_id().
- Every school-owned table has the RESTRICTIVE "Same school only" RLS policy:
  is_platform_admin(auth.uid()) OR (school_id = current_school_id() AND school_is_active(school_id)).
- Any SECURITY DEFINER function must check the caller's school itself (it bypasses RLS).
- Uniqueness of school data (admission numbers, offence codes, term names) is per school: UNIQUE (school_id, ...).
- Views must use security_invoker = true and join on school_id.
- React Query keys for school data must include schoolId. The cache is cleared on sign-out.
- Never hardcode a school name. Use the tenant school (useAuth().school) or that school's settings.
- Roles: system_admin (platform owner), school_leader, discipline_admin (Matron/Patron).

## Database changes
- Do NOT run SQL against the live database. Write idempotent scripts in supabase/ (safe to run twice),
  named by phase, e.g. supabase/phase1-foundations.sql. Wix runs them manually in the Supabase SQL editor.
- The app must keep working before a script has been run (fallbacks, e.g. insertWithColumnFallback / isMissingColumn).
- After any schema change, update src/integrations/supabase/types.ts only if you can do so accurately; otherwise use the untyped `db` client from src/lib/evidence.ts.

## UI standards
- Mobile-first: everything must work at 360px wide. No horizontal page scroll; wide tables scroll inside their card.
- Use the existing design tokens (bg-glass, text-ink, text-soft, text-faint, brand, accent, ok, warn, danger, ring-hairline)
  and the DashboardShell layout. Support light and dark mode.
- Professional tone in all text. Clear empty states, loading states and error messages. No emoji in UI.

## Workflow
- One task per git branch (feature/<short-name>). Keep main always working.
- Before starting any task: git checkout main && git pull, then create the new branch from the updated main.
  Never edit in Lovable and VS Code at the same time without pulling first.
- Before finishing a task run: npx tsc --noEmit and npm run build, and fix all errors you introduced.
- End every task with a short summary: files changed, SQL scripts Wix must run (in order), and how to test it manually.

## Final report (required at the end of EVERY task)
1. What was done: a numbered list of every change, in plain language a non-developer can understand.
2. Files: every file created, changed or deleted, with one line each on why.
3. Database: every SQL script to run, in exact order, what each does, and whether it is safe to re-run.
4. Not done / limitations: anything from the request that was skipped, simplified or left for later, and why.
5. Manual test checklist: step-by-step checks with the expected result.
6. Build status: the result of npx tsc --noEmit and npm run build.
