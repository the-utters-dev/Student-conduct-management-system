import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { DashboardShell } from "@/components/DashboardShell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useSchoolSettings, DEFAULT_SETTINGS, type SchoolSettings } from "@/hooks/useSchoolSettings";
import { ACCENTS, useTheme, type AccentKey } from "@/hooks/useTheme";
import { fileToResizedDataUrl } from "@/lib/image";

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
  return (
    <DashboardShell greeting="Settings" dateLine="Profile, appearance & system preferences">
      <Tabs defaultValue="profile">
        <TabsList className="mb-4">
          <TabsTrigger value="profile">Profile & Avatar</TabsTrigger>
          <TabsTrigger value="appearance">Appearance</TabsTrigger>
          <TabsTrigger value="system">System Preferences</TabsTrigger>
        </TabsList>
        <TabsContent value="profile"><ProfileTab /></TabsContent>
        <TabsContent value="appearance"><AppearanceTab /></TabsContent>
        <TabsContent value="system"><SystemTab /></TabsContent>
      </Tabs>
    </DashboardShell>
  );
}

function useCanManageSchool() {
  const { role } = useAuth();
  return role === "school_leader" || role === "system_admin";
}

async function saveSchool(patch: Partial<SchoolSettings>) {
  const { error } = await (supabase.from("school_settings" as never) as any).update(patch).eq("id", 1);
  if (error) throw error;
}

function ProfileTab() {
  const { profile, refresh } = useAuth();
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
    if (error) return toast.error(error.message);
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
      await saveSchool({ logo_url: await fileToResizedDataUrl(file) });
      toast.success("School logo updated");
      void qc.invalidateQueries({ queryKey: ["school-settings"] });
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
            if (!name.trim()) return toast.error("Full name is required.");
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
      });
      toast.success("System preferences saved");
      void qc.invalidateQueries({ queryKey: ["school-settings"] });
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
