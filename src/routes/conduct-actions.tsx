import { createFileRoute } from "@tanstack/react-router";
import { DashboardShell } from "@/components/DashboardShell";

export const Route = createFileRoute("/conduct-actions")({
  head: () => ({
    meta: [
      { title: "Conduct Actions — SCDMS" },
      {
        name: "description",
        content: "Log and review disciplinary and positive conduct actions.",
      },
      { property: "og:title", content: "Conduct Actions — SCDMS" },
      {
        property: "og:description",
        content: "Log and review disciplinary and positive conduct actions.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ConductActionsPage,
});

function ConductActionsPage() {
  return (
    <DashboardShell
      greeting="Conduct Actions"
      dateLine="Tuesday, 22 September 2026 · Northfield Academy"
    >
      <div className="rounded-3xl border border-glass-line bg-glass p-10 shadow-panel backdrop-blur-2xl">
        <h2 className="font-display text-2xl font-bold text-ink">Action log</h2>
        <p className="mt-2 max-w-md text-sm text-soft">
          Every warning, detention, restorative chat, and merit will be logged and
          filterable here. This section is coming next.
        </p>
      </div>
    </DashboardShell>
  );
}
