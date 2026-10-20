# Phase 2 - Role-Based Access Control: Implementation Status

## Overview
This document tracks the implementation of Phase 2, which introduces Rwandan school-specific roles
(School Director, Master of Discipline, Matron, Patron) with gender-based scoping and permission management.

## COMPLETED ✅

### 1. Database Scripts
- ✅ **phase2a-roles-enum.sql**: Adds new enum values (school_director, master_of_discipline, matron, patron)
- ✅ **phase2b-roles.sql**: Complete migration script including:
  - Migrates existing users from old roles to new roles
  - Updates all helper functions (is_discipline_staff, is_school_director, is_audit_viewer, staff_gender_scope, can_access_student)
  - Adds RESTRICTIVE gender scope policies on students, conduct_logs, notification_logs
  - Updates existing policies to use new role checks
  - Adds school_settings columns (role_titles, permissions)
  - Implements has_permission() function
  - Updates sign-up flow (no role/school for self-sign-ups)
  - Adds audit triggers for role and permission changes
  - Sets up platform owner (system_admin) special rules
  - Adds school status tracking (status_reason, status_changed_at, status_changed_by)

### 2. Core Auth System
- ✅ **useAuth hook** (src/hooks/useAuth.tsx):
  - New AppRole type with all 4 school roles + system_admin + legacy roles
  - GenderScope type and calculation
  - Permission management with `can(permission)` helper
  - Custom role labels with `roleLabel(role)` helper
  - Loads school settings (role_titles, permissions)
  - isSchoolDirector flag
  - scope property

### 3. UI Components
- ✅ **DashboardShell** (src/components/DashboardShell.tsx):
  - Uses new role system
  - Displays scope badge (Girls/Boys) for matrons/patrons
  - Permission-based navigation filtering
  - Updated role labels
  - Improved "waiting for activation" message

- ✅ **Audit Logs page** (src/routes/_authenticated/audit-logs.tsx):
  - Uses `can("view_audit_logs")` instead of role checks
  - Updated permission denial message
  - Removed ROLE_LABELS dependency

- ✅ **Auth page** (src/routes/auth.tsx):
  - Removed role selection from sign-up
  - Updated messaging to explain activation process
  - Self-sign-ups now await School Director assignment

### 4. Documentation
- ✅ Added "Final report" section to CLAUDE.md
- ✅ This status document

## IN PROGRESS / REMAINING WORK ⚠️

### HIGH PRIORITY - Core Functionality

#### 1. Settings Page - Staff & Roles Tab ✅ DONE
**File**: src/routes/_authenticated/settings.tsx
**Status**: Completed in prompt 3B
- ✅ Added new "Staff & Roles" tab (visible only to School Directors)
- ✅ Lists school's staff with their roles
- ✅ Dropdown to change staff roles (Master of Discipline, Matron, Patron, School Director)
- ✅ Active/Inactive toggle for staff
- ✅ "Invite Staff" form (email, full name, role)
- ✅ "Role Titles" form to customize role display names
- ✅ "Permissions" grid (rows: roles, columns: permissions, toggle switches)
- ✅ Saves to school_settings.role_titles and school_settings.permissions

#### 2. Staff Management Server Functions ✅ DONE
**File**: src/lib/school.functions.ts (NEW FILE CREATED)
**Status**: Completed in prompt 3B
- ✅ listSchoolStaff(): Lists all staff for the caller's school
- ✅ inviteSchoolStaff(): Creates invitation with role and school metadata
- ✅ updateStaffRole(): Changes a staff member's role with validation
- ✅ setStaffActive(): Activates/deactivates staff using Admin API ban_duration
- ✅ All functions require School Director authorization
- ✅ Never allows assigning system_admin role
- ✅ All actions logged to audit_logs

#### 3. Platform Portal Updates
**File**: src/routes/_authenticated/platform.tsx
**What's needed**:
- Update staff role dropdowns to new 4 roles
- Add school suspension UI:
  - Confirmation dialog before suspending
  - Input for suspension reason
  - Display status_reason and status_changed_at
  - Reactivate button
- Add "Deactivate Staff" button for individual staff
- Show last activity date per school
- Ensure platform owner never appears in school staff lists
- Add support view school picker with banner

#### 4. Student Display - Gender Warnings ✅ DONE
**Files**:
- src/routes\_authenticated/students.tsx

**Status**: Completed in prompt 3B
- ✅ Added warning badge "Sex not recorded" for students with empty/null gender
- ✅ Badge styled prominently in warn color
- ✅ Added "Missing sex" filter to status dropdown
- ✅ Students without gender are visible to everyone (including matrons/patrons)

### MEDIUM PRIORITY - Enhancements

#### 5. Additional Audit Logging
**Files**: Various conduct/student action files
**What's needed**:
- Ensure EVERY create/update/delete writes to audit_logs
- Parent messages must log
- Conduct entries must log (may already be done)
- Student creation/updates must log
- Offence catalog changes must log

#### 6. Platform Owner "Support View"
**What's needed**:
- After sign-in, system_admin lands on /platform
- School pages (/, /students, /conduct-actions, /reports) show school picker
- Selected school stored in session/state
- Banner: "Viewing {school name} as platform owner"
- All actions in support view write to that school's audit log
- Mark audit entries as done by platform owner

