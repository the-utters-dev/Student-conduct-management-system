import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const PLANS = ["trial", "basic", "pro", "enterprise"] as const;
export const SCHOOL_STATUSES = ["active", "suspended", "cancelled"] as const;
export const STAFF_ROLES = ["school_director", "master_of_discipline", "matron", "patron", "discipline_admin", "school_leader"] as const;
export type Plan = (typeof PLANS)[number];
export type SchoolStatus = (typeof SCHOOL_STATUSES)[number];
export type StaffRole = (typeof STAFF_ROLES)[number];

export interface PlatformSchool {
  id: string;
  name: string;
  plan: Plan;
  status: SchoolStatus;
  status_reason: string | null;
  status_changed_at: string | null;
  status_changed_by: string | null;
  trial_ends_at: string | null;
  student_limit: number | null;
  created_at: string;
  staff_count: number;
  student_count: number;
  last_activity: string | null;
}

export interface PlatformStaff {
  id: string;
  full_name: string;
  email: string | null;
  school_id: string | null;
  roles: string[];
}

const UUID = /^[0-9a-f-]{36}$/i;

async function adminFor(context: { supabase: SupabaseClient; userId: string }) {
  const { data } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId)
    .eq("role", "system_admin");
  if (!data?.length) throw new Error("Only System Administrators can use the platform portal.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as SupabaseClient;
}

function missingSetup(e: { code?: string; message?: string } | null) {
  if (e && (e.code === "42P01" || e.code === "42703" || e.code === "PGRST205" || e.code === "PGRST204"))
    return new Error("The multi-tenant database script (supabase/saas-multi-tenant.sql) hasn't been run yet.");
  return e ? new Error(e.message ?? "Request failed") : null;
}

export const getPlatformOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await adminFor(context as never);
    const [schoolsRes, profilesRes, rolesRes, studentsRes, conductsRes] = await Promise.all([
      admin.from("schools").select("*").order("created_at"),
      admin.from("profiles").select("id, full_name, email, school_id").order("full_name"),
      admin.from("user_roles").select("user_id, role"),
      admin.from("students").select("school_id"),
      admin.from("conduct_logs").select("school_id, created_at").order("created_at", { ascending: false }),
    ]);
    const err = missingSetup(schoolsRes.error ?? profilesRes.error ?? studentsRes.error);
    if (err) throw err;

    // Build roles map
    const roles = new Map<string, string[]>();
    (rolesRes.data ?? []).forEach((r) => roles.set(r.user_id, [...(roles.get(r.user_id) ?? []), r.role]));

    // Build staff list (exclude system_admin from school staff counts)
    const staff: PlatformStaff[] = (profilesRes.data ?? []).map((p) => ({
      ...p,
      roles: roles.get(p.id) ?? [],
    }));

    const count = (rows: { school_id: string | null }[], id: string) =>
      rows.filter((r) => r.school_id === id).length;

    // Calculate last activity per school (most recent conduct entry)
    const lastActivity = new Map<string, string>();
    (conductsRes.data ?? []).forEach((c) => {
      if (c.school_id && !lastActivity.has(c.school_id)) {
        lastActivity.set(c.school_id, c.created_at);
      }
    });

    const schools: PlatformSchool[] = (schoolsRes.data ?? []).map((s) => ({
      ...s,
      staff_count: staff.filter((p) => p.school_id === s.id && !p.roles.includes("system_admin")).length,
      student_count: count(studentsRes.data ?? [], s.id),
      last_activity: lastActivity.get(s.id) ?? null,
    }));
    return { schools, staff };
  });

