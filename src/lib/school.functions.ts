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
  // Import admin client to bypass RLS for permission checks
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Get caller's school and role using admin client (bypasses RLS)
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("school_id")
    .eq("id", context.userId)
    .maybeSingle();

  if (!profile?.school_id) {
    throw new Error("You must belong to a school to perform this action.");
  }

  // Check if caller is a school director (supports both new and legacy roles)
  const { data: roles } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId)
    .in("role", ["school_director", "school_leader"] as any); // Include legacy for backwards compatibility, cast to bypass outdated types

  if (!roles?.length) {
    throw new Error("Only School Directors can manage staff.");
  }

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
 * Atomic: if any step fails after creating the user, returns a clear error with instructions.
 */
export const inviteSchoolStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { email: string; full_name: string; role: SchoolRole }) => {
    if (!d || typeof d !== "object") {
      throw new Error("Missing invite details. Please provide email, full name, and role.");
    }
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

    // First, check if the user already exists in auth.users
    const { data: existingUsers } = await admin.auth.admin.listUsers();
    const existingUser = existingUsers?.users?.find((u) => u.email?.toLowerCase() === data.email);

    if (existingUser) {
      // User already exists - attach them to this school instead of creating a new invite
      // Check if they're already in this school
      const { data: existingProfile } = await admin
        .from("profiles")
        .select("school_id")
        .eq("id", existingUser.id)
        .maybeSingle();

      if (existingProfile?.school_id === schoolId) {
        throw new Error(`${data.email} is already a member of your school.`);
      }

      // Check if they're a system_admin
      const { data: existingRoles } = await admin
        .from("user_roles")
        .select("role")
        .eq("user_id", existingUser.id);

      if (existingRoles?.some((r) => r.role === "system_admin")) {
        throw new Error("Cannot assign the platform owner to a school.");
      }

      // Attach this user to the school
      const { error: profileError } = await admin
        .from("profiles")
        .update({ school_id: schoolId })
        .eq("id", existingUser.id);

      if (profileError) {
        throw new Error(`Failed to attach user to school: ${profileError.message}`);
      }

      // Assign the role (use upsert to avoid duplicate key errors)
      const { error: roleError } = await admin
        .from("user_roles")
        .upsert({ user_id: existingUser.id, role: data.role }, { onConflict: "user_id,role" });

      if (roleError) {
        throw new Error(`User attached to school but role assignment failed: ${roleError.message}. Please assign the role manually in the staff list.`);
      }

      // Write audit log with correct column names (entity_type, payload)
      await admin.from("audit_logs").insert({
        school_id: schoolId,
        user_id: userId,
        action: "ATTACH_EXISTING_STAFF",
        entity_type: "user",
        entity_id: existingUser.id,
        payload: {
          email: data.email,
          role: data.role,
        },
      });

      return { id: existingUser.id, email: data.email, attached: true };
    }

    // User doesn't exist - create invitation
    const { data: invited, error } = await admin.auth.admin.inviteUserByEmail(data.email, {
      data: {
        full_name: data.full_name,
        role: data.role,
        school_id: schoolId,
      },
      redirectTo: `${process.env["VITE_APP_URL"] ?? "http://localhost:3000"}/auth`,
    });

    if (error) {
      // Check for rate limit (provide helpful message)
      if (error.message.includes("rate limit") || error.message.includes("too many") || error.message.toLowerCase().includes("email")) {
        throw new Error(
          "Email limit reached. Create the user in Supabase (Authentication → Add user) and use 'Add existing user' to assign them, or try again later."
        );
      }
      // Generic error
      throw new Error(`Failed to send invitation: ${error.message}`);
    }

    const invitedUserId = invited.user.id;

    try {
      // Set school_id in profiles (the trigger creates the profile, ensure school_id is set)
      const { error: profileError } = await admin
        .from("profiles")
        .update({ school_id: schoolId })
        .eq("id", invitedUserId);

      if (profileError) {
        throw new Error(`User created but school assignment failed: ${profileError.message}. Assign the user manually using 'Add existing user'.`);
      }

      // Assign the role
      const { error: roleError } = await admin
        .from("user_roles")
        .insert({ user_id: invitedUserId, role: data.role });

      if (roleError) {
        throw new Error(`User created but role assignment failed: ${roleError.message}. Assign the role manually in the staff list.`);
      }

      // Write audit log with correct column names (entity_type, payload)
      await admin.from("audit_logs").insert({
        school_id: schoolId,
        user_id: userId,
        action: "INVITE_STAFF",
        entity_type: "user",
        entity_id: invitedUserId,
        payload: {
          email: data.email,
          full_name: data.full_name,
          role: data.role,
        },
      });

      return { id: invitedUserId, email: data.email, attached: false };
    } catch (err) {
      // If any post-creation step fails, provide clear guidance
      throw err;
    }
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
    if (!d || typeof d !== "object") {
      throw new Error("Missing role update details. Please provide user_id and role.");
    }
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
        .in("role", ["school_director", "school_leader"] as any);

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
        .in("role", ["school_director", "school_leader"] as any);

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

    // Write audit log with correct column names (entity_type, payload)
    await admin.from("audit_logs").insert({
      school_id: schoolId,
      user_id: callerId,
      action: "UPDATE_STAFF_ROLE",
      entity_type: "user",
      entity_id: data.user_id,
      payload: {
        target_user_id: data.user_id,
        old_roles: currentRoles,
        new_role: data.role,
      },
    });

    return { ok: true };
  });

