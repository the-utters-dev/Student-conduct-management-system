import { createFileRoute } from "@tanstack/react-router";
import { DashboardShell } from "@/components/DashboardShell";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/conduct-actions")({
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
  const { isDisciplineStaff } = useAuth();

  return (
    <DashboardShell
      greeting="Conduct Actions"
      dateLine="Mark deductions and restorations · Northfield Academy"
    >
      <div className="rounded-3xl border border-glass-line bg-glass p-10 shadow-panel backdrop-blur-2xl">
        {isDisciplineStaff ? (
          <>
            <h2 className="font-display text-2xl font-bold text-ink">Action log</h2>
            <p className="mt-2 max-w-md text-sm text-soft">
              Every deduction, restoration and restorative chat will be logged and
              filterable here. This section is coming next.
            </p>
          </>
        ) : (
          <>
            <h2 className="font-display text-2xl font-bold text-ink">Restricted section</h2>
            <p className="mt-2 max-w-md text-sm text-soft">
              Recording conduct entries is limited to matrons and patrons. As a school
              leader you can view student records and reports.
            </p>
          </>
        )}
      </div>
    </DashboardShell>
  );
}
