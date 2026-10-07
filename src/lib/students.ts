// Shared student helpers. New guardian/progression columns are optional so the
// app keeps working before supabase/student-expansion.sql has been applied.
export interface StudentRow {
  id: string;
  admission_no: string;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  class_name: string;
  class_level: string | null;
  stream: string | null;
  house: string | null;
  gender: string | null;
  date_of_birth: string | null;
  district: string | null;
  sector: string | null;
  cell: string | null;
  parent_name: string | null;
  parent_phone: string | null;
  is_active: boolean;
  father_name?: string | null;
  mother_name?: string | null;
  guardian_email?: string | null;
  notification_channel?: string | null;
  primary_contact?: string | null;
  status?: string | null;
  academic_year?: string | null;
}

export type StudentStatus = "active" | "repeating" | "graduated";

export const STATUS_LABELS: Record<StudentStatus, string> = {
  active: "Active",
  repeating: "Repeating",
  graduated: "Graduated / Alumni",
};

export function statusOf(s: StudentRow): StudentStatus | "inactive" {
  if (s.status === "graduated" || s.status === "repeating" || s.status === "active") {
    if (s.status !== "graduated" && !s.is_active) return "inactive";
    return s.status;
  }
  return s.is_active ? "active" : "inactive";
}

export function levelOf(s: StudentRow) {
  return s.class_level ?? s.class_name.match(/\bS[1-6]\b/i)?.[0]?.toUpperCase() ?? null;
}
export function streamOf(s: StudentRow) {
  return s.stream ?? s.class_name.trim().split(/\s+/).pop()?.match(/^[A-F]$/i)?.[0]?.toUpperCase() ?? null;
}

// Rwanda mobile: MTN 078/079, Airtel 072/073. Returns "+250 7XX XXX XXX" or null.
export function normalizeRwPhone(raw: string): string | null {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("250")) d = d.slice(3);
  if (d.startsWith("0")) d = d.slice(1);
  if (!/^7[2389]\d{7}$/.test(d)) return null;
  return `+250 ${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
}
export function rwCarrier(raw: string): "MTN" | "Airtel" | null {
  const n = normalizeRwPhone(raw);
  if (!n) return null;
  return /^\+250 7[89]/.test(n) ? "MTN" : "Airtel";
}

export function nextAcademicYear(y: string) {
  const m = y.match(/^(\d{4})\s*\/\s*(\d{4})$/);
  return m ? `${Number(m[1]) + 1}/${Number(m[2]) + 1}` : y;
}

// Postgres "undefined column" or PostgREST "column not in schema cache".
export function isMissingColumn(e: { code?: string } | null) {
  return !!e && (e.code === "42703" || e.code === "PGRST204");
}