export const getSchoolDetails = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => {
    if (!UUID.test(d.id)) throw new Error("Invalid school ID.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const admin = await adminFor(context as never);

    // Fetch school data
    const { data: school, error: schoolError } = await admin
      .from("schools")
      .select("*")
      .eq("id", data.id)
      .single();

    if (schoolError) throw new Error(schoolError.message);
    if (!school) throw new Error("School not found.");

    // Fetch student count
    const { count: studentCount } = await admin
      .from("students")
      .select("*", { count: "exact", head: true })
      .eq("school_id", data.id);

    // Fetch staff count (exclude system_admin)
    const { data: staffData } = await admin
      .from("profiles")
      .select("id, school_id")
      .eq("school_id", data.id);

    const { data: rolesData } = await admin
      .from("user_roles")
      .select("user_id, role");

    const roles = new Map<string, string[]>();
    (rolesData ?? []).forEach((r) => roles.set(r.user_id, [...(roles.get(r.user_id) ?? []), r.role]));

    const staffCount = (staffData ?? []).filter(s => !roles.get(s.id)?.includes("system_admin")).length;

    // Fetch last activity (most recent conduct entry)
    const { data: lastLog } = await admin
      .from("conduct_logs")
      .select("created_at")
      .eq("school_id", data.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Fetch entries this term
    const { data: activeTerm } = await admin
      .from("academic_terms")
      .select("id")
      .eq("school_id", data.id)
      .eq("is_active", true)
      .maybeSingle();

    let entriesThisTerm = 0;
    if (activeTerm) {
      const { count } = await admin
        .from("conduct_logs")
        .select("*", { count: "exact", head: true })
        .eq("school_id", data.id)
        .eq("term_id", activeTerm.id);
      entriesThisTerm = count ?? 0;
    }

    return {
      ...school,
      student_count: studentCount ?? 0,
      staff_count: staffCount,
      last_activity: lastLog?.created_at ?? null,
      entries_this_term: entriesThisTerm,
    };
  });

export const createSchool = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { name: string; plan: Plan; trial_ends_at: string | null; student_limit: number | null }) => {
    const name = String(d.name ?? "").trim();
    if (name.length < 2 || name.length > 120) throw new Error("School name must be 2–120 characters.");
    if (!PLANS.includes(d.plan)) throw new Error("Unknown plan.");
    return { name, plan: d.plan, trial_ends_at: d.trial_ends_at || null, student_limit: d.student_limit ?? null };
  })
  .handler(async ({ data, context }) => {
    const admin = await adminFor(context as never);
    const { data: row, error } = await admin.from("schools").insert(data).select("id, name").single();
    const err = missingSetup(error);
    if (err) throw err;
    await admin.from("audit_logs").insert({
      user_id: (context as { userId: string }).userId,
      action: "CREATE_SCHOOL",
      entity_type: "schools",
      entity_id: row!.id,
      payload: data,
      school_id: row!.id,
    });
    return row as { id: string; name: string };
  });

export const updateSchool = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { id: string; name?: string; plan?: Plan; status?: SchoolStatus; trial_ends_at?: string | null; student_limit?: number | null }) => {
      if (!UUID.test(d.id)) throw new Error("Invalid school ID.");
      if (d.plan && !PLANS.includes(d.plan)) throw new Error("Unknown plan.");
      if (d.status && !SCHOOL_STATUSES.includes(d.status)) throw new Error("Unknown status.");
      return d;
    },
  )
  .handler(async ({ data, context }) => {
    const admin = await adminFor(context as never);
    const { id, ...patch } = data;
    const { error } = await admin.from("schools").update(patch).eq("id", id);
    const err = missingSetup(error);
    if (err) throw err;
    await admin.from("audit_logs").insert({
      user_id: (context as { userId: string }).userId,
      action: "UPDATE_SCHOOL_SUBSCRIPTION",
      entity_type: "schools",
      entity_id: id,
      payload: patch,
      school_id: id,
    });
    return { ok: true };
  });

async function setStaffRole(admin: SupabaseClient, userId: string, role: StaffRole) {
  // Remove all other school roles (not system_admin)
  await admin.from("user_roles").delete().eq("user_id", userId).in("role", [...STAFF_ROLES]);
  // Upsert the new role (idempotent - safe if trigger already created it)
  const { error } = await admin.from("user_roles").upsert({ user_id: userId, role }, { onConflict: "user_id,role" });
  if (error) throw new Error(error.message);
}

export const assignStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { user_id: string; school_id: string | null; role: StaffRole }) => {
    if (!UUID.test(d.user_id) || (d.school_id && !UUID.test(d.school_id))) throw new Error("Invalid ID.");
    if (!STAFF_ROLES.includes(d.role)) throw new Error("Unknown role.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const admin = await adminFor(context as never);
    const { error } = await admin.from("profiles").update({ school_id: data.school_id }).eq("id", data.user_id);
    const err = missingSetup(error);
    if (err) throw err;
    await setStaffRole(admin, data.user_id, data.role);
    return { ok: true };
  });

