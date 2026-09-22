import { createFileRoute } from "@tanstack/react-router";
import { DashboardShell } from "@/components/DashboardShell";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Reports — SCDMS" },
      {
        name: "description",
        content: "Conduct trends, category breakdowns, and term reports.",
      },
      { property: "og:title", content: "Reports — SCDMS" },
      {
        property: "og:description",
        content: "Conduct trends, category breakdowns, and term reports.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReportsPage,
});

function ReportsPage() {
  return (
    <DashboardShell
      greeting="Reports"
      dateLine="Tuesday, 22 September 2026 · Northfield Academy"
    >
      <div className="rounded-3xl border border-glass-line bg-glass p-10 shadow-panel backdrop-blur-2xl">
        <h2 className="font-display text-2xl font-bold text-ink">Reports &amp; trends</h2>
        <p className="mt-2 max-w-md text-sm text-soft">
          Term-over-term conduct trends, year-group comparisons, and exportable reports
          will live here. This section is coming next.
        </p>
      </div>
    </DashboardShell>
  );
}
