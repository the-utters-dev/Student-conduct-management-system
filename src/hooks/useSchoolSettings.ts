import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, type PermissionKey } from "./useAuth";

export interface SchoolSettings {
  school_name: string;
  logo_url: string | null;
  academic_year: string;
  critical_threshold: number;
  warning_threshold: number;
  notify_on_threshold: boolean;
  school_type?: string;
  is_boarding?: boolean;
  max_conduct_marks?: number;
  class_levels?: string[];
  role_titles?: Record<string, string>;
  permissions?: Record<string, Record<PermissionKey, boolean>>;
  good_deed_reward?: "recognition" | "restore_marks" | "merit_points";
}

export const DEFAULT_SETTINGS: SchoolSettings = {
  school_name: "Your School",
  logo_url: null,
  academic_year: "2026/2027",
  critical_threshold: 20,
  warning_threshold: 30,
  notify_on_threshold: true,
  school_type: "secondary",
  is_boarding: true,
  max_conduct_marks: 40,
  class_levels: ["S1", "S2", "S3", "S4", "S5", "S6"],
};

export function useSchoolSettings() {
  const { schoolId } = useAuth();

  return useQuery({
    queryKey: ["school-settings", schoolId],
    queryFn: async (): Promise<SchoolSettings> => {
      // Try to load by school_id first (multi-tenant mode)
      if (schoolId) {
        const { data, error } = await (supabase.from("school_settings") as any)
          .select("*")
          .eq("school_id", schoolId)
          .maybeSingle();

        if (!error && data) {
          return { ...DEFAULT_SETTINGS, ...(data ?? {}) };
        }
      }

      // Fallback: try the old id=1 row (for backwards compatibility before migration)
      const { data } = await supabase
        .from("school_settings")
        .select("*")
        .eq("id", 1)
        .maybeSingle();

      return { ...DEFAULT_SETTINGS, ...(data ?? {}) };
    },
  });
}
