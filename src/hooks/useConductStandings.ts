import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSchoolSettings } from "@/hooks/useSchoolSettings";
import { useAuth } from "@/hooks/useAuth";
import { scopeToSchool } from "@/lib/tenant";

export type Standing = "critical" | "warning" | "good";

export function standingOf(marks: number, critical: number, warning: number): Standing {
  if (marks <= critical) return "critical";
  if (marks <= warning) return "warning";
  return "good";
}

export const STANDING_LABEL: Record<Standing, string> = { critical: "Critical", warning: "Warning", good: "Good standing" };
export const STANDING_CLASS: Record<Standing, string> = {
  critical: "bg-danger/15 text-danger",
  warning: "bg-warn/15 text-warn",
  good: "bg-ok/15 text-ok",
};

/** Live conduct score per student for the active term, classified by the school's thresholds. */
export function useConductStandings() {
  const { data: school } = useSchoolSettings();
  const critical = school?.critical_threshold ?? 20;
  const warning = school?.warning_threshold ?? 30;
  const { schoolId, isPlatformAdmin } = useAuth();
  const q = useQuery({
    queryKey: ["student-balances", schoolId],
    // The platform owner can read every school, so wait until a school is chosen.
    enabled: !isPlatformAdmin || Boolean(schoolId),
    queryFn: async () => {
      const { data, error } = await scopeToSchool(supabase.from("student_conduct_balances").select("*"), schoolId);
      if (error) throw error;
      return data ?? [];
    },
  });
  const rows = (q.data ?? []).map((b) => ({ ...b, standing: standingOf(b.current_marks ?? 0, critical, warning) }));
  const atRisk = rows.filter((r) => r.standing !== "good").sort((a, b) => (a.current_marks ?? 0) - (b.current_marks ?? 0));
  return {
    ...q,
    rows,
    atRisk,
    criticalCount: rows.filter((r) => r.standing === "critical").length,
    warningCount: rows.filter((r) => r.standing === "warning").length,
    critical,
    warning,
  };
}
