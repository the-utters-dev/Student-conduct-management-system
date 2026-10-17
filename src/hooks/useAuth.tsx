import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, SupabaseClient, User } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AppRole =
  | "school_director"
  | "master_of_discipline"
  | "matron"
  | "patron"
  | "system_admin"
  // Legacy roles (kept for backwards compatibility during migration)
  | "school_leader"
  | "discipline_admin";

export type GenderScope = "Female" | "Male" | null;

export type PermissionKey =
  | "delete_students"
  | "manage_offences"
  | "view_audit_logs"
  | "view_reports"
  | "message_parents"
  | "send_photos";

export interface StaffProfile {
  id: string;
  full_name: string;
  email: string | null;
  job_title: string | null;
  avatar_url: string | null;
  school_id?: string | null;
}

export interface TenantSchool {
  id: string;
  name: string;
  plan: string;
  status: string;
}

export interface SchoolSettings {
  role_titles?: Record<string, string>;
  permissions?: Record<string, Record<PermissionKey, boolean>>;
}

interface AuthState {
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: StaffProfile | null;
  role: AppRole | null;
  scope: GenderScope;
  isDisciplineStaff: boolean;
  isPlatformAdmin: boolean;
  isSchoolDirector: boolean;
  /** False until the multi-tenant SQL script has been run. */
  tenancyEnabled: boolean;
  schoolId: string | null;
  school: TenantSchool | null;
  settings: SchoolSettings | null;
  can: (permission: PermissionKey) => boolean;
  roleLabel: (role: AppRole) => string;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const DEFAULT_ROLE_LABELS: Record<AppRole, string> = {
  school_director: "School Director",
  master_of_discipline: "Master of Discipline",
  matron: "Matron",
  patron: "Patron",
  system_admin: "Platform Owner",
  // Legacy
  school_leader: "School Director",
  discipline_admin: "Discipline Administrator",
};

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<StaffProfile | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [tenancyEnabled, setTenancyEnabled] = useState(false);
  const [school, setSchool] = useState<TenantSchool | null>(null);
  const [settings, setSettings] = useState<SchoolSettings | null>(null);
  const [allRoles, setAllRoles] = useState<AppRole[]>([]);

  async function loadIdentity(userId: string | undefined) {
    if (!userId) {
      setProfile(null);
      setRole(null);
      setSchool(null);
      setSettings(null);
      setAllRoles([]);
      return;
    }
    const db = supabase as unknown as SupabaseClient;
    const base = "id, full_name, email, job_title, avatar_url";
    const [tenantRes, { data: roleRows }] = await Promise.all([
      db.from("profiles").select(`${base}, school_id`).eq("id", userId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
    ]);
    let profileRow = tenantRes.data as StaffProfile | null;
    const hasTenancy = !tenantRes.error;
    if (!hasTenancy) {
      const { data } = await supabase.from("profiles").select(base).eq("id", userId).maybeSingle();
      profileRow = (data as StaffProfile | null) ?? null;
    }
    setTenancyEnabled(hasTenancy);
    setProfile(profileRow);

    // Load school and settings
    if (hasTenancy && profileRow?.school_id) {
      const [schoolRes, settingsRes] = await Promise.all([
        db.from("schools").select("id, name, plan, status").eq("id", profileRow.school_id).maybeSingle(),
        db.from("school_settings").select("role_titles, permissions").eq("school_id", profileRow.school_id).maybeSingle(),
      ]);
      setSchool((schoolRes.data as TenantSchool | null) ?? null);
      setSettings((settingsRes.data as SchoolSettings | null) ?? null);
    } else {
      setSchool(null);
      setSettings(null);
    }

    const roles = (roleRows ?? []).map((r) => r.role as AppRole);
    setAllRoles(roles);

    // Prefer new roles, fall back to legacy
    const preferred: AppRole[] = [
      "system_admin",
      "school_director",
      "master_of_discipline",
      "matron",
      "patron",
      "school_leader",
      "discipline_admin",
    ];
    setRole(preferred.find((r) => roles.includes(r)) ?? null);
  }

  useEffect(() => {
    let cancelled = false;

    const { data: sub } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (
        event !== "SIGNED_IN" &&
        event !== "SIGNED_OUT" &&
        event !== "USER_UPDATED" &&
        event !== "INITIAL_SESSION"
      ) {
        return;
      }
      setSession(nextSession ?? null);
      void loadIdentity(nextSession?.user.id);
    });

    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      setSession(data.session ?? null);
      await loadIdentity(data.session?.user.id);
      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Calculate gender scope based on roles
  const scope = useMemo<GenderScope>(() => {
    if (!role) return null;
    // Matron only (no other discipline roles)
    if (
      allRoles.includes("matron") &&
      !allRoles.some((r) =>
        ["master_of_discipline", "patron", "school_director", "system_admin", "school_leader"].includes(r)
      )
    ) {
      return "Female";
    }
    // Patron only (no other discipline roles)
    if (
      allRoles.includes("patron") &&
      !allRoles.some((r) =>
        ["master_of_discipline", "matron", "school_director", "system_admin", "school_leader"].includes(r)
      )
    ) {
      return "Male";
    }
    return null;
  }, [role, allRoles]);

  const value = useMemo<AuthState>(
    () => ({
      loading,
      session,
      user: session?.user ?? null,
      profile,
      role,
      scope,
      isDisciplineStaff:
        role === "master_of_discipline" ||
        role === "matron" ||
        role === "patron" ||
        role === "school_director" ||
        role === "system_admin" ||
        role === "discipline_admin" ||
        role === "school_leader",
      isPlatformAdmin: role === "system_admin",
      isSchoolDirector: role === "school_director" || role === "school_leader",
      tenancyEnabled,
      schoolId: profile?.school_id ?? null,
      school,
      settings,
      can: (permission: PermissionKey) => {
        // Platform admin and school director always have all permissions
        if (role === "system_admin" || role === "school_director" || role === "school_leader") {
          return true;
        }
        // Check permissions from settings
        if (!settings?.permissions || !role) return false;
        const rolePerms = settings.permissions[role];
        if (!rolePerms) return false;
        return rolePerms[permission] ?? false;
      },
      roleLabel: (r: AppRole) => {
        // Use custom label from school settings if available
        if (settings?.role_titles?.[r]) {
          return settings.role_titles[r];
        }
        // Fall back to default
        return DEFAULT_ROLE_LABELS[r] || r;
      },
      signOut: async () => {
        await supabase.auth.signOut();
        setProfile(null);
        setRole(null);
        setSession(null);
        setSchool(null);
        setSettings(null);
        setAllRoles([]);
        // Clear all cached queries to prevent cross-school data leakage
        queryClient.clear();
      },
      refresh: async () => {
        const { data } = await supabase.auth.getSession();
        setSession(data.session ?? null);
        await loadIdentity(data.session?.user.id);
      },
    }),
    [loading, session, profile, role, scope, tenancyEnabled, school, settings, allRoles],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
