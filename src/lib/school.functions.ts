import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const SCHOOL_ROLES = ["school_director", "master_of_discipline", "matron", "patron"] as const;
export type SchoolRole = (typeof SCHOOL_ROLES)[number];

export interface SchoolStaffMember {
  id: string;
  full_name: string;
  email: string | null;
  roles: string[];
  is_active: boolean;
  school_id: string | null;
}

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Ensures the caller is a School Director for their school.
 * Returns the school_id and admin client.
 */
async function requireSchoolDirector(context: { supabase: SupabaseClient; userId: string }) {
  // Get caller's school and role
  const { data: profile } = await context.supabase
    .from("profiles")
    .select("school_id")
    .eq("id", context.userId)
    .maybeSingle();

  if (!profile?.school_id) {
    throw new Error("You must belong to a school to perform this action.");
  }

  // Check if caller is a school director
  const { data: roles } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId)
    .in("role", ["school_director", "school_leader"]); // Include legacy for backwards compatibility

  if (!roles?.length) {
    throw new Error("Only School Directors can manage staff.");
  }

  // Import admin client
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return { schoolId: profile.school_id, admin: supabaseAdmin as unknown as SupabaseClient };
}

/**
 * Lists all staff members in the caller's school.
 * Excludes system_admin accounts (platform owners).
 */
export const listSchoolStaff = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { schoolId, admin } = await requireSchoolDirector(context as never);

    // Get all profiles for this school
    const { data: profiles, error: profilesError } = await admin
      .from("profiles")
      .select("id, full_name, email, school_id")
      .eq("school_id", schoolId)
      .order("full_name");

    if (profilesError) throw new Error(profilesError.message);

    // Get all roles
    const { data: rolesData } = await admin
      .from("user_roles")
      .select("user_id, role")
      .in("user_id", (profiles ?? []).map((p) => p.id));

    // Build roles map, excluding system_admin
    const rolesMap = new Map<string, string[]>();
    (rolesData ?? []).forEach((r) => {
      if (r.role !== "system_admin") {
        const existing = rolesMap.get(r.user_id) ?? [];
        rolesMap.set(r.user_id, [...existing, r.role]);
      }
    });

    // Get active status from auth.users via admin API
    const { data: authUsers } = await admin.auth.admin.listUsers();
    const bannedUsers = new Set(
      (authUsers.users ?? [])
        .filter((u) => u.banned_until && new Date(u.banned_until) > new Date())
        .map((u) => u.id)
    );

    const staff: SchoolStaffMember[] = (profiles ?? [])
      .filter((p) => {
        const roles = rolesMap.get(p.id) ?? [];
        // Exclude users who only have system_admin role (they shouldn't be in this school anyway)
        return roles.length > 0;
      })
      .map((p) => ({
        id: p.id,
        full_name: p.full_name,
        email: p.email,
        school_id: p.school_id,
        roles: rolesMap.get(p.id) ?? [],
        is_active: !bannedUsers.has(p.id),
      }));

    return staff;
  });

/**
 * Invites a new staff member to the caller's school.
 * Only School Directors can invite staff.
 * Never allows assigning system_admin role.
 */
export const inviteSchoolStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { email: string; full_name: string; role: SchoolRole }) => {
    const email = String(d.email ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("Enter a valid email address.");
    }
    const full_name = String(d.full_name ?? "").trim();
    if (full_name.length < 2 || full_name.length > 120) {
      throw new Error("Full name must be 2-120 characters.");
    }
    if (!SCHOOL_ROLES.includes(d.role)) {
      throw new Error("Invalid role. Must be one of: School Director, Master of Discipline, Matron, Patron.");
    }
    return { email, full_name, role: d.role };
  })
  .handler(async ({ data, context }) => {
    const { schoolId, admin } = await requireSchoolDirector(context as never);
    const userId = (context as { userId: string }).userId;

    // Create invitation with metadata
    const { data: invited, error } = await admin.auth.admin.inviteUserByEmail(data.email, {
      data: {
        full_name: data.full_name,
        role: data.role,
        school_id: schoolId,
      },
      redirectTo: `${process.env["VITE_APP_URL"] ?? "http://localhost:3000"}/auth`,
    });

    if (error) {
      // Check if user already exists
      if (error.message.includes("already registered")) {
        throw new Error(`A user with email ${data.email} already exists. Use the staff list to assign them to your school.`);
      }
      throw new Error(error.message);
    }

    const invitedUserId = invited.user.id;

    // Set school_id in profiles (the trigger will create the profile, but we ensure school_id is set)
    const { error: profileError } = await admin
      .from("profiles")
      .update({ school_id: schoolId })
      .eq("id", invitedUserId);

    if (profileError) {
      console.error("Error setting school_id:", profileError);
    }

    // Assign the role
    const { error: roleError } = await admin
      .from("user_roles")
      .insert({ user_id: invitedUserId, role: data.role });

    if (roleError) {
      console.error("Error assigning role:", roleError);
    }

    // Write audit log
    await admin.from("audit_logs").insert({
      school_id: schoolId,
      user_id: userId,
      action: "invite_staff",
      details: {
        invited_user_id: invitedUserId,
        email: data.email,
        full_name: data.full_name,
        role: data.role,
      },
    });

    return { id: invitedUserId, email: data.email };
  });