export const inviteStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { email: string; full_name: string; school_id: string; role: StaffRole; redirect_to: string }) => {
    if (!d || typeof d !== "object") {
      throw new Error("Missing invite details. Please provide email, full name, school, and role.");
    }
    const email = String(d.email ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
    if (!UUID.test(d.school_id)) throw new Error("Choose a school.");
    if (!STAFF_ROLES.includes(d.role)) throw new Error("Unknown role.");
    return { ...d, email, full_name: String(d.full_name ?? "").trim().slice(0, 120) };
  })
  .handler(async ({ data, context }) => {
    const admin = await adminFor(context as never);
    const { data: invited, error } = await admin.auth.admin.inviteUserByEmail(data.email, {
      data: { full_name: data.full_name, user_role: data.role },
      redirectTo: data.redirect_to,
    });
    if (error) {
      // Check if user already exists
      if (error.message.includes("already registered")) {
        throw new Error(`A user with email ${data.email} already exists.`);
      }
      // Check for rate limit
      if (error.message.includes("rate limit") || error.message.includes("too many")) {
        throw new Error("Email rate limit reached. Please wait a few minutes and try again.");
      }
      // Friendly error for other cases
      throw new Error(`Failed to send invitation: ${error.message}`);
    }
    const userId = invited.user.id;
    const { error: pErr } = await admin.from("profiles").update({ school_id: data.school_id }).eq("id", userId);
    const err = missingSetup(pErr);
    if (err) throw err;
    await setStaffRole(admin, userId, data.role);
    return { id: userId };
  });

/**
 * Renames a school.
 * Only platform admins can rename schools.
 */
export const renameSchool = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; name: string }) => {
    if (!UUID.test(d.id)) throw new Error("Invalid school ID.");
    const name = String(d.name ?? "").trim();
    if (name.length < 2 || name.length > 120) throw new Error("School name must be 2–120 characters.");
    return { id: d.id, name };
  })
  .handler(async ({ data, context }) => {
    const admin = await adminFor(context as never);
    const { error } = await admin.from("schools").update({ name: data.name }).eq("id", data.id);
    if (error) throw new Error(error.message);
    await admin.from("audit_logs").insert({
      user_id: (context as { userId: string }).userId,
      action: "RENAME_SCHOOL",
      entity_type: "school",
      entity_id: data.id,
      payload: { new_name: data.name },
      school_id: data.id,
    });
    return { ok: true };
  });

/**
 * Updates school status with a required reason for suspension/cancellation.
 * Only platform admins can change school status.
 */
export const updateSchoolStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; status: SchoolStatus; reason: string }) => {
    if (!UUID.test(d.id)) throw new Error("Invalid school ID.");
    if (!SCHOOL_STATUSES.includes(d.status)) throw new Error("Unknown status.");
    const reason = String(d.reason ?? "").trim();
    if ((d.status === "suspended" || d.status === "cancelled") && reason.length < 3) {
      throw new Error("Please provide a reason for suspension or cancellation.");
    }
    return { id: d.id, status: d.status, reason };
  })
  .handler(async ({ data, context }) => {
    const admin = await adminFor(context as never);
    const userId = (context as { userId: string }).userId;

    // Update school with status, reason, and tracking fields
    const { error } = await admin
      .from("schools")
      .update({
        status: data.status,
        status_reason: data.reason,
        status_changed_at: new Date().toISOString(),
        status_changed_by: userId,
      })
      .eq("id", data.id);

    if (error) throw new Error(error.message);

    // Audit log (the trigger will also log, but this gives us more control over the message)
    await admin.from("audit_logs").insert({
      user_id: userId,
      action: "UPDATE_SCHOOL_STATUS",
      entity_type: "school",
      entity_id: data.id,
      payload: { new_status: data.status, reason: data.reason },
      school_id: data.id,
    });

    return { ok: true };
  });

/**
 * Permanently deletes a school and all its data.
 * Only allowed when school status is "cancelled".
 * Cannot delete the default school (00000000-0000-0000-0000-000000000001).
 */
