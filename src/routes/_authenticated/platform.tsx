import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { DashboardShell } from "@/components/DashboardShell";
import { useAuth } from "@/hooks/useAuth";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  PLANS,
  SCHOOL_STATUSES,
  STAFF_ROLES,
  assignStaff,
  createSchool,
  deleteSchool,
  downloadSchoolData,
  getPlatformOverview,
  inviteStaff,
  renameSchool,
  updateSchool,
  updateSchoolStatus,
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

const ROLE_LABELS: Record<StaffRole, string> = {
  school_director: "School Director",
  master_of_discipline: "Master of Discipline",
  matron: "Matron",
  patron: "Patron",
  school_leader: "School Leader (legacy)",
  discipline_admin: "Discipline Admin (legacy)",
};

function PlatformPage() {
  const { isPlatformAdmin } = useAuth();
  const qc = useQueryClient();
  const overviewFn = useServerFn(getPlatformOverview);
  const createFn = useServerFn(createSchool);
  const updateFn = useServerFn(updateSchool);
  const assignFn = useServerFn(assignStaff);
  const inviteFn = useServerFn(inviteStaff);
  const renameFn = useServerFn(renameSchool);
  const updateStatusFn = useServerFn(updateSchoolStatus);
  const deleteFn = useServerFn(deleteSchool);
  const downloadFn = useServerFn(downloadSchoolData);

  const [tab, setTab] = useState<"schools" | "staff" | "subs">("schools");
  const [name, setName] = useState("");
  const [plan, setPlan] = useState<Plan>("trial");
  const [invite, setInvite] = useState({
    email: "",
    full_name: "",
    school_id: "",
    role: "master_of_discipline" as StaffRole,
  });

  // Dialog states
  const [renameDialog, setRenameDialog] = useState<{ id: string; name: string } | null>(null);
  const [statusDialog, setStatusDialog] = useState<{ id: string; status: SchoolStatus; currentName: string } | null>(
    null
  );
  const [statusReason, setStatusReason] = useState("");
  const [deleteDialog, setDeleteDialog] = useState<{ id: string; name: string } | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");

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

  const formatDate = (d: string | null) => {
    if (!d) return "—";
    try {
      return new Date(d).toLocaleDateString();
    } catch {
      return "—";
    }
  };

  const formatDateTime = (d: string | null) => {
    if (!d) return "—";
    try {
      return new Date(d).toLocaleString();
    } catch {
      return "—";
    }
  };

  const downloadData = async (schoolId: string, schoolName: string) => {
    try {
      const data = await downloadFn({ data: { id: schoolId } });
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${schoolName.replace(/[^a-z0-9]/gi, "_")}_backup_${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("School data downloaded");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

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
            className={
              tab === k
                ? "rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-on-brand"
                : "rounded-xl px-4 py-2 text-sm font-semibold text-soft ring-1 ring-hairline"
            }
          >
            {l}
          </button>
        ))}
      </div>
      {q.error && (
        <div className={card}>
          <p className="text-sm text-danger">{(q.error as Error).message}</p>
        </div>
      )}

      {tab === "schools" && (
        <div className={card}>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              run.mutate(() =>
                createFn({ data: { name, plan, trial_ends_at: null, student_limit: null } }).then(() => setName(""))
              );
            }}
          >
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="New school name"
              className={`${field} flex-1`}
            />
            <select value={plan} onChange={(e) => setPlan(e.target.value as Plan)} className={field}>
              {PLANS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <button
              disabled={name.trim().length < 2}
              className="rounded-2xl bg-brand px-4 py-2 text-sm font-semibold text-on-brand disabled:opacity-50"
            >
              Add school
            </button>
          </form>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="text-[10px] uppercase tracking-[0.12em] text-faint">
                <tr>
                  <th className="py-2">School</th>
                  <th>ID</th>
                  <th>Plan</th>
                  <th>Status</th>
                  <th>Last Activity</th>
                  <th>Staff</th>
                  <th>Students</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {schools.map((s) => (
                  <tr key={s.id} className="border-t border-hairline">
                    <td className="py-2 font-semibold text-ink">
                      {s.name}
                      {s.status_reason && (
                        <span className="ml-2 text-[11px] text-soft" title={`Reason: ${s.status_reason}`}>
                          ({s.status_reason.slice(0, 30)}
                          {s.status_reason.length > 30 ? "..." : ""})
                        </span>
                      )}
                    </td>
                    <td>
                      <button
                        className="font-mono text-[11px] text-brand"
                        onClick={() => {
                          void navigator.clipboard.writeText(s.id);
                          toast.success("School ID copied");
                        }}
                      >
                        {s.id.slice(0, 8)}… copy
                      </button>
                    </td>
                    <td className="text-soft">{s.plan}</td>
                    <td className={s.status === "active" ? "text-ok" : "text-danger"}>
                      {s.status}
                      {s.status_changed_at && (
                        <span className="block text-[10px] text-faint">{formatDateTime(s.status_changed_at)}</span>
                      )}
                    </td>
                    <td className="text-soft">{formatDateTime(s.last_activity)}</td>
                    <td className="text-soft">{s.staff_count}</td>
                    <td className="text-soft">{s.student_count}</td>
                    <td>
                      <button
                        onClick={() => setRenameDialog({ id: s.id, name: s.name })}
                        className="mr-2 text-[11px] text-brand underline"
                      >
                        Rename
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Delete school danger zone */}
          <div className="mt-8 border-t border-danger/20 pt-6">
            <h3 className="text-lg font-bold text-danger">Danger Zone</h3>
            <p className="mt-1 text-sm text-soft">Permanently delete schools (cancelled status only).</p>
            <div className="mt-4 space-y-2">
              {schools
                .filter((s) => s.status === "cancelled")
                .map((s) => (
                  <div key={s.id} className="flex items-center justify-between rounded-lg bg-danger/5 px-4 py-2">
                    <span className="text-sm font-medium text-ink">{s.name}</span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => downloadData(s.id, s.name)}
                        className="text-xs text-brand underline"
                      >
                        Download data
                      </button>
                      <button
                        onClick={() => setDeleteDialog({ id: s.id, name: s.name })}
                        className="rounded-lg bg-danger px-3 py-1 text-xs font-semibold text-white"
                      >
                        Delete permanently
                      </button>
                    </div>
                  </div>
                ))}
              {schools.filter((s) => s.status === "cancelled").length === 0 && (
                <p className="text-sm text-faint">No schools with cancelled status.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === "staff" && (
        <div className="space-y-5">
          <form
            className={`${card} flex flex-wrap gap-2`}
            onSubmit={(e) => {
              e.preventDefault();
              run.mutate(() =>
                inviteFn({ data: { ...invite, redirect_to: `${window.location.origin}/auth` } }).then(() =>
                  setInvite({ email: "", full_name: "", school_id: "", role: "master_of_discipline" })
                )
              );
            }}
          >
            <input
              placeholder="Email"
              value={invite.email}
              onChange={(e) => setInvite({ ...invite, email: e.target.value })}
              className={field}
            />
            <input
              placeholder="Full name"
              value={invite.full_name}
              onChange={(e) => setInvite({ ...invite, full_name: e.target.value })}
              className={field}
            />
            <select
              value={invite.school_id}
              onChange={(e) => setInvite({ ...invite, school_id: e.target.value })}
              className={field}
            >
              <option value="">Choose school</option>
              {schools.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select
              value={invite.role}
              onChange={(e) => setInvite({ ...invite, role: e.target.value as StaffRole })}
              className={field}
            >
              {STAFF_ROLES.filter((r) => !r.includes("legacy")).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            <button className="rounded-2xl bg-brand px-4 py-2 text-sm font-semibold text-on-brand">
              Send invite
            </button>
          </form>
          <div className={card}>
            <h3 className="mb-4 text-sm font-semibold text-soft">Assign staff to schools</h3>
            {staff
              .filter((p) => !p.roles.includes("system_admin"))
              .map((p) => {
                // Determine current role (prefer new roles over legacy)
                const role: StaffRole =
                  (p.roles.find((r) => ["school_director", "master_of_discipline", "matron", "patron"].includes(r)) as StaffRole) ||
                  (p.roles.includes("school_leader") ? "school_leader" : "discipline_admin");

                return (
                  <div
                    key={p.id}
                    className="flex flex-wrap items-center gap-2 border-t border-hairline py-2 first:border-0"
                  >
                    <div className="min-w-48 flex-1">
                      <p className="text-[13px] font-semibold text-ink">{p.full_name || p.email}</p>
                      <p className="text-[11px] text-soft">{p.email}</p>
                    </div>
                    <select
                      value={p.school_id ?? ""}
                      onChange={(e) =>
                        run.mutate(() =>
                          assignFn({ data: { user_id: p.id, school_id: e.target.value || null, role } })
                        )
                      }
                      className={field}
                    >
                      <option value="">No school</option>
                      {schools.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={role}
                      onChange={(e) =>
                        run.mutate(() =>
                          assignFn({ data: { user_id: p.id, school_id: p.school_id, role: e.target.value as StaffRole } })
                        )
                      }
                      className={field}
                    >
                      {STAFF_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            {staff.filter((p) => !p.roles.includes("system_admin")).length === 0 && (
              <p className="text-sm text-faint">No staff accounts yet.</p>
            )}
          </div>
        </div>
      )}

      {tab === "subs" && (
        <div className={card}>
          <h3 className="mb-4 text-sm font-semibold text-soft">Manage subscriptions and school status</h3>
          {schools.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-2 border-t border-hairline py-3 first:border-0">
              <p className="min-w-48 flex-1 text-[13px] font-semibold text-ink">{s.name}</p>
              <select
                value={s.plan}
                onChange={(e) => run.mutate(() => updateFn({ data: { id: s.id, plan: e.target.value as Plan } }))}
                className={field}
              >
                {PLANS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <button
                onClick={() => setStatusDialog({ id: s.id, status: s.status, currentName: s.name })}
                className={`${field} cursor-pointer ${s.status === "active" ? "text-ok" : "text-danger"}`}
              >
                {s.status} — Change
              </button>
              <input
                type="date"
                defaultValue={s.trial_ends_at ?? ""}
                onBlur={(e) =>
                  run.mutate(() => updateFn({ data: { id: s.id, trial_ends_at: e.target.value || null } }))
                }
                className={field}
                placeholder="Trial ends"
              />
              <input
                type="number"
                min={0}
                placeholder="Student limit"
                defaultValue={s.student_limit ?? ""}
                onBlur={(e) =>
                  run.mutate(() =>
                    updateFn({ data: { id: s.id, student_limit: e.target.value ? Number(e.target.value) : null } })
                  )
                }
                className={`${field} w-32`}
              />
            </div>
          ))}
        </div>
      )}

      {/* Rename dialog */}
      <Dialog open={!!renameDialog} onOpenChange={(open) => !open && setRenameDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename School</DialogTitle>
            <DialogDescription>Enter a new name for this school.</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (renameDialog) {
                run.mutate(() =>
                  renameFn({ data: { id: renameDialog.id, name: renameDialog.name } }).then(() =>
                    setRenameDialog(null)
                  )
                );
              }
            }}
          >
            <input
              value={renameDialog?.name ?? ""}
              onChange={(e) => renameDialog && setRenameDialog({ ...renameDialog, name: e.target.value })}
              className={`${field} w-full`}
              placeholder="School name"
            />
            <DialogFooter className="mt-4">
              <button
                type="button"
                onClick={() => setRenameDialog(null)}
                className="rounded-xl px-4 py-2 text-sm text-soft"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!renameDialog?.name.trim()}
                className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-on-brand disabled:opacity-50"
              >
                Rename
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Status change dialog */}
      <Dialog open={!!statusDialog} onOpenChange={(open) => !open && setStatusDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change School Status: {statusDialog?.currentName}</DialogTitle>
            <DialogDescription>
              Select a new status and provide a reason (required for suspension/cancellation).
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (statusDialog) {
                run.mutate(() =>
                  updateStatusFn({
                    data: { id: statusDialog.id, status: statusDialog.status, reason: statusReason },
                  }).then(() => {
                    setStatusDialog(null);
                    setStatusReason("");
                  })
                );
              }
            }}
          >
            <select
              value={statusDialog?.status ?? "active"}
              onChange={(e) =>
                statusDialog && setStatusDialog({ ...statusDialog, status: e.target.value as SchoolStatus })
              }
              className={`${field} w-full`}
            >
              {SCHOOL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <textarea
              value={statusReason}
              onChange={(e) => setStatusReason(e.target.value)}
              className={`${field} mt-3 w-full`}
              rows={3}
              placeholder="Reason for status change (required for suspension/cancellation)"
            />
            <DialogFooter className="mt-4">
              <button
                type="button"
                onClick={() => {
                  setStatusDialog(null);
                  setStatusReason("");
                }}
                className="rounded-xl px-4 py-2 text-sm text-soft"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={
                  !statusDialog ||
                  ((statusDialog.status === "suspended" || statusDialog.status === "cancelled") &&
                    statusReason.trim().length < 3)
                }
                className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-on-brand disabled:opacity-50"
              >
                Update Status
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete school dialog */}
      <Dialog open={!!deleteDialog} onOpenChange={(open) => !open && setDeleteDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-danger">Permanently Delete School</DialogTitle>
            <DialogDescription>
              This action CANNOT be undone. All data for {deleteDialog?.name} will be permanently deleted, including
              students, conduct logs, and staff accounts.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (deleteDialog && deleteConfirmation === deleteDialog.name) {
                run.mutate(() =>
                  deleteFn({ data: { id: deleteDialog.id, name_confirmation: deleteConfirmation } }).then(() => {
                    setDeleteDialog(null);
                    setDeleteConfirmation("");
                  })
                );
              }
            }}
          >
            <p className="text-sm text-soft">Type the school name "{deleteDialog?.name}" to confirm:</p>
            <input
              value={deleteConfirmation}
              onChange={(e) => setDeleteConfirmation(e.target.value)}
              className={`${field} mt-2 w-full`}
              placeholder="Type school name exactly"
            />
            <DialogFooter className="mt-4">
              <button
                type="button"
                onClick={() => {
                  setDeleteDialog(null);
                  setDeleteConfirmation("");
                }}
                className="rounded-xl px-4 py-2 text-sm text-soft"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!deleteDialog || deleteConfirmation !== deleteDialog.name}
                className="rounded-xl bg-danger px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Delete Permanently
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </DashboardShell>
  );
}
