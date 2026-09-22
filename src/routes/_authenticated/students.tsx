import { createFileRoute } from "@tanstack/react-router";
import { DashboardShell } from "@/components/DashboardShell";

export const Route = createFileRoute("/_authenticated/students")({
  head: () => ({
    meta: [
      { title: "Students — SCDMS" },
      { name: "description", content: "Browse and manage student conduct records." },
      { property: "og:title", content: "Students — SCDMS" },
      { property: "og:description", content: "Browse and manage student conduct records." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: StudentsPage,
});

function StudentsPage() {
  return (
    <DashboardShell
      greeting="Students"
      dateLine="Tuesday, 22 September 2026 · Northfield Academy"
    >
      <div className="rounded-3xl border border-glass-line bg-glass p-10 shadow-panel backdrop-blur-2xl">
        <h2 className="font-display text-2xl font-bold text-ink">Student registry</h2>
        <p className="mt-2 max-w-md text-sm text-soft">
          The full student directory will live here — profiles, conduct history, merits,
          and flags. This section is coming next.
        </p>
      </div>
    </DashboardShell>
  );
}
