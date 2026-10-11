import { createFileRoute, Link } from "@tanstack/react-router";
import { DashboardShell } from "@/components/DashboardShell";
import { useAuth } from "@/hooks/useAuth";
import { DEFAULT_SETTINGS, useSchoolSettings } from "@/hooks/useSchoolSettings";
import { STANDING_CLASS, STANDING_LABEL, useConductStandings } from "@/hooks/useConductStandings";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "SCDMS Dashboard — Northfield Academy" },
      {
        name: "description",
        content:
          "School Conduct & Discipline Management System dashboard: open cases, recent conduct actions, and incident trends at a glance.",
      },
      { property: "og:title", content: "SCDMS Dashboard — Northfield Academy" },
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
  const { profile } = useAuth();
  const { data: school } = useSchoolSettings();
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
      value: isPending ? "…" : `${avgScore.toFixed(1)}/40`,
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
      dateLine={`${date} · ${school?.school_name ?? DEFAULT_SETTINGS.school_name}`}
    >
      <div className="grid grid-cols-3 gap-6">
        {KPI_CARDS.map((card) => (
          <div
            key={card.label}
            className="rounded-3xl border border-glass-line bg-glass p-6 shadow-panel backdrop-blur-2xl"
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
            <div className="mt-3 font-display text-4xl font-bold text-ink">{card.value}</div>
            <div className="mt-1 text-[12px] text-soft">{card.note}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-5 gap-6">
        <div className="col-span-3 rounded-3xl border border-glass-line bg-glass p-6 shadow-panel backdrop-blur-2xl">
          <div className="flex items-center justify-between">
            <div className="font-display text-[15px] font-bold text-ink">
              Recent conduct actions
            </div>
            <Link
              to="/conduct-actions"
              className="text-[12px] font-semibold text-brand hover:underline"
            >
              View all
            </Link>
          </div>
          <div className="mt-4 space-y-3">
            {RECENT_ACTIONS.map((row) => (
              <div
                key={row.student}
                className="flex items-center gap-4 rounded-2xl bg-glass-bright px-4 py-3 ring-1 ring-hairline"
              >
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-glass-bright text-[12px] font-bold text-ink ring-1 ring-hairline">
                  {row.initials}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-ink">{row.student}</div>
                  <div className="truncate text-[12px] text-soft">{row.detail}</div>
                </div>
                <span
                  className={`shrink-0 rounded-lg px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] ${row.badgeClass}`}
                >
                  {row.badge}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="col-span-2 rounded-3xl border border-glass-line bg-glass p-6 shadow-panel backdrop-blur-2xl">
          <div className="font-display text-[15px] font-bold text-ink">
            Incidents by category
          </div>
          <div className="mt-4 space-y-3">
            {CATEGORY_BREAKDOWN.map((cat) => (
              <div key={cat.label}>
                <div className="flex justify-between text-[12px] text-body">
                  <span>{cat.label}</span>
                  <span className="font-semibold">{cat.pct}%</span>
                </div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-track">
                  <div
                    className={`h-full rounded-full ${cat.barClass}`}
                    style={{ width: `${cat.pct}%` }}
                  ></div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 rounded-2xl bg-linear-to-br from-brand to-accent p-4 text-white shadow-brand-glow">
            <div className="text-[12px] font-semibold uppercase tracking-[0.1em] opacity-80">
              This term
            </div>
            <div className="mt-1 font-display text-2xl font-bold">-14% repeat cases</div>
            <div className="mt-1 text-[11px] opacity-80">
              Restorative actions trending down
            </div>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