#### 7. Permission Checks in UI ✅ DONE
**Status**: Completed in prompt 3B
**Files modified**:
- src/routes/_authenticated/reports.tsx - Added `can("view_reports")` check with "no access" message
- src/routes/_authenticated/students.tsx - Changed canDelete to `can("delete_students")`
- src/routes/_authenticated/conduct-actions.tsx - Wrapped photo upload in `can("send_photos")` and SMS checkbox in `can("message_parents")`
- src/hooks/useSchoolSettings.ts - Added role_titles and permissions to SchoolSettings interface

All permission checks are in place. Database RLS policies enforce manage_offences permission.

### LOW PRIORITY - Polish

#### 8. Type Definitions ✅ DONE
**File**: src/hooks/useSchoolSettings.ts
**Status**: Updated SchoolSettings interface with role_titles and permissions properties

## TESTING CHECKLIST

### Before Running Scripts
- [ ] Backup the database
- [ ] Review both SQL scripts completely
- [ ] Understand rollback plan

### After Running phase2a-roles-enum.sql
- [ ] Verify new enum values exist: `SELECT unnest(enum_range(NULL::app_role))`
- [ ] Commit the transaction

### After Running phase2b-roles.sql
- [ ] Verify role migration: check user_roles table
- [ ] Verify system_admin users have school_id = NULL
- [ ] Verify school_settings has new columns
- [ ] Test helper functions manually
- [ ] Check policies are in place

### Manual Testing (Critical)
1. **Matron Scope**:
   - [ ] Matron can see only female students (and those with no gender)
   - [ ] Matron cannot record conduct for male students
   - [ ] Matron sees "Girls" badge in header

2. **Patron Scope**:
   - [ ] Patron can see only male students (and those with no gender)
   - [ ] Patron cannot record conduct for female students
   - [ ] Patron sees "Boys" badge in header

3. **Master of Discipline & School Director**:
   - [ ] Can see all students regardless of gender
   - [ ] No scope badge shown

4. **Permissions**:
   - [ ] Matron with view_audit_logs=false cannot access /audit-logs
   - [ ] Matron with delete_students=false cannot delete students
   - [ ] School Director always has all permissions

5. **School Director Staff Management**:
   - [ ] Can invite staff into their own school only
   - [ ] Cannot assign system_admin role
   - [ ] Cannot see or edit platform owner
   - [ ] Can change role titles
   - [ ] Can toggle permissions (matrons/patrons only)

6. **Platform Owner**:
   - [ ] Lands on /platform after sign-in
   - [ ] Can suspend/reactivate schools
   - [ ] Suspension blocks school staff immediately
   - [ ] Reactivation restores access with all data intact
   - [ ] Support view works: can pick school and see as that school
   - [ ] Actions in support view log to that school's audit_logs

7. **Sign-up Flow**:
   - [ ] New self-sign-up has no role, no school
   - [ ] User sees "waiting for activation" screen
   - [ ] After director assigns role+school, user can access system

8. **Audit Logs**:
   - [ ] Role assignment/removal is logged
   - [ ] Permission changes are logged
   - [ ] School status changes are logged

## BUILD STATUS

- TypeScript check: ✅ PASSED (no errors)
- Build: ✅ SUCCESS (built in 4m 21s)

## NOTES

- The app includes fallbacks for missing columns/enum values (backwards compatible)
- Old enum values (school_leader, discipline_admin) are kept for safety
- Helper functions treat old roles as equivalent to new ones
- queryClient.clear() is called on sign-out to prevent data leakage
- All database policies are RESTRICTIVE and combined with existing "Same school only"

## FILES MODIFIED

### Created
- supabase/phase2a-roles-enum.sql
- supabase/phase2b-roles.sql
- PHASE2_IMPLEMENTATION_STATUS.md (this file)

### Modified
- CLAUDE.md (added Final report section)
- src/hooks/useAuth.tsx (complete rewrite for new role system)
- src/hooks/useSchoolSettings.ts (added role_titles and permissions fields)
- src/components/DashboardShell.tsx (new role helpers, scope badge, permission filtering)
- src/routes/_authenticated/audit-logs.tsx (permission-based access)
- src/routes/auth.tsx (removed role selection from sign-up)
- src/routes/_authenticated/settings.tsx (added Staff & Roles tab with full staff management UI)
- src/routes/_authenticated/students.tsx (added gender warning badges, missing sex filter, permission check for delete)
- src/routes/_authenticated/reports.tsx (added permission check for view_reports)
- src/routes/_authenticated/conduct-actions.tsx (added permission checks for photos and messaging)

### Need Modification (REMAINING FOR FUTURE)
- Support view school picker with banner and audit logging (skipped due to token constraints)

### Created (Prompt 3B/3C)
- src/lib/school.functions.ts (NEW - staff management functions: invite, updateRole, setActive, list, searchUserByEmail, addExistingStaff)
- supabase/phase3c-fixes.sql (NEW - fixes for production issues: school_settings sequence, audit_logs columns, triggers)

## ESTIMATED REMAINING WORK (for Prompt 3C)

- Platform portal updates (new roles, suspension UI): 3-4 hours
- Support view implementation: 2-3 hours
- Platform owner routing: 1 hour
- Additional audit logging review: 1-2 hours
- Testing & bug fixes: 4-6 hours

**TOTAL: 11-16 hours of additional development**

Prompt 3B completed approximately 10-12 hours of work.