export const deleteSchool = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; name_confirmation: string }) => {
    if (!UUID.test(d.id)) throw new Error("Invalid school ID.");
    if (d.id === "00000000-0000-0000-0000-000000000001") {
      throw new Error("Cannot delete the default school.");
    }
    return d;
  })
  .handler(async ({ data, context }) => {
    const admin = await adminFor(context as never);
    const userId = (context as { userId: string }).userId;

    // Get school details
    const { data: school, error: schoolError } = await admin
      .from("schools")
      .select("id, name, status")
      .eq("id", data.id)
      .maybeSingle();

    if (schoolError || !school) throw new Error("School not found.");

    // Verify status is cancelled
    if (school.status !== "cancelled") {
      throw new Error("School must be cancelled before deletion. Change status to 'cancelled' first.");
    }

    // Verify name confirmation
    if (school.name !== data.name_confirmation) {
      throw new Error(`School name confirmation does not match. Type "${school.name}" exactly.`);
    }

    // Count rows for audit log
    const counts: Record<string, number> = {};
    const tables = [
      "students",
      "conduct_logs",
      "notification_logs",
      "student_academic_history",
      "good_deed_categories",
      "offenses_catalog",
      "academic_terms",
      "school_settings",
      "audit_logs",
    ];

    for (const table of tables) {
      const { count } = await admin.from(table).select("*", { count: "exact", head: true }).eq("school_id", data.id);
      counts[table] = count ?? 0;
    }

    // Delete storage files under this school's folder
    const { data: files } = await admin.storage.from("conduct-evidence").list(data.id);
    if (files && files.length > 0) {
      const filePaths = files.map((f) => `${data.id}/${f.name}`);
      await admin.storage.from("conduct-evidence").remove(filePaths);
    }

    // Delete database records in correct order (respecting foreign key constraints)
    // Note: conduct_log_photos and evidence_links might not exist yet
    try {
      await admin.from("conduct_log_photos").delete().eq("school_id", data.id);
    } catch {
      // Table might not exist
    }
    try {
      await admin.from("evidence_links").delete().eq("school_id", data.id);
    } catch {
      // Table might not exist
    }

    await admin.from("notification_logs").delete().eq("school_id", data.id);
    await admin.from("conduct_logs").delete().eq("school_id", data.id);
    await admin.from("student_academic_history").delete().eq("school_id", data.id);
    await admin.from("students").delete().eq("school_id", data.id);
    await admin.from("good_deed_categories").delete().eq("school_id", data.id);
    await admin.from("offenses_catalog").delete().eq("school_id", data.id);
    await admin.from("academic_terms").delete().eq("school_id", data.id);
    await admin.from("school_settings").delete().eq("school_id", data.id);
    await admin.from("audit_logs").delete().eq("school_id", data.id);

    // Delete staff accounts that belong ONLY to this school (not system_admin)
    const { data: schoolStaff } = await admin.from("profiles").select("id").eq("school_id", data.id);
    if (schoolStaff && schoolStaff.length > 0) {
      const staffIds = schoolStaff.map((s) => s.id);

      // Check which are system_admin
      const { data: adminRoles } = await admin
        .from("user_roles")
        .select("user_id")
        .in("user_id", staffIds)
        .eq("role", "system_admin");

      const adminIds = new Set((adminRoles ?? []).map((r) => r.user_id));

      // Delete non-admin accounts
      for (const staffId of staffIds) {
        if (!adminIds.has(staffId)) {
          await admin.auth.admin.deleteUser(staffId);
        }
      }
    }

    // Finally, delete the school row
    await admin.from("schools").delete().eq("id", data.id);

    // Write platform-level audit log (school_id is NULL since the school is deleted)
    await admin.from("audit_logs").insert({
      user_id: userId,
      action: "DELETE_SCHOOL",
      entity_type: "school",
      entity_id: data.id,
      payload: {
        school_name: school.name,
        school_id: data.id,
        row_counts: counts,
      },
      school_id: null,
    });

    return { ok: true };
  });

/**
 * Downloads school data as JSON (for backup before deletion).
 * Only platform admins can download school data.
 */
export const downloadSchoolData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => {
    if (!UUID.test(d.id)) throw new Error("Invalid school ID.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const admin = await adminFor(context as never);

    // Get school details
    const { data: school } = await admin.from("schools").select("*").eq("id", data.id).maybeSingle();
    if (!school) throw new Error("School not found.");

    // Collect all data
    const [students, conducts, notifications, history, categories, offenses, terms, settings, audits] = await Promise.all([
      admin.from("students").select("*").eq("school_id", data.id),
      admin.from("conduct_logs").select("*").eq("school_id", data.id),
      admin.from("notification_logs").select("*").eq("school_id", data.id),
      admin.from("student_academic_history").select("*").eq("school_id", data.id),
      admin.from("good_deed_categories").select("*").eq("school_id", data.id),
      admin.from("offenses_catalog").select("*").eq("school_id", data.id),
      admin.from("academic_terms").select("*").eq("school_id", data.id),
      admin.from("school_settings").select("*").eq("school_id", data.id),
      admin.from("audit_logs").select("*").eq("school_id", data.id),
    ]);

    const backup = {
      school,
      students: students.data ?? [],
      conduct_logs: conducts.data ?? [],
      notification_logs: notifications.data ?? [],
      student_academic_history: history.data ?? [],
      good_deed_categories: categories.data ?? [],
      offenses_catalog: offenses.data ?? [],
      academic_terms: terms.data ?? [],
      school_settings: settings.data ?? [],
      audit_logs: audits.data ?? [],
      exported_at: new Date().toISOString(),
      exported_by: (context as { userId: string }).userId,
    };

    return backup;
  });

