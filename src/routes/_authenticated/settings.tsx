import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { DashboardShell } from "@/components/DashboardShell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, type AppRole, type PermissionKey } from "@/hooks/useAuth";
import { useSchoolSettings, DEFAULT_SETTINGS, type SchoolSettings } from "@/hooks/useSchoolSettings";
import { ACCENTS, useTheme, type AccentKey } from "@/hooks/useTheme";
import { fileToResizedDataUrl } from "@/lib/image";
import {
  listSchoolStaff,
  inviteSchoolStaff,
  createSchoolAccountWithoutEmail,
  updateStaffRole,
  setStaffActive,
  sendStaffPasswordReset,
  setStaffTemporaryPassword,
  SCHOOL_ROLES,
  type SchoolRole,
  type SchoolStaffMember,
} from "@/lib/school.functions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — SCDMS" },
      { name: "description", content: "Profile, appearance and system preferences for SCDMS." },
      { property: "og:title", content: "Settings — SCDMS" },
      { property: "og:description", content: "Profile, appearance and system preferences for SCDMS." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SettingsPage,
});

const panel = "rounded-3xl border border-glass-line bg-glass p-6 shadow-panel backdrop-blur-2xl";
const inp = "w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-ink outline-none";
const btn = "rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-on-brand shadow-brand-glow disabled:opacity-60";

function SettingsPage() {
  const { isSchoolDirector } = useAuth();
  return (
    <DashboardShell greeting="Settings" dateLine="Profile, appearance & system preferences">
      <Tabs defaultValue="profile">
        <TabsList className="mb-4 flex-wrap">
          <TabsTrigger value="profile">Profile & Avatar</TabsTrigger>
          <TabsTrigger value="appearance">Appearance</TabsTrigger>
          <TabsTrigger value="system">System Preferences</TabsTrigger>
          {isSchoolDirector && <TabsTrigger value="staff">Staff & Roles</TabsTrigger>}
        </TabsList>
        <TabsContent value="profile"><ProfileTab /></TabsContent>
        <TabsContent value="appearance"><AppearanceTab /></TabsContent>
        <TabsContent value="system"><SystemTab /></TabsContent>
        {isSchoolDirector && <TabsContent value="staff"><StaffTab /></TabsContent>}
      </Tabs>
    </DashboardShell>
  );
}

function useCanManageSchool() {
  const { role } = useAuth();
  return role === "school_leader" || role === "system_admin";
}

async function saveSchool(patch: Partial<SchoolSettings>, schoolId: string | null) {
  if (!schoolId) {
    // Fallback: update by id=1 if schoolId not available (pre-migration)
    const { error } = await (supabase.from("school_settings" as never) as any).update(patch).eq("id", 1);
    if (error) throw error;
    return;
  }

  // Update by school_id (multi-tenant mode)
  const { error } = await (supabase.from("school_settings" as never) as any)
    .update(patch)
    .eq("school_id" as never, schoolId);
  if (error) throw error;
}

