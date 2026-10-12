# SCDMS: Evidence fix, parent messaging, platform admin portal, tenant isolation

## Finding from the audit
This app's Conduct Actions form never sends `evidence_path` or `evidence_url`, and the conduct log table has no evidence columns. The "schema cache" error must come from another copy of the app or from your external project. Sending `null` for columns that don't exist would cause the same error, so the fix has two parts: add the columns to the database, and only send them when they exist.

## Part 1: Evidence photos on conduct entries
- Add an optional "Attach evidence (photo)" field to the Conduct Actions form.
- On save, upload the photo to the `conduct-evidence` storage folder. If the upload fails for any reason (network, permissions, folder missing), keep a small resized copy of the photo inside the entry. The mark deduction always saves.
- Always send `evidence_path` and `evidence_url` (as `null` when there's no photo). If the database doesn't have these columns yet, retry automatically without them and show a warning, so entries never fail.
- Database change: add the two optional columns and set up the `conduct-evidence` folder with upload rules for staff.

## Part 2: Parent messages and audit logs
- Messages and audit log entries are filtered to the signed-in staff member's school, both in the database and in the app.
- New "Recent entries" list on Conduct Actions. Each entry gets a "Message parent" quick action that opens a composer with SMS and WhatsApp tabs. Each tab is pre-filled with the student's name, the deduction, the reason, the balance and the evidence link.
- In the composer you can edit the message, see a live preview and character count, then save it as a draft, queue it as an SMS, or open WhatsApp with the message ready (wa.me link). Every message goes into the message log with its channel and is recorded in the audit trail.

## Part 3: Platform admin portal (new /platform page)
- Only System Administrators can see it. It has a new sidebar link.
- **Schools tab:** list every school with its ID (copy button), plan, status and number of staff and students. A "New school" form adds a school and shows its ID.
- **Staff setup:** assign existing staff accounts to a school and set their role (Matron/Patron, School Leader). You can also send an invite email to a new staff member already linked to a school.
- **Subscriptions tab:** plan (Trial, Basic, Pro, Enterprise), status (Active, Suspended, Cancelled), trial end date and student limit. Suspending a school blocks its staff's access to data and shows them a "subscription inactive" screen.

## Part 4: Data isolation for every school
- Every table gets a school link: students, conduct entries, messages, audit logs, academic history, offences, terms and school settings. Staff profiles also get one.
- Each of these tables gets a database rule: staff can only read and write their own school's records, and only while their school is active. System Administrators can manage all schools. This rule works on top of the existing role permissions.
- New records get the signed-in person's school automatically.
- The app keeps the school on the signed-in profile, so pages can use it.

## Database delivery
Earlier you asked me not to change the database directly. I'll follow that and save one script, `supabase/saas-multi-tenant.sql`, that's safe to run more than once. It includes the earlier multi-tenant script and adds the new pieces. The app keeps working before it's run, using fallbacks where possible. If you'd prefer I apply it myself this time, say so when you approve.

## Technical details
- SQL: `schools` (+ plan, status, trial_ends_at, student_limit), `profiles.school_id`, `current_school_id()`, `is_platform_admin()` (= system_admin), `school_is_active()`; RESTRICTIVE "Same school only" policies `USING (is_platform_admin() OR (school_id = current_school_id() AND school_is_active()))`; `conduct_logs.evidence_path/evidence_url`; `notification_logs.channel` ('sms'|'whatsapp'|'email'), status adds 'draft'; storage bucket `conduct-evidence` and storage.objects policies scoped to `{school_id}/...`; grants on every new table.
- Server functions (requireSupabaseAuth + system_admin check, then admin client) for creating schools, provisioning and inviting staff, and updating subscriptions.
- Shared `insertWithColumnFallback` helper reuses the existing `isMissingColumn` (42703/PGRST204).
- New files: `src/routes/_authenticated/platform.tsx`, `src/components/ParentMessageComposer.tsx`, `src/lib/platform.functions.ts`, `src/lib/evidence.ts`. Edited: conduct-actions.tsx, audit-logs.tsx, useAuth.tsx (school_id), DashboardShell.tsx (nav).
- Tests for the message template and the next-grade/tenant fallback rules.
