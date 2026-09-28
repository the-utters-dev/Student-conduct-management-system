import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useAuth, ROLE_LABELS, type AppRole } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/audit-logs")({
  head: () => ({
    meta: [
      { title: "Audit Logs — SCDMS" },
      { name: "description", content: "Compliance audit trail of every staff action in SCDMS." },
      { property: "og:title", content: "Audit Logs — SCDMS" },
      { property: "og:description", content: "Compliance audit trail of every staff action in SCDMS." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuditLogsPage,
});

interface AuditRow {
  id: string;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  payload: Json | null;
  created_at: string;
}
interface Staff {
  full_name: string;
  email: string | null;
  job_title: string | null;
  roles: AppRole[];
}

const FILTERS: Record<string, { label: string; match: (a: string) => boolean }> = {
  all: { label: "All actions", match: () => true },
  conduct: { label: "Conduct actions", match: (a) => a.includes("CONDUCT") },
  login: { label: "Login attempts", match: (a) => a.includes("LOGIN") || a.includes("SIGN") },
  profile: { label: "Profile updates", match: (a) => a.includes("PROFILE") },
};

function AuditLogsPage() {
  const { role, loading } = useAuth();
  const allowed = role === "school_leader" || role === "system_admin";

  return (
    <DashboardShell greeting="Audit Logs" dateLine="Compliance trail · newest first">
      {loading ? null : allowed ? (
        <AuditViewer />
      ) : (
        <div className="rounded-3xl border border-glass-line bg-glass p-10 shadow-panel backdrop-blur-2xl">
          <h2 className="font-display text-2xl font-bold text-ink">Permission required</h2>
          <p className="mt-2 max-w-md text-sm text-soft">
            The full audit trail is available to School Leaders and System Administrators only.
            Matrons and Patrons can keep recording conduct entries — each one is still logged here.
          </p>
        </div>
      )}
    </DashboardShell>
  );
}

function payloadObj(p: Json | null): Record<string, Json | undefined> {
  return p && typeof p === "object" && !Array.isArray(p) ? p : {};
}

function AuditViewer() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selected, setSelected] = useState<AuditRow | null>(null);

  const q = useQuery({
    queryKey: ["audit-logs"],
    queryFn: async () => {
      const { data: logs, error } = await supabase
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      const ids = [...new Set(logs.map((l) => l.user_id).filter(Boolean))] as string[];
      const staff = new Map<string, Staff>();
      if (ids.length) {
        const [{ data: profs }, { data: roles }] = await Promise.all([
          supabase.from("profiles").select("id, full_name, email, job_title").in("id", ids),
          supabase.from("user_roles").select("user_id, role").in("user_id", ids),
        ]);
        profs?.forEach((p) =>
          staff.set(p.id, { full_name: p.full_name, email: p.email, job_title: p.job_title, roles: [] }),
        );
        roles?.forEach((r) => staff.get(r.user_id)?.roles.push(r.role));
      }
      return { logs: logs as AuditRow[], staff };
    },
  });

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data?.logs ?? []).filter((l) => {
      if (!FILTERS[filter]?.match(l.action)) return false;
      const day = l.created_at.slice(0, 10);
      if (from && day < from) return false;
      if (to && day > to) return false;
      if (!s) return true;
      const st = l.user_id ? q.data?.staff.get(l.user_id) : undefined;
      const p = payloadObj(l.payload);
      return [st?.full_name, st?.email, l.action, String(p["student_id"] ?? ""), l.entity_id]
        .some((v) => v?.toLowerCase().includes(s));
    });
  }, [q.data, search, filter, from, to]);

  const staffOf = (id: string | null) => (id ? q.data?.staff.get(id) : undefined);
  const input = "rounded-xl border border-glass-line bg-glass-bright px-3 py-2 text-sm text-ink outline-none";
  const sel = selected ? staffOf(selected.user_id) : undefined;
  const selPayload = payloadObj(selected?.payload ?? null);
  const session = payloadObj((selPayload["session"] as Json) ?? null);

  return (
    <div className="rounded-3xl border border-glass-line bg-glass p-6 shadow-panel backdrop-blur-2xl">
      <div className="flex flex-wrap items-end gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search staff, student ID or action…"
          className={`${input} min-w-[240px] flex-1`}
        />
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className={input}>
          {Object.entries(FILTERS).map(([k, f]) => (
            <option key={k} value={k}>{f.label}</option>
          ))}
        </select>
        <label className="text-xs text-faint">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${input} ml-2`} /></label>
        <label className="text-xs text-faint">To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={`${input} ml-2`} /></label>
      </div>

      {q.error && <p className="mt-4 text-sm text-danger">Could not load the audit trail.</p>}

      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-faint">
            <tr><th className="py-2">Timestamp</th><th>Staff member</th><th>Action</th><th>Target entity</th><th>Details</th></tr>
          </thead>
          <tbody>
            {rows.map((l) => {
              const st = staffOf(l.user_id);
              return (
                <tr key={l.id} onClick={() => setSelected(l)} className="cursor-pointer border-t border-hairline hover:bg-glass-soft">
                  <td className="py-3 whitespace-nowrap text-soft">{new Date(l.created_at).toLocaleString("en-GB")}</td>
                  <td>
                    <p className="font-semibold text-ink">{st?.full_name || st?.email || "Unknown user"}</p>
                    <p className="text-xs text-faint">{st?.job_title ?? st?.email ?? ""}</p>
                  </td>
                  <td><span className="rounded-full bg-glass-bright px-2.5 py-1 font-mono text-xs font-semibold text-brand">{l.action}</span></td>
                  <td className="text-soft">{l.entity_type}<span className="block font-mono text-xs text-faint">{l.entity_id?.slice(0, 8) ?? "—"}</span></td>
                  <td className="max-w-[260px] truncate font-mono text-xs text-soft">{l.payload ? JSON.stringify(l.payload) : "—"}</td>
                </tr>
              );
            })}
            {!q.isPending && !rows.length && (
              <tr><td colSpan={5} className="py-8 text-center text-soft">No audit entries match these filters.</td></tr>
            )}
            {q.isPending && <tr><td colSpan={5} className="py-8 text-center text-soft">Loading…</td></tr>}
          </tbody>
        </table>
      </div>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader><SheetTitle>{selected?.action}</SheetTitle></SheetHeader>
          {selected && (
            <div className="space-y-5 p-4 text-sm">
              <Section title="Staff credentials">
                <Field k="Name" v={sel?.full_name || "Unknown"} />
                <Field k="Email" v={sel?.email ?? "—"} />
                <Field k="Title" v={sel?.job_title ?? "—"} />
                <Field k="Role" v={sel?.roles.map((r) => ROLE_LABELS[r].label).join(", ") || "—"} />
                <Field k="User ID" v={selected.user_id ?? "—"} mono />
              </Section>
              <Section title="Target entity">
                <Field k="Type" v={selected.entity_type} />
                <Field k="ID" v={selected.entity_id ?? "—"} mono />
                <Field k="Recorded" v={new Date(selected.created_at).toLocaleString("en-GB")} />
              </Section>
              <Section title="IP / session metadata">
                <Field k="IP address" v={String(selPayload["ip"] ?? "Not captured")} />
                <Field k="Device" v={String(session["user_agent"] ?? "Not captured")} />
                <Field k="Timezone" v={String(session["timezone"] ?? "Not captured")} />
              </Section>
              <Section title="Raw payload">
                <pre className="overflow-x-auto rounded-xl bg-glass-soft p-3 font-mono text-xs text-ink">
                  {JSON.stringify(selected.payload, null, 2)}
                </pre>
              </Section>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">{title}</h4>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}
function Field({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-soft">{k}</span>
      <span className={`text-right text-ink break-all ${mono ? "font-mono text-xs" : ""}`}>{v}</span>
    </div>
  );
}