/**
 * Generates a strong 10-character temporary password and sets it for a user.
 * Platform admins can set temporary passwords for any user.
 * Returns the password to be shown ONCE in the UI.
 */
export const setTemporaryPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { user_id: string }) => {
    if (!UUID.test(d.user_id)) throw new Error("Invalid user ID.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const admin = await adminFor(context as never);

    // Generate a strong 10-character password
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&*";
    let tempPassword = "";
    const array = new Uint8Array(10);
    crypto.getRandomValues(array);
    for (let i = 0; i < 10; i++) {
      tempPassword += chars[array[i]! % chars.length];
    }

    // Set the password and mark that user must change it
    const { error } = await admin.auth.admin.updateUserById(data.user_id, {
      password: tempPassword,
      user_metadata: { must_change_password: true },
    });

    if (error) throw new Error(error.message);

    // Get user details for audit log
    const { data: profile } = await admin
      .from("profiles")
      .select("school_id")
      .eq("id", data.user_id)
      .maybeSingle();

    // Write audit log
    await admin.from("audit_logs").insert({
      user_id: (context as { userId: string }).userId,
      action: "PASSWORD_TEMP_SET",
      entity_type: "auth",
      entity_id: data.user_id,
      payload: { target_user_id: data.user_id },
      school_id: profile?.school_id ?? null,
    });

    // Return the temporary password (to be shown ONCE)
    return { password: tempPassword };
  });

/**
 * Creates a user account without sending an email.
 * Platform admins can create accounts in any school.
 * School Directors can only create accounts in their own school, and cannot create system_admin.
 * Returns the user ID and temporary password.
 */
export const createAccountWithoutEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { email: string; full_name: string; school_id: string; role: StaffRole }) => {
    const email = String(d.email ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
    if (!UUID.test(d.school_id)) throw new Error("Choose a school.");
    if (!STAFF_ROLES.includes(d.role)) throw new Error("Unknown role.");
    if (d.role === "discipline_admin" || d.role === "school_leader") {
      throw new Error("Legacy roles cannot be assigned to new accounts.");
    }
    return { ...d, email, full_name: String(d.full_name ?? "").trim().slice(0, 120) };
  })
  .handler(async ({ data, context }) => {
    const userId = (context as { userId: string }).userId;
    const { supabase } = context as { supabase: SupabaseClient };

    // Check if caller is platform admin or school director
    const { data: callerRoles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .in("role", ["system_admin", "school_director", "school_leader"]);

    const isPlatformAdmin = callerRoles?.some((r) => r.role === "system_admin");
    const isSchoolDirector = callerRoles?.some((r) => r.role === "school_director" || r.role === "school_leader");

    if (!isPlatformAdmin && !isSchoolDirector) {
      throw new Error("Only System Administrators or School Directors can create accounts.");
    }

    // If not platform admin, verify they're creating for their own school
    if (!isPlatformAdmin) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: callerProfile } = await supabaseAdmin
        .from("profiles")
        .select("school_id")
        .eq("id", userId)
        .maybeSingle();

      if (callerProfile?.school_id !== data.school_id) {
        throw new Error("School Directors can only create accounts for their own school.");
      }
    }

    // Note: system_admin role is not in StaffRole type (it's a platform-only role)

    const admin = isPlatformAdmin
      ? await adminFor(context as never)
      : (await import("@/integrations/supabase/client.server")).supabaseAdmin as unknown as SupabaseClient;

    // Generate a strong 10-character password
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&*";
    let tempPassword = "";
    const array = new Uint8Array(10);
    crypto.getRandomValues(array);
    for (let i = 0; i < 10; i++) {
      tempPassword += chars[array[i]! % chars.length];
    }

    // Create user with admin API
    const { data: created, error } = await admin.auth.admin.createUser({
      email: data.email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        full_name: data.full_name,
        must_change_password: true
      },
    });

    if (error) {
      if (error.message.includes("already registered") || error.message.includes("duplicate")) {
        throw new Error(`A user with email ${data.email} already exists.`);
      }
      throw new Error(`Failed to create account: ${error.message}`);
    }

    const newUserId = created.user.id;

    // Assign school and role
    const { error: pErr } = await admin.from("profiles").update({ school_id: data.school_id }).eq("id", newUserId);
    const err = missingSetup(pErr);
    if (err) throw err;

    await setStaffRole(admin, newUserId, data.role);

    // Write audit log
    await admin.from("audit_logs").insert({
      user_id: userId,
      action: "CREATE_ACCOUNT_NO_EMAIL",
      entity_type: "auth",
      entity_id: newUserId,
      payload: {
        email: data.email,
        full_name: data.full_name,
        school_id: data.school_id,
        role: data.role
      },
      school_id: data.school_id,
    });

    return { user_id: newUserId, password: tempPassword };
  });

