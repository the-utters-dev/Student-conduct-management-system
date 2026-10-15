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

export type AppRole = "discipline_admin" | "school_leader" | "system_admin";

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

interface AuthState {
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: StaffProfile | null;
  role: AppRole | null;
  isDisciplineStaff: boolean;
  isPlatformAdmin: boolean;
  /** False until the multi-tenant SQL script has been run. */
  tenancyEnabled: boolean;
  schoolId: string | null;
  school: TenantSchool | null;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

export const ROLE_LABELS: Record<AppRole, { label: string; badge: string }> = {
  discipline_admin: { label: "Matron / Patron", badge: "Discipline" },
  school_leader: { label: "School Leader", badge: "Leader" },
  system_admin: { label: "System Administrator", badge: "Admin" },
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

  async function loadIdentity(userId: string | undefined) {
    if (!userId) {
      setProfile(null);
      setRole(null);
      setSchool(null);
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
    if (hasTenancy && profileRow?.school_id) {
      const { data: s } = await db
        .from("schools")
        .select("id, name, plan, status")
        .eq("id", profileRow.school_id)
        .maybeSingle();
      setSchool((s as TenantSchool | null) ?? null);
    } else {
      setSchool(null);
    }
    const roles = (roleRows ?? []).map((r) => r.role as AppRole);
    const preferred: AppRole[] = ["system_admin", "discipline_admin", "school_leader"];
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

  const value = useMemo<AuthState>(
    () => ({
      loading,
      session,
      user: session?.user ?? null,
      profile,
      role,
      isDisciplineStaff: role === "discipline_admin" || role === "system_admin",
      isPlatformAdmin: role === "system_admin",
      tenancyEnabled,
      schoolId: profile?.school_id ?? null,
      school,
      signOut: async () => {
        await supabase.auth.signOut();
        setProfile(null);
        setRole(null);
        setSession(null);
        setSchool(null);
        // Clear all cached queries to prevent cross-school data leakage
        queryClient.clear();
      },
      refresh: async () => {
        const { data } = await supabase.auth.getSession();
        setSession(data.session ?? null);
        await loadIdentity(data.session?.user.id);
      },
    }),
    [loading, session, profile, role, tenancyEnabled, school],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