/**
 * Updates a staff member's role.
 * Only School Directors can update roles.
 * Cannot assign system_admin role.
 * Cannot remove the last School Director role.
 */
export const updateStaffRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { user_id: string; role: SchoolRole }) => {
    if (!UUID.test(d.user_id)) throw new Error("Invalid user ID.");
    if (!SCHOOL_ROLES.includes(d.role)) {
      throw new Error("Invalid role. Must be one of: School Director, Master of Discipline, Matron, Patron.");
    }
    return d;
  })
  .handler(async ({ data, context }) => {
    const { schoolId, admin } = await requireSchoolDirector(context as never);
    const callerId = (context as { userId: string }).userId;

    // Verify target user belongs to this school
    const { data: targetProfile } = await admin
      .from("profiles")
      .select("school_id")
      .eq("id", data.user_id)
      .maybeSingle();

    if (!targetProfile || targetProfile.school_id !== schoolId) {
      throw new Error("This staff member does not belong to your school.");
    }

    // Check if target user is a system_admin
    const { data: targetRoles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user_id);

    if (targetRoles?.some((r) => r.role === "system_admin")) {
      throw new Error("Cannot modify roles for platform administrators.");
    }

    // If removing school_director role, ensure it's not the last director
    const currentRoles = (targetRoles ?? []).map((r) => r.role);
    const isCurrentlyDirector = currentRoles.some((r) => r === "school_director" || r === "school_leader");
    const willBeDirector = data.role === "school_director";

    if (isCurrentlyDirector && !willBeDirector && data.user_id !== callerId) {
      // Check if there are other directors
      const { data: allDirectors } = await admin
        .from("user_roles")
        .select("user_id")
        .in("role", ["school_director", "school_leader"]);

      const { data: schoolProfiles } = await admin
        .from("profiles")
        .select("id")
        .eq("school_id", schoolId)
        .in("id", (allDirectors ?? []).map((d) => d.user_id));

      const directorCount = (schoolProfiles ?? []).filter((p) => p.id !== data.user_id).length;

      if (directorCount === 0) {
        throw new Error("Cannot remove the last School Director. Assign another director first.");
      }
    }

    // Special check: prevent director from removing their own director role if they're the last one
    if (data.user_id === callerId && isCurrentlyDirector && !willBeDirector) {
      const { data: allDirectors } = await admin
        .from("user_roles")
        .select("user_id")
        .in("role", ["school_director", "school_leader"]);

      const { data: schoolProfiles } = await admin
        .from("profiles")
        .select("id")
        .eq("school_id", schoolId)
        .in("id", (allDirectors ?? []).map((d) => d.user_id));

      const otherDirectorCount = (schoolProfiles ?? []).filter((p) => p.id !== callerId).length;

      if (otherDirectorCount === 0) {
        throw new Error("You cannot remove your own School Director role because you are the last director. Assign another director first.");
      }
    }

    // Remove all school roles (not system_admin)
    await admin
      .from("user_roles")
      .delete()
      .eq("user_id", data.user_id)
      .in("role", [...SCHOOL_ROLES, "school_leader", "discipline_admin"]);

    // Assign new role
    const { error: roleError } = await admin
      .from("user_roles")
      .insert({ user_id: data.user_id, role: data.role });

    if (roleError) throw new Error(roleError.message);

    // Write audit log
    await admin.from("audit_logs").insert({
      school_id: schoolId,
      user_id: callerId,
      action: "update_staff_role",
      details: {
        target_user_id: data.user_id,
        old_roles: currentRoles,
        new_role: data.role,
      },
    });

    return { ok: true };
  });

/**
 * Activates or deactivates a staff member.
 * Only School Directors can activate/deactivate staff.
 * Cannot deactivate system_admin accounts.
 * Uses Supabase Admin API ban_duration to block sign-in without deleting data.
 */
export const setStaffActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { user_id: string; active: boolean }) => {
    if (!UUID.test(d.user_id)) throw new Error("Invalid user ID.");
    if (typeof d.active !== "boolean") throw new Error("Active must be true or false.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { schoolId, admin } = await requireSchoolDirector(context as never);
    const callerId = (context as { userId: string }).userId;

    // Verify target user belongs to this school
    const { data: targetProfile } = await admin
      .from("profiles")
      .select("school_id")
      .eq("id", data.user_id)
      .maybeSingle();

    if (!targetProfile || targetProfile.school_id !== schoolId) {
      throw new Error("This staff member does not belong to your school.");
    }

    // Check if target user is a system_admin
    const { data: targetRoles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user_id);

    if (targetRoles?.some((r) => r.role === "system_admin")) {
      throw new Error("Cannot deactivate platform administrators.");
    }

    // Prevent self-deactivation
    if (data.user_id === callerId && !data.active) {
      throw new Error("You cannot deactivate your own account.");
    }

    // Use Admin API to ban/unban the user
    // Ban duration: 100 years into the future for deactivation, or null for activation
    const banDuration = data.active ? "none" : "876000h"; // 100 years in hours

    const { error } = await admin.auth.admin.updateUserById(data.user_id, {
      ban_duration: banDuration,
    });

    if (error) throw new Error(error.message);

    // Write audit log
    await admin.from("audit_logs").insert({
      school_id: schoolId,
      user_id: callerId,
      action: data.active ? "activate_staff" : "deactivate_staff",
      details: {
        target_user_id: data.user_id,
      },
    });

    return { ok: true };
  });
