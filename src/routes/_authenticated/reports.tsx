import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { DashboardShell } from "@/components/DashboardShell";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { STANDING_CLASS, STANDING_LABEL, standingOf } from "@/hooks/useConductStandings";
import { useSchoolSettings } from "@/hooks/useSchoolSettings";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({
    meta: [
      { title: "Reports — SCDMS" },
      { name: "description", content: "Conduct trends, category breakdowns, and term reports." },
      { property: "og:title", content: "Reports — SCDMS" },
      { property: "og:description", content: "Conduct trends, category breakdowns, and term reports." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReportsPage,
});

interface Balance {
  student_id: string | null;
  full_name: string | null;
  admission_no: string | null;
  class_name: string | null;
  parent_phone: string | null;
  current_marks: number | null;
  starting_marks: number | null;
  marks_deducted: number | null;
  marks_restored: number | null;
  entries_count: number | null;
  term_id: string | null;
  term_name: string | null;
}
interface Log {
  id: string;
  student_id: string;
  entry_type: string;
  marks: number;
  reason: string | null;
  occurred_on: string;
  offenses_catalog: { title: string; category: string } | null;
}

function weekStart(d: string) {
  const dt = new Date(d + "T00:00:00");
  const day = (dt.getDay() + 6) % 7;
  dt.setDate(dt.getDate() - day);
  return dt.toISOString().slice(0, 10);
}

function csvCell(v: unknown) {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function ReportsPage() {
  const [historyFor, setHistoryFor] = useState<Balance | null>(null);
  const { data: school } = useSchoolSettings();
  const { schoolId, can } = useAuth();
  const criticalThreshold = school?.critical_threshold ?? 20;
  const warningThreshold = school?.warning_threshold ?? 30;

  // Check permission
  if (!can("view_reports")) {
    return (
      <DashboardShell greeting="Reports" dateLine="Conduct trends and analytics">
        <div className="rounded-3xl border border-glass-line bg-glass p-6 shadow-panel backdrop-blur-2xl">
          <div className="py-12 text-center">
            <h3 className="font-display text-lg font-bold text-ink">Access not permitted</h3>
            <p className="mt-2 text-sm text-soft">
              Your role does not have permission to view reports. Contact your School Director to adjust permissions.
            </p>
          </div>
        </div>
      </DashboardShell>
    );
  }

  const balancesQ = useQuery({
    queryKey: ["student-balances", schoolId],
    queryFn: async (): Promise<Balance[]> => {
      const { data, error } = await supabase.from("student_conduct_balances").select("*");
      if (error) throw error;
      return data as Balance[];
    },
  });
  const termId = balancesQ.data?.[0]?.term_id ?? null;
  const termName = balancesQ.data?.[0]?.term_name ?? "Current term";

  const logsQ = useQuery({
    queryKey: ["term-logs", termId, schoolId],
    enabled: !!termId,
    queryFn: async (): Promise<Log[]> => {
      const { data, error } = await supabase
        .from("conduct_logs")
        .select("id, student_id, entry_type, marks, reason, occurred_on, offenses_catalog(title, category)")
        .eq("term_id", termId!)
        .order("occurred_on", { ascending: false });
      if (error) throw error;
      return data as unknown as Log[];
    },
  });

  const balances = balancesQ.data ?? [];
  const logs = logsQ.data ?? [];

  const stats = useMemo(() => {
    const avg = balances.length
      ? balances.reduce((s, b) => s + (b.current_marks ?? 0), 0) / balances.length
      : 0;
    const deducted = balances.reduce((s, b) => s + (b.marks_deducted ?? 0), 0);
    const restored = balances.reduce((s, b) => s + (b.marks_restored ?? 0), 0);
    const incidents = logs.filter((l) => l.entry_type === "deduction").length;
    const critical = balances
      .filter((b) => (b.current_marks ?? 0) <= criticalThreshold)
      .sort((a, b) => (a.current_marks ?? 0) - (b.current_marks ?? 0));
    return { avg, deducted, restored, incidents, critical };
  }, [balances, logs, criticalThreshold]);

  const offensesByStudent = useMemo(() => {
    const m = new Map<string, number>();
    logs.forEach((l) => l.entry_type === "deduction" && m.set(l.student_id, (m.get(l.student_id) ?? 0) + 1));
    return m;
  }, [logs]);

  const byCategory = useMemo(() => {
    const m = new Map<string, number>();
    logs
      .filter((l) => l.entry_type === "deduction")
      .forEach((l) => {
        const k = l.offenses_catalog?.category ?? "Other";
        m.set(k, (m.get(k) ?? 0) + 1);
      });
    return [...m.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count);
  }, [logs]);

  const weekly = useMemo(() => {
    const m = new Map<string, { deductions: number; restorations: number }>();
    logs.forEach((l) => {
      const w = weekStart(l.occurred_on);
      const e = m.get(w) ?? { deductions: 0, restorations: 0 };
      if (l.entry_type === "deduction") e.deductions++;
      else e.restorations++;
      m.set(w, e);
    });
    return [...m.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, v]) => ({
        week: new Date(week).toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
        ...v,
      }));
  }, [logs]);

  function exportCsv() {
    const header = ["Student Name", "Code", "Class", "Starting Marks", "Marks Deducted", "Marks Restored", "Current Balance", "Total Offenses", "Parent Contact", "Status"];
    const rows = balances.map((b) => [
      b.full_name, b.admission_no, b.class_name, b.starting_marks, b.marks_deducted, b.marks_restored,
      b.current_marks, offensesByStudent.get(b.student_id ?? "") ?? 0, b.parent_phone,
      (b.current_marks ?? 0) <= criticalThreshold ? "Critical" : "OK",
    ]);
    const csv = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `scdms-conduct-report-${termName.replace(/\s+/g, "-").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const history = logs.filter((l) => l.student_id === historyFor?.student_id);
  const loading = balancesQ.isPending || (!!termId && logsQ.isPending);
  const panel = "rounded-3xl border border-glass-line bg-glass p-6 shadow-panel backdrop-blur-2xl";

  return (
    <DashboardShell greeting="Reports" dateLine={`${termName} · Conduct analytics`}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-bold text-ink">Term conduct report</h2>
          <p className="text-sm text-soft">Live figures across all active students.</p>
        </div>
        <button
          onClick={exportCsv}
          disabled={!balances.length}
          className="rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-on-brand shadow-brand-glow disabled:opacity-50"
        >
          Export Report (CSV)
        </button>
      </div>

      {balancesQ.error && <p className="mb-4 text-sm text-danger">Could not load report data.</p>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Average conduct score" value={loading ? "…" : `${stats.avg.toFixed(1)}/40`} />
        <Stat label="Incidents this term" value={loading ? "…" : String(stats.incidents)} />
        <Stat label="Deducted vs restored" value={loading ? "…" : `${stats.deducted} / ${stats.restored}`} />
        <Stat label="Critical alerts (≤20)" value={loading ? "…" : String(stats.critical.length)} danger />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className={panel}>
          <h3 className="font-display text-lg font-bold text-ink">Offenses by category</h3>
          <div className="mt-4 h-64">
            {byCategory.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byCategory} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-hairline)" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} fontSize={12} />
                  <YAxis type="category" dataKey="category" width={110} fontSize={12} />
                  <Tooltip />
                  <Bar dataKey="count" name="Incidents" fill="var(--color-brand)" radius={[0, 8, 8, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Empty />
            )}
          </div>
        </div>
        <div className={panel}>
          <h3 className="font-display text-lg font-bold text-ink">Weekly incident trend</h3>
          <div className="mt-4 h-64">
            {weekly.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={weekly}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-hairline)" />
                  <XAxis dataKey="week" fontSize={12} />
                  <YAxis allowDecimals={false} fontSize={12} />
                  <Tooltip />
                  <Line type="monotone" dataKey="deductions" name="Deductions" stroke="var(--color-brand)" strokeWidth={2.5} />
                  <Line type="monotone" dataKey="restorations" name="Restorations" stroke="var(--color-accent)" strokeWidth={2.5} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <Empty />
            )}
          </div>
        </div>
      </div>

      <div className={`${panel} mt-6 overflow-x-auto`}>
        <h3 className="font-display text-lg font-bold text-ink">Critical discipline alerts</h3>
        <p className="text-sm text-soft">Students at or below {criticalThreshold} marks.</p>
        <table className="mt-4 w-full min-w-[720px] text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-faint">
            <tr>
              <th className="py-2">Student name</th><th>Code</th><th>Class</th><th>Current balance</th>
              <th>Total offenses</th><th>Parent contact</th><th></th>
            </tr>
          </thead>
          <tbody>
            {stats.critical.map((b) => (
              <tr key={b.student_id} className="border-t border-hairline">
                <td className="py-3 font-semibold text-ink">{b.full_name}</td>
                <td className="text-soft">{b.admission_no}</td>
                <td className="text-soft">{b.class_name}</td>
                <td>
                  <span className="rounded-full bg-danger px-2.5 py-1 text-xs font-bold text-on-brand">
                    {b.current_marks}/{b.starting_marks ?? 40}
                  </span>
                </td>
                <td className="text-ink">{offensesByStudent.get(b.student_id ?? "") ?? 0}</td>
                <td className="text-soft">{b.parent_phone ?? "—"}</td>
                <td className="text-right">
                  <button
                    onClick={() => setHistoryFor(b)}
                    className="rounded-lg border border-glass-line bg-glass-bright px-3 py-1.5 text-xs font-semibold text-ink"
                  >
                    View history
                  </button>
                </td>
              </tr>
            ))}
            {!loading && !stats.critical.length && (
              <tr><td colSpan={7} className="py-6 text-center text-soft">No students are at or below {criticalThreshold} marks.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className={`${panel} mt-6 overflow-x-auto`}>
        <h3 className="font-display text-lg font-bold text-ink">Conduct &amp; discipline breakdown</h3>
        <p className="text-sm text-soft">
          Every active student's deductions, restorations, warnings, and current standing this term.
        </p>
        <table className="mt-4 w-full min-w-[820px] text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-faint">
            <tr>
              <th className="py-2">Student name</th><th>Class</th><th>Marks deducted</th>
              <th>Marks restored</th><th>Warnings</th><th>Current balance</th><th>Standing</th>
            </tr>
          </thead>
          <tbody>
            {[...balances]
              .sort((a, b) => (a.current_marks ?? 0) - (b.current_marks ?? 0))
              .map((b) => {
                const standing = standingOf(b.current_marks ?? 0, criticalThreshold, warningThreshold);
                return (
                  <tr key={b.student_id} className="border-t border-hairline">
                    <td className="py-3 font-semibold text-ink">{b.full_name}</td>
                    <td className="text-soft">{b.class_name ?? "—"}</td>
                    <td className="text-danger">−{b.marks_deducted ?? 0}</td>
                    <td className="text-ok">+{b.marks_restored ?? 0}</td>
                    <td className="text-ink">{offensesByStudent.get(b.student_id ?? "") ?? 0}</td>
                    <td className="font-semibold text-ink">
                      {b.current_marks}/{b.starting_marks ?? 40}
                    </td>
                    <td>
                      <span className={`rounded-lg px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] ${STANDING_CLASS[standing]}`}>
                        {STANDING_LABEL[standing]}
                      </span>
                    </td>
                  </tr>
                );
              })}
            {!loading && !balances.length && (
              <tr><td colSpan={7} className="py-6 text-center text-soft">No student records found.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={!!historyFor} onOpenChange={(o) => !o && setHistoryFor(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{historyFor?.full_name} — conduct history</DialogTitle>
          </DialogHeader>
          <ul className="max-h-96 space-y-2 overflow-y-auto">
            {history.map((l) => (
              <li key={l.id} className="flex items-start justify-between gap-3 rounded-xl border border-hairline p-3 text-sm">
                <div>
                  <p className="font-semibold text-ink">{l.offenses_catalog?.title ?? l.reason ?? "Entry"}</p>
                  <p className="text-xs text-soft">{new Date(l.occurred_on).toLocaleDateString("en-GB")}{l.reason && l.offenses_catalog ? ` · ${l.reason}` : ""}</p>
                </div>
                <span className={`font-bold ${l.entry_type === "deduction" ? "text-danger" : "text-ok"}`}>
                  {l.entry_type === "deduction" ? "−" : "+"}{l.marks}
                </span>
              </li>
            ))}
            {!history.length && <li className="text-sm text-soft">No entries this term.</li>}
          </ul>
        </DialogContent>
      </Dialog>
    </DashboardShell>
  );
}

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-3xl border border-glass-line bg-glass p-5 shadow-panel backdrop-blur-2xl">
      <p className="text-xs font-semibold uppercase tracking-wide text-faint">{label}</p>
      <p className={`mt-2 font-display text-3xl font-bold ${danger ? "text-danger" : "text-ink"}`}>{value}</p>
    </div>
  );
}

function Empty() {
  return <div className="flex h-full items-center justify-center text-sm text-soft">No entries yet this term.</div>;
}
