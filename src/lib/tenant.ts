// Helpers that keep school data scoped to one school.
//
// RLS already limits school staff to their own school. The platform owner can read every
// school, so in support view (see useAuth().supportView) these helpers are what keep each
// page to the school being viewed and stamp new rows with that school's id.

/** Adds `school_id = schoolId` to a query. No filter when schoolId is null (pre-tenancy installs). */
export function scopeToSchool<Q>(query: Q, schoolId: string | null | undefined): Q {
  if (!schoolId) return query;
  return (query as unknown as { eq: (column: string, value: string) => Q }).eq("school_id", schoolId);
}

/** `{ school_id }` to spread into an insert, or nothing when there is no school id yet. */
export function schoolColumn(schoolId: string | null | undefined): { school_id?: string } {
  return schoolId ? { school_id: schoolId } : {};
}

/** Marks an audit payload as written by the platform owner while in support view. */
export function auditPayload<T extends Record<string, unknown>>(
  payload: T,
  supportView: boolean,
): T & { via?: "platform_owner" } {
  return supportView ? { ...payload, via: "platform_owner" as const } : payload;
}