// =============================================================================
// School Payments Management
// =============================================================================

export const recordSchoolPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    school_id: string;
    payment_date: string;
    amount: number;
    method: string;
    reference?: string;
    period_covered?: string;
    note?: string;
  }) => {
    if (!UUID.test(d.school_id)) throw new Error("Invalid school ID.");
    if (!d.payment_date) throw new Error("Payment date is required.");
    if (!d.amount || d.amount <= 0) throw new Error("Amount must be greater than 0.");
    if (!["MTN MoMo", "Airtel Money", "Bank", "Cash"].includes(d.method)) {
      throw new Error("Invalid payment method.");
    }
    return d;
  })
  .handler(async ({ data, context }) => {
    const admin = await adminFor(context as never);
    const userId = (context as { userId: string }).userId;

    const { data: payment, error } = await admin
      .from("school_payments")
      .insert({
        school_id: data.school_id,
        payment_date: data.payment_date,
        amount: data.amount,
        method: data.method,
        reference: data.reference || null,
        period_covered: data.period_covered || null,
        note: data.note || null,
        recorded_by: userId,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);

    return payment;
  });

export const getSchoolPayments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { school_id: string }) => {
    if (!UUID.test(d.school_id)) throw new Error("Invalid school ID.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const admin = await adminFor(context as never);

    const { data: payments, error } = await admin
      .from("school_payments")
      .select("*")
      .eq("school_id", data.school_id)
      .order("payment_date", { ascending: false });

    if (error) throw new Error(error.message);

    return payments ?? [];
  });

// =============================================================================
// School Support Notes Management
// =============================================================================

export const createSupportNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    school_id: string;
    subject: string;
    status: "open" | "resolved";
    note: string;
  }) => {
    if (!UUID.test(d.school_id)) throw new Error("Invalid school ID.");
    if (!d.subject?.trim()) throw new Error("Subject is required.");
    if (!d.note?.trim()) throw new Error("Note is required.");
    if (!["open", "resolved"].includes(d.status)) throw new Error("Invalid status.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const admin = await adminFor(context as never);
    const userId = (context as { userId: string }).userId;

    const { data: note, error } = await admin
      .from("school_support_notes")
      .insert({
        school_id: data.school_id,
        subject: data.subject.trim(),
        status: data.status,
        note: data.note.trim(),
        created_by: userId,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);

    return note;
  });

export const getSchoolSupportNotes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { school_id: string }) => {
    if (!UUID.test(d.school_id)) throw new Error("Invalid school ID.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const admin = await adminFor(context as never);

    const { data: notes, error } = await admin
      .from("school_support_notes")
      .select("*")
      .eq("school_id", data.school_id)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);

    return notes ?? [];
  });

export const updateSupportNoteStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; status: "open" | "resolved" }) => {
    if (!UUID.test(d.id)) throw new Error("Invalid note ID.");
    if (!["open", "resolved"].includes(d.status)) throw new Error("Invalid status.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const admin = await adminFor(context as never);

    const { error } = await admin
      .from("school_support_notes")
      .update({ status: data.status })
      .eq("id", data.id);

    if (error) throw new Error(error.message);

    return { ok: true };
  });
