import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/students")({
  head: () => ({
    meta: [
      { title: "Students — SCDMS" },
      {
        name: "description",
        content:
          "Student registry with admission numbers, classes, houses and parent contact numbers.",
      },
      { property: "og:title", content: "Students — SCDMS" },
      {
        property: "og:description",
        content: "Browse student records and parent contact details.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: StudentsPage,
});

interface StudentRow {
  id: string;
  admission_no: string;
  full_name: string;
  class_name: string;
  house: string | null;
  gender: string | null;
  parent_name: string | null;
  parent_phone: string | null;
  is_active: boolean;
}

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function StudentsPage() {
  const [search, setSearch] = useState("");

  const { data, isPending, error } = useQuery({
    queryKey: ["students"],
    queryFn: async (): Promise<StudentRow[]> => {
      const { data: rows, error: queryError } = await supabase
        .from("students")
        .select(
          "id, admission_no, full_name, class_name, house, gender, parent_name, parent_phone, is_active",
        )
        .order("full_name", { ascending: true });
      if (queryError) throw queryError;
      return (rows ?? []) as StudentRow[];
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data ?? [];
    return (data ?? []).filter((s) =>
      [s.full_name, s.admission_no, s.class_name, s.house ?? ""].some((v) =>
        v.toLowerCase().includes(q),
      ),
    );
  }, [data, search]);

  return (
    <DashboardShell
      greeting="Students"
      dateLine="Student registry · Northfield Academy"
    >
      <div className="rounded-3xl border border-glass-line bg-glass p-6 shadow-panel backdrop-blur-2xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-bold text-ink">Student registry</h2>
            <p className="mt-1 text-[12px] text-soft">
              {isPending
                ? "Loading records…"
                : `${filtered.length} of ${data?.length ?? 0} students`}
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-2xl bg-glass-bright px-3 py-2 ring-1 ring-hairline">
            <span className="text-sm text-faint">⌕</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-56 bg-transparent text-sm text-body outline-none placeholder:text-faint"
              placeholder="Name, admission no, class"
            />
          </div>
        </div>

        {error && (
          <div className="mt-5 rounded-2xl bg-danger/10 px-4 py-3 text-[12px] font-medium text-danger">
            Couldn't load students: {(error as Error).message}
          </div>
        )}

        <div className="mt-5 overflow-hidden rounded-2xl ring-1 ring-hairline">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="bg-glass-bright">
                {["Student", "Admission no", "Class", "House", "Parent contact", "Status"].map(
                  (h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.12em] text-faint"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {isPending &&
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-t border-hairline">
                    <td colSpan={6} className="px-4 py-4">
                      <div className="h-4 w-full animate-pulse rounded-full bg-track" />
                    </td>
                  </tr>
                ))}

              {!isPending && filtered.length === 0 && (
                <tr className="border-t border-hairline">
                  <td colSpan={6} className="px-4 py-8 text-center text-[13px] text-soft">
                    No students match this search.
                  </td>
                </tr>
              )}

              {filtered.map((s) => (
                <tr
                  key={s.id}
                  className="border-t border-hairline transition hover:bg-glass-bright"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-glass-bright text-[12px] font-bold text-ink ring-1 ring-hairline">
                        {initials(s.full_name)}
                      </div>
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-ink">{s.full_name}</div>
                        <div className="text-[11px] text-soft">{s.parent_name ?? "—"}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[12px] text-body">{s.admission_no}</td>
                  <td className="px-4 py-3 text-[12px] text-body">{s.class_name}</td>
                  <td className="px-4 py-3 text-[12px] text-body">{s.house ?? "—"}</td>
                  <td className="px-4 py-3 text-[12px] text-body">{s.parent_phone ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        s.is_active
                          ? "rounded-lg bg-ok/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-ok"
                          : "rounded-lg bg-danger/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-danger"
                      }
                    >
                      {s.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardShell>
  );
}
