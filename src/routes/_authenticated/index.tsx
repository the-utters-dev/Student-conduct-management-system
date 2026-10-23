import React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { DashboardShell } from "@/components/DashboardShell";
import { useAuth } from "@/hooks/useAuth";
import { useSchoolSettings } from "@/hooks/useSchoolSettings";
import { STANDING_CLASS, STANDING_LABEL, useConductStandings } from "@/hooks/useConductStandings";
import { supabase } from "@/integrations/supabase/client";
import { ParentMessageComposer } from "@/components/ParentMessageComposer";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "SCDMS Dashboard" },
      {
        name: "description",
        content:
          "School Conduct & Discipline Management System dashboard: open cases, recent conduct actions, and incident trends at a glance.",
      },
      { property: "og:title", content: "SCDMS Dashboard" },
      {
        property: "og:description",
        content: "Track open conduct cases, recent actions, and incident trends.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { profile, school: tenantSchool, schoolId, isSchoolDirector, role } = useAuth();
  const { data: school } = useSchoolSettings();
  const schoolName = tenantSchool?.name || school?.school_name || "Your School";
  const { rows, atRisk, criticalCount, warningCount, isPending } = useConductStandings();
  const totalStudents = rows.length;
  const avgScore = totalStudents
    ? rows.reduce((s, r) => s + (r.current_marks ?? 0), 0) / totalStudents
    : 0;
  const goodCount = totalStudents - atRisk.length;

  // Good deeds this term
  const totalGoodDeeds = rows.reduce((sum, r) => sum + ((r as any).good_deeds_count ?? 0), 0);

  // Active term check
  const { data: activeTerm } = useQuery({
    queryKey: ["active-term", schoolId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("academic_terms" as never) as any)
        .select("id, name, start_date, end_date, is_active")
        .eq("school_id", schoolId)
        .eq("is_active", true)
        .maybeSingle();
      if (error) throw error;
      return data as { id: string; name: string; start_date: string; end_date: string; is_active: boolean } | null;
    },
    enabled: !!schoolId,
  });

  const KPI_CARDS = [
    {
      label: "Students at risk",
      value: isPending ? "…" : String(atRisk.length),
      note: `${criticalCount} critical · ${warningCount} warning`,
      icon: "R",
      iconClass: "bg-danger/15 text-danger",
    },
    {
      label: "Average conduct score",
      value: isPending ? "…" : `${avgScore.toFixed(1)}/${school?.max_conduct_marks ?? 40}`,
      note: `Across ${totalStudents} active students`,
      icon: "A",
      iconClass: "bg-brand/10 text-brand",
    },
    {
      label: "In good standing",
      value: isPending ? "…" : String(goodCount),
      note: "Above the warning threshold",
      icon: "G",
      iconClass: "bg-ok/15 text-ok",
    },
    {
      label: "Good deeds this term",
      value: isPending ? "…" : String(totalGoodDeeds),
      note: `Recognition & positive conduct`,
      icon: "★",
      iconClass: "bg-ok/15 text-ok",
    },
  ];
  // Recent good deeds
  const { data: recentGoodDeeds } = useQuery({
    queryKey: ["recent-good-deeds", schoolId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("conduct_logs" as never) as any)
        .select(`
          id,
          student_id,
          occurred_on,
          details,
          students!inner(full_name, class_name),
          good_deed_categories(name)
        `)
        .eq("school_id", schoolId)
        .eq("entry_type", "good_deed")
        .order("occurred_on", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data as Array<{
        id: string;
        student_id: string;
        occurred_on: string;
        details: string | null;
        students: { full_name: string; class_name: string };
        good_deed_categories: { name: string } | null;
      }>;
    },
    enabled: !!schoolId,
  });

  // Student of the Week (top 3 students by good deeds in last 7 days, no deductions)
  const { data: studentOfWeek } = useQuery({
    queryKey: ["student-of-week", schoolId],
    queryFn: async () => {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const isoDate = sevenDaysAgo.toISOString().split("T")[0];

      // Get students with good deeds in last 7 days
      const { data: goodDeeds, error: gdError } = await (supabase.from("conduct_logs" as never) as any)
        .select("student_id")
        .eq("school_id", schoolId)
        .eq("entry_type", "good_deed")
        .gte("occurred_on", isoDate);
      if (gdError) throw gdError;

      // Get students with deductions in last 7 days
      const { data: deductions, error: dedError } = await (supabase.from("conduct_logs" as never) as any)
        .select("student_id")
        .eq("school_id", schoolId)
        .eq("entry_type", "deduction")
        .gte("occurred_on", isoDate);
      if (dedError) throw dedError;

      const deductionStudentIds = new Set((deductions ?? []).map((d: any) => d.student_id));

      // Count good deeds per student (excluding those with deductions)
      const goodDeedCounts = new Map<string, number>();
      for (const gd of goodDeeds ?? []) {
        if (!deductionStudentIds.has(gd.student_id)) {
          goodDeedCounts.set(gd.student_id, (goodDeedCounts.get(gd.student_id) ?? 0) + 1);
        }
      }

      // Get top 3
      const topStudentIds = Array.from(goodDeedCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([id]) => id);

      if (topStudentIds.length === 0) return [];

      // Fetch student details
      const { data: students, error: stuError } = await (supabase.from("students" as never) as any)
        .select("id, full_name, class_name, admission_no, parent_phone")
        .in("id", topStudentIds);
      if (stuError) throw stuError;

      return students.map((s: any) => ({
        ...s,
        good_deeds_count: goodDeedCounts.get(s.id) ?? 0,
      }));
    },
    enabled: !!schoolId && (isSchoolDirector),
  });

  const now = new Date();
  const h = now.getHours();
  const part = h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
  const name = profile?.full_name?.trim() || "there";
  const date = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  const today = new Date().toISOString().split("T")[0] as string;
  const showTermBanner = activeTerm && (today < activeTerm.start_date || today > activeTerm.end_date);

  return (
    <DashboardShell
      greeting={`Good ${part}, ${name}`}
      dateLine={`${date} · ${schoolName}`}
    >
      {showTermBanner && (
        <div className="mb-4 rounded-3xl border border-warn bg-warn/10 p-4">
          <p className="text-sm font-semibold text-warn">
            {activeTerm.name} ended on {new Date(activeTerm.end_date).toLocaleDateString("en-GB")}.
            {" "}
            <Link to="/settings" className="underline">
              Activate the next term in Settings
            </Link>
            .
          </p>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
        {KPI_CARDS.map((card) => (
          <div
            key={card.label}
            className="min-w-0 rounded-3xl border border-glass-line bg-glass p-3 shadow-panel backdrop-blur-2xl sm:p-5"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">
                {card.label}
              </span>
              <span
                className={`grid h-8 w-8 place-items-center rounded-xl font-bold ${card.iconClass}`}
              >
                {card.icon}
              </span>
            </div>
            <div className="mt-3 break-words font-display text-3xl font-bold leading-tight text-ink sm:text-4xl">{card.value}</div>
            <div className="mt-1 break-words text-[12px] text-soft">{card.note}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="min-w-0 rounded-3xl border border-glass-line bg-glass p-3 shadow-panel backdrop-blur-2xl sm:p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div className="font-display text-[15px] font-bold text-ink">
              Students at risk
            </div>
            <Link
              to="/reports"
              className="text-[12px] font-semibold text-brand hover:underline"
            >
              View report
            </Link>
          </div>
          <div className="mt-4 space-y-3">
            {atRisk.slice(0, 6).map((row) => (
              <div
                key={row.student_id}
                className="flex flex-col gap-2 rounded-2xl bg-glass-bright p-3 ring-1 ring-hairline sm:flex-row sm:items-center sm:justify-between sm:gap-2 sm:px-4 sm:py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-glass-bright text-[12px] font-bold text-ink ring-1 ring-hairline">
                    {(row.full_name ?? "?")
                      .split(" ")
                      .map((p) => p[0])
                      .slice(0, 2)
                      .join("")}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-ink">
                      {row.full_name}
                    </div>
                    <div className="break-words text-[12px] text-soft">
                      {row.class_name ?? "—"} · {row.admission_no} · {row.entries_count ?? 0} entries this term
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 sm:justify-end">
                  <span className="shrink-0 whitespace-nowrap font-display text-sm font-bold text-ink">
                    {row.current_marks}/{row.starting_marks ?? (school?.max_conduct_marks ?? 40)}
                  </span>
                  <span
                    className={`shrink-0 rounded-lg px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] ${STANDING_CLASS[row.standing]}`}
                  >
                    {STANDING_LABEL[row.standing]}
                  </span>
                </div>
              </div>
            ))}
            {!isPending && !atRisk.length && (
              <div className="rounded-2xl bg-glass-bright px-4 py-6 text-center text-[13px] text-soft ring-1 ring-hairline">
                No students are below the warning threshold — great standing this term.
              </div>
            )}
          </div>
        </div>

        <div className="min-w-0 rounded-3xl border border-glass-line bg-glass p-3 shadow-panel backdrop-blur-2xl sm:p-5 lg:col-span-1">
          <div className="font-display text-[15px] font-bold text-ink">
            Standing overview
          </div>
          <div className="mt-4 space-y-3">
            {(
              [
                { label: "Good standing", count: goodCount, barClass: "bg-ok" },
                { label: "Warning", count: warningCount, barClass: "bg-warn" },
                { label: "Critical", count: criticalCount, barClass: "bg-danger" },
              ] as const
            ).map((cat) => (
              <div key={cat.label}>
                <div className="flex justify-between text-[12px] text-body">
                  <span>{cat.label}</span>
                  <span className="font-semibold">{cat.count}</span>
                </div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-track">
                  <div
                    className={`h-full rounded-full ${cat.barClass}`}
                    style={{
                      width: `${totalStudents ? Math.round((cat.count / totalStudents) * 100) : 0}%`,
                    }}
                  ></div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 rounded-2xl bg-linear-to-br from-brand to-accent p-4 text-white shadow-brand-glow">
            <div className="text-[12px] font-semibold uppercase tracking-[0.1em] opacity-80">
              This term
            </div>
            <div className="mt-1 font-display text-2xl font-bold">
              {isPending ? "…" : `${atRisk.length} open case${atRisk.length === 1 ? "" : "s"}`}
            </div>
            <div className="mt-1 text-[11px] opacity-80">
              Students at or below the warning threshold
            </div>
          </div>
        </div>
      </div>

      {/* Recent Good Deeds & Student of the Week */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Recent Good Deeds */}
        <div className="min-w-0 rounded-3xl border border-glass-line bg-glass p-3 shadow-panel backdrop-blur-2xl sm:p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div className="font-display text-[15px] font-bold text-ink">
              Recent good deeds
            </div>
            <Link
              to="/conduct-actions"
              className="text-[12px] font-semibold text-brand hover:underline"
            >
              Record new
            </Link>
          </div>
          <div className="mt-4 space-y-3">
            {!recentGoodDeeds || recentGoodDeeds.length === 0 ? (
              <div className="rounded-2xl bg-glass-bright px-4 py-6 text-center text-[13px] text-soft ring-1 ring-hairline">
                No good deeds recorded yet this term. Recognise positive conduct in Conduct Actions.
              </div>
            ) : (
              recentGoodDeeds.map((deed) => (
                <div
                  key={deed.id}
                  className="flex flex-col gap-2 rounded-2xl bg-glass-bright p-3 ring-1 ring-hairline sm:flex-row sm:items-center sm:justify-between sm:gap-2 sm:px-4 sm:py-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ok/15 text-[18px] text-ok">
                      ★
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold text-ink">
                        {deed.students.full_name}
                      </div>
                      <div className="break-words text-[12px] text-soft">
                        {deed.good_deed_categories?.name ?? deed.details ?? "Good deed"} · {deed.students.class_name}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 whitespace-nowrap text-[11px] text-faint">
                      {new Date(deed.occurred_on).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                    </span>
                    <a
                      href={`/certificate/${deed.id}`}
                      className="rounded-lg bg-brand px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-on-brand hover:bg-brand/90"
                    >
                      Certificate
                    </a>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Student of the Week */}
        {(isSchoolDirector || role === "master_of_discipline") && (
          <div className="min-w-0 rounded-3xl border border-glass-line bg-glass p-3 shadow-panel backdrop-blur-2xl sm:p-5 lg:col-span-1">
            <div className="font-display text-[15px] font-bold text-ink">
              Student of the Week
            </div>
            <p className="mt-1 text-[11px] text-soft">Top students by good deeds (last 7 days, no deductions)</p>
            <div className="mt-4 space-y-2">
              {!studentOfWeek || studentOfWeek.length === 0 ? (
                <div className="rounded-2xl bg-glass-bright px-3 py-4 text-center text-[12px] text-soft ring-1 ring-hairline">
                  No eligible students this week
                </div>
              ) : (
                studentOfWeek.map((student: any, idx: number) => (
                  <div
                    key={student.id}
                    className="flex items-center gap-3 rounded-xl bg-glass-bright p-3 ring-1 ring-hairline"
                  >
                    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-ok/15 text-[12px] font-bold text-ok">
                      {idx + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-semibold text-ink">
                        {student.full_name}
                      </div>
                      <div className="text-[11px] text-soft">
                        {student.class_name} · {student.good_deeds_count} good deed{student.good_deeds_count !== 1 ? "s" : ""}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
            {studentOfWeek && studentOfWeek.length > 0 && (
              <StudentOfWeekCongratulations students={studentOfWeek} />
            )}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}

function StudentOfWeekCongratulations({ students }: { students: Array<{ id: string; full_name: string; class_name: string; parent_phone: string | null; good_deeds_count: number }> }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="mt-4 w-full rounded-xl bg-ok px-4 py-2 text-sm font-semibold text-white shadow-brand-glow"
      >
        Send congratulations
      </button>
      <ParentMessageComposer
        open={open}
        onOpenChange={setOpen}
        prefilledStudentIds={students.map((s) => s.id)}
        templateType="student_of_week"
      />
    </>
  );
}
