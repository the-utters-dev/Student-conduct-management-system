import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface SchoolSettings {
  school_name: string;
  logo_url: string | null;
  academic_year: string;
  critical_threshold: number;
  warning_threshold: number;
  notify_on_threshold: boolean;
}

export const DEFAULT_SETTINGS: SchoolSettings = {
  school_name: "Your School",
  logo_url: null,
  academic_year: "2026/2027",
  critical_threshold: 20,
  warning_threshold: 30,
  notify_on_threshold: true,
};

export function useSchoolSettings() {
  return useQuery({
    queryKey: ["school-settings"],
    queryFn: async (): Promise<SchoolSettings> => {
      const { data } = await supabase.from("school_settings").select("*").eq("id", 1).maybeSingle();
      return { ...DEFAULT_SETTINGS, ...(data ?? {}) };
    },
  });
}