function ProfileTab() {
  const { profile, refresh, schoolId } = useAuth();
  const { data: school } = useSchoolSettings();
  const qc = useQueryClient();
  const canManage = useCanManageSchool();
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setName(profile?.full_name ?? "");
    setTitle(profile?.job_title ?? "");
  }, [profile]);

  async function updateProfile(patch: Record<string, string | null>) {
    if (!profile) return;
    setBusy(true);
    const { error } = await supabase.from("profiles").update(patch as never).eq("id", profile.id);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Profile updated");
    await refresh();
  }

  async function onAvatar(file?: File) {
    if (!file) return;
    try { await updateProfile({ avatar_url: await fileToResizedDataUrl(file) }); }
    catch (e) { toast.error((e as Error).message); }
  }
  async function onLogo(file?: File) {
    if (!file) return;
    try {
      await saveSchool({ logo_url: await fileToResizedDataUrl(file) }, schoolId);
      toast.success("School logo updated");
      void qc.invalidateQueries({ queryKey: ["school-settings", schoolId] });
    } catch (e) { toast.error((e as Error).message); }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className={panel}>
        <h3 className="font-display text-lg font-bold text-ink">Your profile</h3>
        <div className="mt-4 flex items-center gap-4">
          {profile?.avatar_url ? (
            <img src={profile.avatar_url} alt="Your avatar" className="h-20 w-20 rounded-2xl object-cover ring-1 ring-hairline" />
          ) : (
            <div className="grid h-20 w-20 place-items-center rounded-2xl bg-glass-bright text-2xl font-bold text-ink ring-1 ring-hairline">
              {(profile?.full_name || "?")[0]}
            </div>
          )}
          <div className="space-y-2">
            <label className={`${btn} inline-block cursor-pointer`}>
              Upload picture
              <input type="file" accept="image/*" className="hidden" onChange={(e) => onAvatar(e.target.files?.[0])} />
            </label>
            {profile?.avatar_url && (
              <button className="block text-xs text-danger" onClick={() => updateProfile({ avatar_url: null })}>Remove picture</button>
            )}
          </div>
        </div>
        <form
          className="mt-5 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) {
              toast.error("Full name is required.");
              return;
            }
            void updateProfile({ full_name: name.trim(), job_title: title.trim() || null });
          }}
        >
          <label className="block text-xs font-semibold text-soft">Full name<input className={`${inp} mt-1`} value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="block text-xs font-semibold text-soft">Job title<input className={`${inp} mt-1`} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          <p className="text-xs text-faint">Email: {profile?.email ?? "—"}</p>
          <button className={btn} disabled={busy}>Save profile</button>
        </form>
      </div>
      <div className={panel}>
        <h3 className="font-display text-lg font-bold text-ink">School logo</h3>
        <div className="mt-4 flex items-center gap-4">
          {school?.logo_url ? (
            <img src={school.logo_url} alt="School logo" className="h-20 w-20 rounded-2xl object-cover ring-1 ring-hairline" />
          ) : (
            <div className="grid h-20 w-20 place-items-center rounded-2xl bg-linear-to-br from-brand to-accent font-display text-2xl font-bold text-on-brand">S</div>
          )}
          {canManage ? (
            <label className={`${btn} cursor-pointer`}>
              Upload logo
              <input type="file" accept="image/*" className="hidden" onChange={(e) => onLogo(e.target.files?.[0])} />
            </label>
          ) : (
            <p className="text-sm text-soft">Only School Leaders and System Administrators can change the logo.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function AppearanceTab() {
  const { mode, setMode, accent, setAccent } = useTheme();
  return (
    <div className={panel}>
      <h3 className="font-display text-lg font-bold text-ink">Theme</h3>
      <div className="mt-4 flex gap-2">
        {(["light", "dark"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-xl px-4 py-2 text-sm font-semibold ring-1 ${mode === m ? "bg-brand text-on-brand ring-brand" : "text-body ring-hairline"}`}
          >
            {m === "light" ? "Light" : "Dark"}
          </button>
        ))}
      </div>
      <h3 className="mt-6 font-display text-lg font-bold text-ink">Accent colour</h3>
      <div className="mt-4 flex flex-wrap gap-3">
        {(Object.keys(ACCENTS) as AccentKey[]).map((k) => (
          <button
            key={k}
            onClick={() => setAccent(k)}
            className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm ring-1 ${accent === k ? "ring-2 ring-brand text-ink" : "ring-hairline text-body"}`}
          >
            <span className="h-5 w-5 rounded-full" style={{ background: `linear-gradient(135deg, ${ACCENTS[k].brand}, ${ACCENTS[k].accent})` }} />
            {ACCENTS[k].label}
          </button>
        ))}
      </div>
      <p className="mt-4 text-xs text-faint">Theme choices are saved on this device.</p>
    </div>
  );
}

function SystemTab() {
  const { data } = useSchoolSettings();
  const { schoolId } = useAuth();
  const qc = useQueryClient();
  const canManage = useCanManageSchool();
  const [f, setF] = useState<SchoolSettings>(DEFAULT_SETTINGS);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setF(data); }, [data]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{4}\/\d{4}$/.test(f.academic_year)) return setErr("Academic year must look like 2026/2027.");
    const [a, b] = f.academic_year.split("/").map(Number);
    if (b !== a! + 1) return setErr("The second year must follow the first (e.g. 2026/2027).");
    if (!f.school_name.trim()) return setErr("School name is required.");
    if (f.critical_threshold < 0 || f.critical_threshold > 40) return setErr("Critical threshold must be between 0 and 40.");
    if (f.warning_threshold <= f.critical_threshold || f.warning_threshold > 40)
      return setErr("Warning threshold must be above the critical threshold and at most 40.");
    setErr(null);
    setBusy(true);
    try {
      await saveSchool({
        school_name: f.school_name.trim(),
        academic_year: f.academic_year,
        critical_threshold: f.critical_threshold,
        warning_threshold: f.warning_threshold,
        notify_on_threshold: f.notify_on_threshold,
      }, schoolId);
      toast.success("System preferences saved");
      void qc.invalidateQueries({ queryKey: ["school-settings", schoolId] });
    } catch (e) { toast.error((e as Error).message); }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className={`${panel} max-w-xl space-y-4`}>
      {!canManage && <p className="text-sm text-soft">View only — School Leaders and System Administrators can change these.</p>}
      <fieldset disabled={!canManage} className="space-y-4">
        <label className="block text-xs font-semibold text-soft">School name<input className={`${inp} mt-1`} value={f.school_name} onChange={(e) => setF({ ...f, school_name: e.target.value })} /></label>
        <label className="block text-xs font-semibold text-soft">Academic year<input className={`${inp} mt-1`} placeholder="2026/2027" value={f.academic_year} onChange={(e) => setF({ ...f, academic_year: e.target.value })} /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs font-semibold text-soft">Critical alert at or below<input type="number" className={`${inp} mt-1`} value={f.critical_threshold} onChange={(e) => setF({ ...f, critical_threshold: Number(e.target.value) })} /></label>
          <label className="block text-xs font-semibold text-soft">Warning at or below<input type="number" className={`${inp} mt-1`} value={f.warning_threshold} onChange={(e) => setF({ ...f, warning_threshold: Number(e.target.value) })} /></label>
        </div>
        <label className="flex items-center gap-2 text-sm text-body">
          <input type="checkbox" checked={f.notify_on_threshold} onChange={(e) => setF({ ...f, notify_on_threshold: e.target.checked })} />
          Notify when a student's balance crosses a threshold
        </label>
        {err && <p className="text-sm text-danger">{err}</p>}
        <button className={btn} disabled={busy}>Save preferences</button>
      </fieldset>
    </form>
  );
}

