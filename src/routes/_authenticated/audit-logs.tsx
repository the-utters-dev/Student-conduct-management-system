import { createFileRoute } from "@tanstack/react-router";
import { DashboardShell } from "@/components/DashboardShell";

export const Route = createFileRoute("/audit-logs")({
  head: () => ({
    meta: [
      { title: "Audit Logs — SCDMS" },
      {
        name: "description",
        content: "Full audit trail of every action taken in the system.",
      },
      { property: "og:title", content: "Audit Logs — SCDMS" },
      {
        property: "og:description",
        content: "Full audit trail of every action taken in the system.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuditLogsPage,
});

function AuditLogsPage() {
  return (
    <DashboardShell
      greeting="Audit Logs"
      dateLine="Tuesday, 22 September 2026 · Northfield Academy"
    >
      <div className="rounded-3xl border border-glass-line bg-glass p-10 shadow-panel backdrop-blur-2xl">
        <h2 className="font-display text-2xl font-bold text-ink">Audit trail</h2>
        <p className="mt-2 max-w-md text-sm text-soft">
          Every log entry, edit, and permission change is recorded here for full
          accountability. This section is coming next.
        </p>
      </div>
    </DashboardShell>
  );
}
