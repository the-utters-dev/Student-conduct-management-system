import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const PLANS = ["trial", "basic", "pro", "enterprise"] as const;
export const SCHOOL_STATUSES = ["active", "suspended", "cancelled"] as const;
export const STAFF_ROLES = ["discipline_admin", "school_leader"] as const;
export type Plan = (typeof PLANS)[number];
export type SchoolStatus = (typeof SCHOOL_STATUSES)[number];
export type StaffRole = (typeof STAFF_ROLES)[number];

export interface PlatformSchool {
  id: string;
  name: string;
  plan: Plan;
  status: SchoolStatus;
  trial_ends_at: string | null;
  student_limit: number | null;
  created_at: string;
  staff_count: number;
  student_count: number;
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
    const [schoolsRes, profilesRes, rolesRes, studentsRes] = await Promise.all([
      admin.from("schools").select("*").order("created_at"),
      admin.from("profiles").select("id, full_name, email, school_id").order("full_name"),
      admin.from("user_roles").select("user_id, role"),
      admin.from("students").select("school_id"),
    ]);
    const err = missingSetup(schoolsRes.error ?? profilesRes.error ?? studentsRes.error);
    if (err) throw err;
    const roles = new Map<string, string[]>();
    (rolesRes.data ?? []).forEach((r) => roles.set(r.user_id, [...(roles.get(r.user_id) ?? []), r.role]));
    const staff: PlatformStaff[] = (profilesRes.data ?? []).map((p) => ({
      ...p,
      roles: roles.get(p.id) ?? [],
    }));
    const count = (rows: { school_id: string | null }[], id: string) =>
      rows.filter((r) => r.school_id === id).length;
    const schools: PlatformSchool[] = (schoolsRes.data ?? []).map((s) => ({
      ...s,
      staff_count: count(staff, s.id),
      student_count: count(studentsRes.data ?? [], s.id),
    }));
    return { schools, staff };
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
  await admin.from("user_roles").delete().eq("user_id", userId).in("role", [...STAFF_ROLES]);
  const { error } = await admin.from("user_roles").insert({ user_id: userId, role });
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
