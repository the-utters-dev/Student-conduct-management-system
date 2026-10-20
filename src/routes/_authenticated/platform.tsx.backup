import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { DashboardShell } from "@/components/DashboardShell";
import { useAuth } from "@/hooks/useAuth";
import {
  PLANS,
  SCHOOL_STATUSES,
  assignStaff,
  createSchool,
  getPlatformOverview,
  inviteStaff,
  updateSchool,
  type Plan,
  type SchoolStatus,
  type StaffRole,
} from "@/lib/platform.functions";

export const Route = createFileRoute("/_authenticated/platform")({
  head: () => ({
    meta: [
      { title: "Platform Admin — SCDMS" },
      { name: "description", content: "Onboard schools, manage staff and subscriptions across SCDMS." },
      { property: "og:title", content: "Platform Admin — SCDMS" },
      { property: "og:description", content: "Onboard schools, manage staff and subscriptions across SCDMS." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PlatformPage,
});

const field =
  "rounded-2xl bg-glass-bright px-3 py-2 text-sm text-body outline-none ring-1 ring-hairline focus:ring-2 focus:ring-brand/50";
const card = "rounded-3xl border border-glass-line bg-glass p-6 shadow-panel backdrop-blur-2xl";

function PlatformPage() {
  const { isPlatformAdmin } = useAuth();
  const qc = useQueryClient();
  const overviewFn = useServerFn(getPlatformOverview);
  const createFn = useServerFn(createSchool);
  const updateFn = useServerFn(updateSchool);
  const assignFn = useServerFn(assignStaff);
  const inviteFn = useServerFn(inviteStaff);
  const [tab, setTab] = useState<"schools" | "staff" | "subs">("schools");
  const [name, setName] = useState("");
  const [plan, setPlan] = useState<Plan>("trial");
  const [invite, setInvite] = useState({ email: "", full_name: "", school_id: "", role: "discipline_admin" as StaffRole });

  const q = useQuery({ queryKey: ["platform"], queryFn: () => overviewFn(), enabled: isPlatformAdmin });
  const refresh = () => qc.invalidateQueries({ queryKey: ["platform"] });
  const run = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      toast.success("Saved");
      void refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!isPlatformAdmin) {
    return (
      <DashboardShell greeting="Platform" dateLine="System Administrators only">
        <div className={card}>
          <h2 className="font-display text-2xl font-bold text-ink">Restricted section</h2>
          <p className="mt-2 text-sm text-soft">Only System Administrators can manage schools and subscriptions.</p>
        </div>
      </DashboardShell>
    );
  }

  const schools = q.data?.schools ?? [];
  const staff = q.data?.staff ?? [];

  return (
    <DashboardShell greeting="Platform Admin" dateLine="Schools, staff and subscriptions">
      <div className="flex gap-2">
        {([
          ["schools", "Schools"],
          ["staff", "Staff setup"],
          ["subs", "Subscriptions"],
        ] as const).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={tab === k ? "rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-on-brand" : "rounded-xl px-4 py-2 text-sm font-semibold text-soft ring-1 ring-hairline"}
          >
            {l}
          </button>
        ))}
      </div>
      {q.error && <div className={card}><p className="text-sm text-danger">{(q.error as Error).message}</p></div>}

      {tab === "schools" && (
        <div className={card}>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              run.mutate(() => createFn({ data: { name, plan, trial_ends_at: null, student_limit: null } }).then(() => setName("")));
            }}
          >
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New school name" className={`${field} flex-1`} />
            <select value={plan} onChange={(e) => setPlan(e.target.value as Plan)} className={field}>
              {PLANS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <button disabled={name.trim().length < 2} className="rounded-2xl bg-brand px-4 py-2 text-sm font-semibold text-on-brand disabled:opacity-50">Add school</button>
          </form>
          <table className="mt-5 w-full text-left text-[13px]">
            <thead className="text-[10px] uppercase tracking-[0.12em] text-faint">
              <tr><th className="py-2">School</th><th>ID</th><th>Plan</th><th>Status</th><th>Staff</th><th>Students</th></tr>
            </thead>
            <tbody>
              {schools.map((s) => (
                <tr key={s.id} className="border-t border-hairline">
                  <td className="py-2 font-semibold text-ink">{s.name}</td>
                  <td>
                    <button className="font-mono text-[11px] text-brand" onClick={() => { void navigator.clipboard.writeText(s.id); toast.success("School ID copied"); }}>
                      {s.id.slice(0, 8)}… copy
                    </button>
                  </td>
                  <td className="text-soft">{s.plan}</td>
                  <td className={s.status === "active" ? "text-ok" : "text-danger"}>{s.status}</td>
                  <td className="text-soft">{s.staff_count}</td>
                  <td className="text-soft">{s.student_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "staff" && (
        <div className="space-y-5">
          <form
            className={`${card} flex flex-wrap gap-2`}
            onSubmit={(e) => {
              e.preventDefault();
              run.mutate(() => inviteFn({ data: { ...invite, redirect_to: `${window.location.origin}/auth` } }));
            }}
          >
            <input placeholder="Email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} className={field} />
            <input placeholder="Full name" value={invite.full_name} onChange={(e) => setInvite({ ...invite, full_name: e.target.value })} className={field} />
            <select value={invite.school_id} onChange={(e) => setInvite({ ...invite, school_id: e.target.value })} className={field}>
              <option value="">Choose school</option>
              {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value as StaffRole })} className={field}>
              <option value="discipline_admin">Matron / Patron</option>
              <option value="school_leader">School Leader</option>
            </select>
            <button className="rounded-2xl bg-brand px-4 py-2 text-sm font-semibold text-on-brand">Send invite</button>
          </form>
          <div className={card}>
            {staff.map((p) => {
              const role: StaffRole = p.roles.includes("discipline_admin") ? "discipline_admin" : "school_leader";
              return (
                <div key={p.id} className="flex flex-wrap items-center gap-2 border-t border-hairline py-2 first:border-0">
                  <div className="min-w-48 flex-1">
                    <p className="text-[13px] font-semibold text-ink">{p.full_name || p.email}</p>
                    <p className="text-[11px] text-soft">{p.email}{p.roles.includes("system_admin") ? " · System admin" : ""}</p>
                  </div>
                  <select defaultValue={p.school_id ?? ""} onChange={(e) => run.mutate(() => assignFn({ data: { user_id: p.id, school_id: e.target.value || null, role } }))} className={field}>
                    <option value="">No school</option>
                    {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <select defaultValue={role} onChange={(e) => run.mutate(() => assignFn({ data: { user_id: p.id, school_id: p.school_id, role: e.target.value as StaffRole } }))} className={field}>
                    <option value="discipline_admin">Matron / Patron</option>
                    <option value="school_leader">School Leader</option>
                  </select>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === "subs" && (
        <div className={card}>
          {schools.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-2 border-t border-hairline py-3 first:border-0">
              <p className="min-w-48 flex-1 text-[13px] font-semibold text-ink">{s.name}</p>
              <select defaultValue={s.plan} onChange={(e) => run.mutate(() => updateFn({ data: { id: s.id, plan: e.target.value as Plan } }))} className={field}>
                {PLANS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <select defaultValue={s.status} onChange={(e) => run.mutate(() => updateFn({ data: { id: s.id, status: e.target.value as SchoolStatus } }))} className={field}>
                {SCHOOL_STATUSES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <input type="date" defaultValue={s.trial_ends_at ?? ""} onBlur={(e) => run.mutate(() => updateFn({ data: { id: s.id, trial_ends_at: e.target.value || null } }))} className={field} />
              <input type="number" min={0} placeholder="Student limit" defaultValue={s.student_limit ?? ""} onBlur={(e) => run.mutate(() => updateFn({ data: { id: s.id, student_limit: e.target.value ? Number(e.target.value) : null } }))} className={`${field} w-32`} />
            </div>
          ))}
        </div>
      )}
    </DashboardShell>
  );
}