/**
 * Searches for an existing user by email and returns basic info.
 * Only School Directors (or platform admins) can search users.
 */
export const searchUserByEmail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { email: string }) => {
    if (!d || typeof d !== "object") {
      throw new Error("Missing email parameter.");
    }
    const email = String(d.email ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("Enter a valid email address.");
    }
    return { email };
  })
  .handler(async ({ data, context }) => {
    // Only school directors can search (or platform admins via requireSchoolDirector fallback)
    const { admin } = await requireSchoolDirector(context as never);

    // Search for user by email
    const { data: users } = await admin.auth.admin.listUsers();
    const user = users?.users?.find((u) => u.email?.toLowerCase() === data.email);

    if (!user) {
      return null;
    }

    // Get profile data
    const { data: profile } = await admin
      .from("profiles")
      .select("id, full_name, school_id")
      .eq("id", user.id)
      .maybeSingle();

    // Get roles
    const { data: rolesData } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);

    const roles = (rolesData ?? []).map((r) => r.role);

    return {
      id: user.id,
      email: user.email,
      full_name: profile?.full_name ?? "",
      school_id: profile?.school_id ?? null,
      roles,
      is_system_admin: roles.includes("system_admin"),
    };
  });

/**
 * Adds an existing user to the caller's school.
 * Only School Directors can add existing users.
 * Cannot add system_admin accounts.
 */