const ROLE_LABELS: Record<SchoolRole, string> = {
  school_director: "School Director",
  master_of_discipline: "Master of Discipline",
  matron: "Matron",
  patron: "Patron",
};

const PERMISSION_LABELS: Record<PermissionKey, string> = {
  delete_students: "Delete students",
  manage_offences: "Manage offence catalogue",
  view_audit_logs: "View audit logs",
  view_reports: "View reports",
  message_parents: "Message parents",
  send_photos: "Send evidence photos",
};

const PERMISSION_ROLES: SchoolRole[] = ["master_of_discipline", "matron", "patron"];

function StaffTab() {
  const { schoolId, roleLabel } = useAuth();
  const qc = useQueryClient();
  const { data: settings } = useSchoolSettings();

  // Staff list
  const { data: staff, isLoading } = useQuery({
    queryKey: ["school-staff", schoolId],
    queryFn: async () => await listSchoolStaff(),
    enabled: !!schoolId,
  });

  // Mutations
  const inviteMutation = useMutation({
    mutationFn: inviteSchoolStaff,
    onSuccess: () => {
      toast.success("Staff member invited successfully");
      void qc.invalidateQueries({ queryKey: ["school-staff", schoolId] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const createAccountMutation = useMutation({
    mutationFn: createSchoolAccountWithoutEmail,
    onSuccess: (data) => {
      setTempPasswordDialog({ password: data.password, userName: inviteName || inviteEmail });
      void qc.invalidateQueries({ queryKey: ["school-staff", schoolId] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: updateStaffRole,
    onSuccess: () => {
      toast.success("Role updated successfully");
      void qc.invalidateQueries({ queryKey: ["school-staff", schoolId] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: setStaffActive,
    onSuccess: () => {
      toast.success("Staff status updated");
      void qc.invalidateQueries({ queryKey: ["school-staff", schoolId] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // Form state
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<SchoolRole>("matron");

  // Password reset dialogs
  const [resetPasswordDialog, setResetPasswordDialog] = useState<{ id: string; email: string | null; name: string } | null>(null);
  const [tempPasswordDialog, setTempPasswordDialog] = useState<{ password: string; userName: string } | null>(null);

  // Role titles state
  const [roleTitles, setRoleTitles] = useState<Record<string, string>>({});
  useEffect(() => {
    if (settings?.role_titles) {
      setRoleTitles(settings.role_titles);
    }
  }, [settings]);

  // Permissions state
  const [permissions, setPermissions] = useState<Record<string, Record<PermissionKey, boolean>>>({});
  useEffect(() => {
    if (settings?.permissions) {
      setPermissions(settings.permissions);
    } else {
      // Default permissions
      setPermissions({
        master_of_discipline: {
          delete_students: true,
          manage_offences: true,
          view_audit_logs: true,
          view_reports: true,
          message_parents: true,
          send_photos: true,
        },
        matron: {
          delete_students: false,
          manage_offences: false,
          view_audit_logs: false,
          view_reports: true,
          message_parents: true,
          send_photos: true,
        },
        patron: {
          delete_students: false,
          manage_offences: false,
          view_audit_logs: false,
          view_reports: true,
          message_parents: true,
          send_photos: true,
        },
      });
    }
  }, [settings]);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail || !inviteName) {
      toast.error("Email and full name are required");
      return;
    }
    inviteMutation.mutate({ data: { email: inviteEmail, full_name: inviteName, role: inviteRole } } as never);
    setInviteEmail("");
    setInviteName("");
    setInviteRole("matron");
  }

  async function saveRoleTitles() {
    try {
      await saveSchool({ role_titles: roleTitles }, schoolId);
      toast.success("Role titles updated");
      void qc.invalidateQueries({ queryKey: ["school-settings", schoolId] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function savePermissions() {
    try {
      await saveSchool({ permissions }, schoolId);
      toast.success("Permissions updated");
      void qc.invalidateQueries({ queryKey: ["school-settings", schoolId] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      {/* Staff List */}
      <div className={panel}>
        <h3 className="font-display text-lg font-bold text-ink">Staff Members</h3>
        {isLoading ? (
          <p className="mt-4 text-sm text-soft">Loading staff...</p>
        ) : !staff || staff.length === 0 ? (
          <p className="mt-4 text-sm text-soft">No staff members yet. Invite someone below.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {staff.map((member) => (
              <div
                key={member.id}
                className="flex flex-col gap-3 rounded-xl border border-glass-line bg-glass-bright p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink">{member.full_name}</p>
                  <p className="text-xs text-soft">{member.email}</p>
                  <p className="text-xs text-faint">
                    {member.roles.map((r) => roleLabel(r as AppRole)).join(", ")}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={member.roles[0] ?? "matron"}
                    onChange={(e) =>
                      updateRoleMutation.mutate({ data: { user_id: member.id, role: e.target.value as SchoolRole } } as never)
                    }
                    className="rounded-lg border border-input bg-background px-2 py-1 text-xs text-ink"
                    disabled={updateRoleMutation.isPending}
                  >
                    {SCHOOL_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {roleLabel(role)}
                      </option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={member.is_active}
                      onChange={(e) =>
                        toggleActiveMutation.mutate({ data: { user_id: member.id, active: e.target.checked } } as never)
                      }
                      disabled={toggleActiveMutation.isPending}
                    />
                    <span className={member.is_active ? "text-ok" : "text-faint"}>
                      {member.is_active ? "Active" : "Inactive"}
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setResetPasswordDialog({ id: member.id, email: member.email, name: member.full_name })}
                    className="rounded-lg bg-warn px-2 py-1 text-xs font-semibold text-white"
                  >
                    Reset password
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Invite Staff */}
      <div className={panel}>
        <h3 className="font-display text-lg font-bold text-ink">Add Staff Member</h3>
        <form onSubmit={(e) => e.preventDefault()} className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-semibold text-soft">
              Email
              <input
                type="email"
                className={`${inp} mt-1`}
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="staff@example.com"
              />
            </label>
            <label className="block text-xs font-semibold text-soft">
              Full name
              <input
                type="text"
                className={`${inp} mt-1`}
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                placeholder="Full Name"
              />
            </label>
          </div>
          <label className="block text-xs font-semibold text-soft">
            Role
            <select
              className={`${inp} mt-1`}
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as SchoolRole)}
            >
              {SCHOOL_ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleInvite}
              className={btn}
              disabled={inviteMutation.isPending}
            >
              {inviteMutation.isPending ? "Sending invitation..." : "Send invitation"}
            </button>
            <button
              type="button"
              onClick={() => {
                if (!inviteEmail || !inviteName) {
                  toast.error("Email and full name are required");
                  return;
                }
                createAccountMutation.mutate({ data: { email: inviteEmail, full_name: inviteName, role: inviteRole } } as never);
                setInviteEmail("");
                setInviteName("");
                setInviteRole("matron");
              }}
              className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-on-brand shadow-brand-glow disabled:opacity-60"
              disabled={createAccountMutation.isPending}
            >
              {createAccountMutation.isPending ? "Creating account..." : "Create account (no email)"}
            </button>
          </div>
        </form>
      </div>

      {/* Role Titles */}
      <div className={panel}>
        <h3 className="font-display text-lg font-bold text-ink">Custom Role Titles</h3>
        <p className="mt-2 text-xs text-soft">
          Customize how role names appear throughout the system. Leave blank to use defaults.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {SCHOOL_ROLES.map((role) => (
            <label key={role} className="block text-xs font-semibold text-soft">
              {ROLE_LABELS[role]}
              <input
                type="text"
                className={`${inp} mt-1`}
                value={roleTitles[role] ?? ""}
                onChange={(e) => setRoleTitles({ ...roleTitles, [role]: e.target.value })}
                placeholder={ROLE_LABELS[role]}
              />
            </label>
          ))}
        </div>
        <button onClick={saveRoleTitles} className={`${btn} mt-4`}>
          Save role titles
        </button>
      </div>

      {/* Permissions */}
      <div className={panel}>
        <h3 className="font-display text-lg font-bold text-ink">Role Permissions</h3>
        <p className="mt-2 text-xs text-soft">
          School Directors always have all permissions. Configure permissions for other roles below.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr className="border-b border-glass-line">
                <th className="pb-2 pr-4 text-left text-xs font-semibold text-soft">Permission</th>
                {PERMISSION_ROLES.map((role) => (
                  <th key={role} className="pb-2 px-2 text-center text-xs font-semibold text-soft">
                    {roleLabel(role)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(Object.keys(PERMISSION_LABELS) as PermissionKey[]).map((permission) => (
                <tr key={permission} className="border-b border-glass-line/50">
                  <td className="py-3 pr-4 text-xs text-ink">{PERMISSION_LABELS[permission]}</td>
                  {PERMISSION_ROLES.map((role) => (
                    <td key={role} className="py-3 px-2 text-center">
                      <input
                        type="checkbox"
                        checked={permissions[role]?.[permission] ?? false}
                        onChange={(e) => {
                          const newPerms = {
                            ...permissions,
                            [role]: {
                              ...((permissions[role] ?? {}) as Record<PermissionKey, boolean>),
                              [permission]: e.target.checked,
                            } as Record<PermissionKey, boolean>,
                          };
                          setPermissions(newPerms);
                        }}
                        className="cursor-pointer"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button onClick={savePermissions} className={`${btn} mt-4`}>
          Save permissions
        </button>
      </div>

      {/* Password reset options dialog */}
      <Dialog open={!!resetPasswordDialog} onOpenChange={(open) => !open && setResetPasswordDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Password: {resetPasswordDialog?.name}</DialogTitle>
            <DialogDescription>
              Choose how to reset the password for this staff member.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <button
              onClick={async () => {
                if (resetPasswordDialog?.email) {
                  try {
                    await sendStaffPasswordReset({ data: { user_email: resetPasswordDialog.email } } as never);
                    toast.success("Password reset email sent");
                    setResetPasswordDialog(null);
                  } catch (err) {
                    toast.error((err as Error).message);
                  }
                }
              }}
              className="w-full rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-on-brand"
            >
              Send reset email
            </button>
            <button
              onClick={async () => {
                if (resetPasswordDialog) {
                  try {
                    const result = await setStaffTemporaryPassword({ data: { user_id: resetPasswordDialog.id } } as never);
                    setResetPasswordDialog(null);
                    setTempPasswordDialog({ password: result.password, userName: resetPasswordDialog.name });
                  } catch (err) {
                    toast.error((err as Error).message);
                  }
                }
              }}
              className="w-full rounded-xl bg-warn px-4 py-3 text-sm font-semibold text-white"
            >
              Set temporary password
            </button>
          </div>
          <DialogFooter className="mt-4">
            <button
              type="button"
              onClick={() => setResetPasswordDialog(null)}
              className="rounded-xl px-4 py-2 text-sm text-soft"
            >
              Cancel
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Temporary password dialog */}
      <Dialog open={!!tempPasswordDialog} onOpenChange={(open) => !open && setTempPasswordDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Temporary Password Set</DialogTitle>
            <DialogDescription>
              A temporary password has been set for {tempPasswordDialog?.userName}. Copy it now and share it securely
              with the user. This password will not be shown again.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-2xl bg-glass-bright p-4">
            <div className="flex items-center justify-between">
              <code className="font-mono text-lg font-bold text-ink">{tempPasswordDialog?.password}</code>
              <button
                onClick={() => {
                  if (tempPasswordDialog) {
                    void navigator.clipboard.writeText(tempPasswordDialog.password);
                    toast.success("Password copied to clipboard");
                  }
                }}
                className="rounded-xl bg-brand px-3 py-1.5 text-xs font-semibold text-on-brand"
              >
                Copy
              </button>
            </div>
          </div>
          <p className="text-sm text-soft">
            The user must change this password on their first sign-in.
          </p>
          <DialogFooter className="mt-4">
            <button
              type="button"
              onClick={() => setTempPasswordDialog(null)}
              className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-on-brand"
            >
              Done
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
