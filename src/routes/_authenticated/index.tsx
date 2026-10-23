import { createFileRoute, Link } from "@tanstack/react-router";
import { DashboardShell } from "@/components/DashboardShell";
import { useAuth } from "@/hooks/useAuth";
import { useSchoolSettings } from "@/hooks/useSchoolSettings";
import { STANDING_CLASS, STANDING_LABEL, useConductStandings } from "@/hooks/useConductStandings";

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
  const { profile, school: tenantSchool } = useAuth();
  const { data: school } = useSchoolSettings();
  const schoolName = tenantSchool?.name || school?.school_name || "Your School";
  const { rows, atRisk, criticalCount, warningCount, isPending } = useConductStandings();
  const totalStudents = rows.length;
  const avgScore = totalStudents
    ? rows.reduce((s, r) => s + (r.current_marks ?? 0), 0) / totalStudents
    : 0;
  const goodCount = totalStudents - atRisk.length;
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
  ];
  const now = new Date();
  const h = now.getHours();
  const part = h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
  const name = profile?.full_name?.trim() || "there";
  const date = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return (
    <DashboardShell
      greeting={`Good ${part}, ${name}`}
      dateLine={`${date} · ${schoolName}`}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
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
                    {row.current_marks}/{row.starting_marks ?? 40}
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
    </DashboardShell>
  );
}