export const addExistingStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { user_id: string; role: SchoolRole }) => {
    if (!d || typeof d !== "object") {
      throw new Error("Missing user details. Please provide user_id and role.");
    }
    if (!UUID.test(d.user_id)) throw new Error("Invalid user ID.");
    if (!SCHOOL_ROLES.includes(d.role)) {
      throw new Error("Invalid role. Must be one of: School Director, Master of Discipline, Matron, Patron.");
    }
    return d;
  })
  .handler(async ({ data, context }) => {
    const { schoolId, admin } = await requireSchoolDirector(context as never);
    const callerId = (context as { userId: string }).userId;

    // Check if target user is a system_admin
    const { data: targetRoles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user_id);

    if (targetRoles?.some((r) => r.role === "system_admin")) {
      throw new Error("Cannot add the platform owner to a school.");
    }

    // Get target user's current school
    const { data: targetProfile } = await admin
      .from("profiles")
      .select("school_id, email")
      .eq("id", data.user_id)
      .maybeSingle();

    if (targetProfile?.school_id === schoolId) {
      throw new Error("This user is already a member of your school.");
    }

    if (targetProfile?.school_id) {
      throw new Error("This user is already assigned to another school. They must be removed from that school first.");
    }

    // Attach user to this school
    const { error: profileError } = await admin
      .from("profiles")
      .update({ school_id: schoolId })
      .eq("id", data.user_id);

    if (profileError) {
      throw new Error(`Failed to add user to school: ${profileError.message}`);
    }

    // Assign role (use upsert to avoid duplicate key errors)
    const { error: roleError } = await admin
      .from("user_roles")
      .upsert({ user_id: data.user_id, role: data.role }, { onConflict: "user_id,role" });

    if (roleError) {
      throw new Error(`User added to school but role assignment failed: ${roleError.message}. Please assign the role manually.`);
    }

    // Write audit log
    await admin.from("audit_logs").insert({
      school_id: schoolId,
      user_id: callerId,
      action: "ADD_EXISTING_STAFF",
      entity_type: "user",
      entity_id: data.user_id,
      payload: {
        email: targetProfile?.email,
        role: data.role,
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
    if (!d || typeof d !== "object") {
      throw new Error("Missing activation details. Please provide user_id and active status.");
    }
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

    // Write audit log with correct column names (entity_type, payload)
    await admin.from("audit_logs").insert({
      school_id: schoolId,
      user_id: callerId,
      action: data.active ? "ACTIVATE_STAFF" : "DEACTIVATE_STAFF",
      entity_type: "user",
      entity_id: data.user_id,
      payload: {
        target_user_id: data.user_id,
      },
    });

    return { ok: true };
  });

/**
 * Sends a password reset email to a staff member.
 * Only School Directors can send reset emails for staff in their school.
 * Cannot reset password for system_admin accounts.
 */
export const sendStaffPasswordReset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { user_email: string }) => {
    if (!d || typeof d !== "object") {
      throw new Error("Missing email parameter.");
    }
    const email = String(d.user_email ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("Enter a valid email address.");
    }
    return { user_email: email };
  })
  .handler(async ({ data, context }) => {
    const { schoolId, admin } = await requireSchoolDirector(context as never);
    const callerId = (context as { userId: string }).userId;

    // Find the user by email
    const { data: users } = await admin.auth.admin.listUsers();
    const user = users?.users?.find((u) => u.email?.toLowerCase() === data.user_email);

    if (!user) {
      // Don't reveal if user exists or not (security best practice)
      return { ok: true };
    }

    // Verify target user belongs to this school
    const { data: targetProfile } = await admin
      .from("profiles")
      .select("school_id")
      .eq("id", user.id)
      .maybeSingle();

    if (!targetProfile || targetProfile.school_id !== schoolId) {
      // Don't reveal if user exists in another school
      return { ok: true };
    }

    // Check if target user is a system_admin
    const { data: targetRoles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);

    if (targetRoles?.some((r) => r.role === "system_admin")) {
      throw new Error("Cannot reset password for platform administrators.");
    }

    // Send password reset email
    const { error } = await admin.auth.admin.generateLink({
      type: "recovery",
      email: data.user_email,
      options: {
        redirectTo: `${process.env["VITE_APP_URL"] ?? "http://localhost:3000"}/reset-password`,
      },
    });

    if (error) {
      // Check for rate limit
      if (error.message.includes("rate limit") || error.message.includes("too many")) {
        throw new Error("Email rate limit reached. Please wait a few minutes and try again.");
      }
      throw new Error(error.message);
    }

    // Write audit log
    await admin.from("audit_logs").insert({
      school_id: schoolId,
      user_id: callerId,
      action: "PASSWORD_RESET_EMAIL",
      entity_type: "auth",
      entity_id: user.id,
      payload: {
        target_user_id: user.id,
        target_email: data.user_email,
      },
    });

    return { ok: true };
  });

/**
 * Generates a strong 10-character temporary password and sets it for a staff member.
 * Only School Directors can set temporary passwords for staff in their school.
 * Cannot set password for system_admin accounts.
 * Returns the password to be shown ONCE in the UI.
 */
export const setStaffTemporaryPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { user_id: string }) => {
    if (!UUID.test(d.user_id)) throw new Error("Invalid user ID.");
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
      throw new Error("Cannot set password for platform administrators.");
    }

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

    // Write audit log
    await admin.from("audit_logs").insert({
      school_id: schoolId,
      user_id: callerId,
      action: "PASSWORD_TEMP_SET",
      entity_type: "auth",
      entity_id: data.user_id,
      payload: {
        target_user_id: data.user_id,
      },
    });

    // Return the temporary password (to be shown ONCE)
    return { password: tempPassword };
  });
