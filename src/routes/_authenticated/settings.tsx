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
import { fileToResizedDataUrl, convertToJpeg } from "@/lib/image";
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
  const { isSchoolDirector, can } = useAuth();
  const showCategories = isSchoolDirector || can("manage_offences");
  const showOffences = isSchoolDirector || can("manage_offences");
  const showCalendar = isSchoolDirector || can("manage_terms");
  return (
    <DashboardShell greeting="Settings" dateLine="Profile, appearance & system preferences">
      <Tabs defaultValue="profile">
        <TabsList className="mb-4 flex-wrap">
          <TabsTrigger value="profile">Profile & Avatar</TabsTrigger>
          <TabsTrigger value="appearance">Appearance</TabsTrigger>
          <TabsTrigger value="system">System Preferences</TabsTrigger>
          {showCalendar && <TabsTrigger value="calendar">Academic Calendar</TabsTrigger>}
          {showOffences && <TabsTrigger value="offences">Offences</TabsTrigger>}
          {showCategories && <TabsTrigger value="categories">Good Deed Categories</TabsTrigger>}
          {isSchoolDirector && <TabsTrigger value="staff">Staff & Roles</TabsTrigger>}
        </TabsList>
        <TabsContent value="profile"><ProfileTab /></TabsContent>
        <TabsContent value="appearance"><AppearanceTab /></TabsContent>
        <TabsContent value="system"><SystemTab /></TabsContent>
        {showCalendar && <TabsContent value="calendar"><CalendarTab /></TabsContent>}
        {showOffences && <TabsContent value="offences"><OffencesTab /></TabsContent>}
        {showCategories && <TabsContent value="categories"><CategoriesTab /></TabsContent>}
        {isSchoolDirector && <TabsContent value="staff"><StaffTab /></TabsContent>}
      </Tabs>
    </DashboardShell>
  );
}

function useCanManageSchool() {
  const { isSchoolDirector, isPlatformAdmin } = useAuth();
  return isSchoolDirector || isPlatformAdmin;
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
    if (!file || !schoolId) return;
    setBusy(true);
    try {
      // Convert to JPEG (max 512px for logos)
      const jpegBlob = await convertToJpeg(file, 512, 0.9);
      const logoPath = `${schoolId}/logo.jpg`;

      // Upload to public bucket
      const { error: uploadError } = await supabase.storage
        .from("school-logos")
        .upload(logoPath, jpegBlob, {
          contentType: "image/jpeg",
          upsert: true, // Replace existing logo
        });

      if (uploadError) throw new Error(uploadError.message);

      // Get public URL
      const { data } = supabase.storage.from("school-logos").getPublicUrl(logoPath);
      const publicUrl = data.publicUrl;

      // Save to school_settings
      await saveSchool({ logo_url: publicUrl }, schoolId);
      toast.success("School logo updated");
      void qc.invalidateQueries({ queryKey: ["school-settings", schoolId] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function removeLogo() {
    if (!schoolId) return;
    setBusy(true);
    try {
      // Remove from storage
      await supabase.storage.from("school-logos").remove([`${schoolId}/logo.jpg`]);
      // Update settings
      await saveSchool({ logo_url: null }, schoolId);
      toast.success("Logo removed");
      void qc.invalidateQueries({ queryKey: ["school-settings", schoolId] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
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
            <div className="space-y-2">
              <label className={`${btn} inline-block cursor-pointer`}>
                Upload logo
                <input type="file" accept="image/*" className="hidden" onChange={(e) => onLogo(e.target.files?.[0])} disabled={busy} />
              </label>
              {school?.logo_url && (
                <button className="block text-xs text-danger" onClick={removeLogo} disabled={busy}>
                  Remove logo
                </button>
              )}
            </div>
          ) : (
            <p className="text-sm text-soft">Only the School Director can change the logo.</p>
          )}
        </div>
        <p className="mt-4 text-xs text-faint">The logo appears in the sidebar, reports, and certificates.</p>
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
    const maxMarks = f.max_conduct_marks ?? 40;
    if (maxMarks < 10 || maxMarks > 200) return setErr("Maximum conduct marks must be between 10 and 200.");
    if (f.critical_threshold < 0 || f.critical_threshold > maxMarks) return setErr(`Critical threshold must be between 0 and ${maxMarks}.`);
    if (f.warning_threshold <= f.critical_threshold || f.warning_threshold > maxMarks)
      return setErr(`Warning threshold must be above the critical threshold and at most ${maxMarks}.`);
    setErr(null);
    setBusy(true);
    try {
      await saveSchool({
        school_name: f.school_name.trim(),
        academic_year: f.academic_year,
        max_conduct_marks: maxMarks,
        critical_threshold: f.critical_threshold,
        warning_threshold: f.warning_threshold,
        notify_on_threshold: f.notify_on_threshold,
        good_deed_reward_type: f.good_deed_reward_type ?? "recognition",
      }, schoolId);
      toast.success("System preferences saved");
      void qc.invalidateQueries({ queryKey: ["school-settings", schoolId] });
    } catch (e) { toast.error((e as Error).message); }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className={`${panel} max-w-xl space-y-4`}>
      {!canManage && <p className="text-sm text-soft">View only — Only the School Director can change these.</p>}
      <fieldset disabled={!canManage} className="space-y-4">
        <label className="block text-xs font-semibold text-soft">School name<input className={`${inp} mt-1`} value={f.school_name} onChange={(e) => setF({ ...f, school_name: e.target.value })} /></label>
        <label className="block text-xs font-semibold text-soft">Academic year<input className={`${inp} mt-1`} placeholder="2026/2027" value={f.academic_year} onChange={(e) => setF({ ...f, academic_year: e.target.value })} /></label>
        <label className="block text-xs font-semibold text-soft">
          Maximum conduct marks per term
          <input
            type="number"
            className={`${inp} mt-1`}
            value={f.max_conduct_marks ?? 40}
            onChange={(e) => setF({ ...f, max_conduct_marks: Number(e.target.value) })}
            min={10}
            max={200}
          />
          <p className="mt-1 text-xs text-faint">Students start each term with this balance (10–200, default 40).</p>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs font-semibold text-soft">Critical alert at or below<input type="number" className={`${inp} mt-1`} value={f.critical_threshold} onChange={(e) => setF({ ...f, critical_threshold: Number(e.target.value) })} /></label>
          <label className="block text-xs font-semibold text-soft">Warning at or below<input type="number" className={`${inp} mt-1`} value={f.warning_threshold} onChange={(e) => setF({ ...f, warning_threshold: Number(e.target.value) })} /></label>
        </div>
        <label className="flex items-center gap-2 text-sm text-body">
          <input type="checkbox" checked={f.notify_on_threshold} onChange={(e) => setF({ ...f, notify_on_threshold: e.target.checked })} />
          Notify when a student's balance crosses a threshold
        </label>
        <label className="block text-xs font-semibold text-soft">
          Good deed reward system
          <select
            className={`${inp} mt-1`}
            value={f.good_deed_reward_type ?? "recognition"}
            onChange={(e) => setF({ ...f, good_deed_reward_type: e.target.value as "recognition" | "merit_points" })}
          >
            <option value="recognition">Recognition only</option>
            <option value="merit_points">Recognition + merit points</option>
          </select>
          <p className="mt-1 text-xs text-faint">
            {f.good_deed_reward_type === "merit_points"
              ? "Students earn merit points for good deeds. Conduct marks are never affected."
              : "Good deeds are recorded for recognition only. No marks or points are given."}
          </p>
        </label>
        {err && <p className="text-sm text-danger">{err}</p>}
        <button className={btn} disabled={busy}>Save preferences</button>
      </fieldset>
    </form>
  );
}

interface AcademicYear {
  id: string;
  school_id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
}

interface AcademicTerm {
  id: string;
  academic_year_id: string;
  school_id: string;
  name: string;
  start_date: string;
  end_date: string;
  starting_marks: number;
  is_active: boolean;
}

function CalendarTab() {
  const { schoolId } = useAuth();
  const { data: settings } = useSchoolSettings();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [editingYear, setEditingYear] = useState<string | null>(null);
  const [editingTerm, setEditingTerm] = useState<string | null>(null);
  const [newYear, setNewYear] = useState({ name: "", start_date: "", end_date: "" });
  const [newTerm, setNewTerm] = useState({ academic_year_id: "", name: "", start_date: "", end_date: "", starting_marks: settings?.max_conduct_marks ?? 40 });

  // Fetch academic years
  const { data: years, isLoading: yearsLoading } = useQuery({
    queryKey: ["academic-years", schoolId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("academic_years" as never) as any)
        .select("*")
        .eq("school_id", schoolId)
        .order("start_date", { ascending: false });
      if (error) throw error;
      return data as AcademicYear[];
    },
    enabled: !!schoolId,
  });

  // Fetch academic terms
  const { data: terms, isLoading: termsLoading } = useQuery({
    queryKey: ["academic-terms", schoolId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("academic_terms" as never) as any)
        .select("*")
        .eq("school_id", schoolId)
        .order("start_date", { ascending: false });
      if (error) throw error;
      return data as AcademicTerm[];
    },
    enabled: !!schoolId,
  });

  const activeTerm = terms?.find(t => t.is_active);
  const today = new Date().toISOString().split("T")[0] as string;
  const showBanner = activeTerm && (today < activeTerm.start_date || today > activeTerm.end_date);

  async function createYear() {
    if (!newYear.name.trim() || !newYear.start_date || !newYear.end_date) {
      toast.error("All fields are required");
      return;
    }
    if (newYear.end_date <= newYear.start_date) {
      toast.error("End date must be after start date");
      return;
    }
    setBusy(true);
    try {
      const { error } = await (supabase.from("academic_years" as never) as any).insert({
        school_id: schoolId,
        name: newYear.name.trim(),
        start_date: newYear.start_date,
        end_date: newYear.end_date,
        is_current: false,
      });
      if (error) throw error;
      toast.success("Academic year created");
      setNewYear({ name: "", start_date: "", end_date: "" });
      void qc.invalidateQueries({ queryKey: ["academic-years", schoolId] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function createTerm() {
    if (!newTerm.academic_year_id || !newTerm.name.trim() || !newTerm.start_date || !newTerm.end_date) {
      toast.error("All fields are required");
      return;
    }
    if (newTerm.end_date <= newTerm.start_date) {
      toast.error("End date must be after start date");
      return;
    }
    setBusy(true);
    try {
      const { error } = await (supabase.from("academic_terms" as never) as any).insert({
        school_id: schoolId,
        academic_year_id: newTerm.academic_year_id,
        name: newTerm.name.trim(),
        start_date: newTerm.start_date,
        end_date: newTerm.end_date,
        starting_marks: newTerm.starting_marks,
        is_active: false,
      });
      if (error) throw error;
      toast.success("Term created");
      setNewTerm({ academic_year_id: "", name: "", start_date: "", end_date: "", starting_marks: settings?.max_conduct_marks ?? 40 });
      void qc.invalidateQueries({ queryKey: ["academic-terms", schoolId] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function activateTerm(termId: string) {
    setBusy(true);
    try {
      // First deactivate all terms
      await (supabase.from("academic_terms" as never) as any)
        .update({ is_active: false })
        .eq("school_id", schoolId);

      // Then activate the selected term
      const { error } = await (supabase.from("academic_terms" as never) as any)
        .update({ is_active: true })
        .eq("id", termId);

      if (error) throw error;
      toast.success("Term activated");
      void qc.invalidateQueries({ queryKey: ["academic-terms", schoolId] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Banner for term outside dates */}
      {showBanner && (
        <div className="rounded-3xl border border-warn bg-warn/10 p-4">
          <p className="text-sm font-semibold text-warn">
            {activeTerm.name} ended on {new Date(activeTerm.end_date).toLocaleDateString("en-GB")}.
            {" "}Activate the next term below.
          </p>
        </div>
      )}

      {/* Academic Years */}
      <div className={panel}>
        <h3 className="font-display text-lg font-bold text-ink">Academic Years</h3>
        {yearsLoading ? (
          <p className="mt-4 text-sm text-soft">Loading academic years...</p>
        ) : !years || years.length === 0 ? (
          <p className="mt-4 text-sm text-soft">No academic years yet. Create one below.</p>
        ) : (
          <div className="mt-4 space-y-2">
            {years.map((year) => (
              <div
                key={year.id}
                className="flex flex-col gap-3 rounded-xl border border-glass-line bg-glass-bright p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex-1">
                  <p className="font-semibold text-ink">{year.name}</p>
                  <p className="text-xs text-soft">
                    {new Date(year.start_date).toLocaleDateString("en-GB")} – {new Date(year.end_date).toLocaleDateString("en-GB")}
                  </p>
                </div>
                {year.is_current && (
                  <span className="rounded-lg bg-ok/15 px-2 py-1 text-xs font-semibold text-ok">Current</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Academic Year */}
      <div className={panel}>
        <h3 className="font-display text-lg font-bold text-ink">Add Academic Year</h3>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void createYear();
          }}
          className="mt-4 space-y-3"
        >
          <label className="block text-xs font-semibold text-soft">
            Year name (e.g., 2026/2027)
            <input
              type="text"
              className={`${inp} mt-1`}
              value={newYear.name}
              onChange={(e) => setNewYear({ ...newYear, name: e.target.value })}
              placeholder="2026/2027"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-semibold text-soft">
              Start date
              <input
                type="date"
                className={`${inp} mt-1`}
                value={newYear.start_date}
                onChange={(e) => setNewYear({ ...newYear, start_date: e.target.value })}
              />
            </label>
            <label className="block text-xs font-semibold text-soft">
              End date
              <input
                type="date"
                className={`${inp} mt-1`}
                value={newYear.end_date}
                onChange={(e) => setNewYear({ ...newYear, end_date: e.target.value })}
              />
            </label>
          </div>
          <button className={btn} disabled={busy}>
            Create academic year
          </button>
        </form>
      </div>

      {/* Academic Terms */}
      <div className={panel}>
        <h3 className="font-display text-lg font-bold text-ink">Terms</h3>
        {termsLoading ? (
          <p className="mt-4 text-sm text-soft">Loading terms...</p>
        ) : !terms || terms.length === 0 ? (
          <p className="mt-4 text-sm text-soft">No terms yet. Create one below.</p>
        ) : (
          <div className="mt-4 space-y-2">
            {terms.map((term) => {
              const year = years?.find(y => y.id === term.academic_year_id);
              return (
                <div
                  key={term.id}
                  className="flex flex-col gap-3 rounded-xl border border-glass-line bg-glass-bright p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex-1">
                    <p className="font-semibold text-ink">{term.name} {year && `(${year.name})`}</p>
                    <p className="text-xs text-soft">
                      {new Date(term.start_date).toLocaleDateString("en-GB")} – {new Date(term.end_date).toLocaleDateString("en-GB")}
                      {" "}· Starting marks: {term.starting_marks}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {term.is_active ? (
                      <span className="rounded-lg bg-ok/15 px-2 py-1 text-xs font-semibold text-ok">Active</span>
                    ) : (
                      <button
                        onClick={() => activateTerm(term.id)}
                        className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-on-brand"
                        disabled={busy}
                      >
                        Activate
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create Term */}
      <div className={panel}>
        <h3 className="font-display text-lg font-bold text-ink">Add Term</h3>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void createTerm();
          }}
          className="mt-4 space-y-3"
        >
          <label className="block text-xs font-semibold text-soft">
            Academic year
            <select
              className={`${inp} mt-1`}
              value={newTerm.academic_year_id}
              onChange={(e) => setNewTerm({ ...newTerm, academic_year_id: e.target.value })}
            >
              <option value="">Select academic year</option>
              {years?.map((year) => (
                <option key={year.id} value={year.id}>
                  {year.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-semibold text-soft">
            Term name (e.g., Term 1)
            <input
              type="text"
              className={`${inp} mt-1`}
              value={newTerm.name}
              onChange={(e) => setNewTerm({ ...newTerm, name: e.target.value })}
              placeholder="Term 1"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-semibold text-soft">
              Start date
              <input
                type="date"
                className={`${inp} mt-1`}
                value={newTerm.start_date}
                onChange={(e) => setNewTerm({ ...newTerm, start_date: e.target.value })}
              />
            </label>
            <label className="block text-xs font-semibold text-soft">
              End date
              <input
                type="date"
                className={`${inp} mt-1`}
                value={newTerm.end_date}
                onChange={(e) => setNewTerm({ ...newTerm, end_date: e.target.value })}
              />
            </label>
          </div>
          <label className="block text-xs font-semibold text-soft">
            Starting marks
            <input
              type="number"
              className={`${inp} mt-1`}
              value={newTerm.starting_marks}
              onChange={(e) => setNewTerm({ ...newTerm, starting_marks: Number(e.target.value) })}
              min={10}
              max={200}
            />
            <p className="mt-1 text-xs text-faint">Students will start this term with this balance (default: {settings?.max_conduct_marks ?? 40}).</p>
          </label>
          <button className={btn} disabled={busy}>
            Create term
          </button>
        </form>
      </div>
    </div>
  );
}

interface GoodDeedCategory {
  id: string;
  name: string;
  default_merit_points: number;
  is_active: boolean;
}

interface OffenceCategory {
  id: string;
  school_id: string;
  name: string;
  is_active: boolean;
  sort_order: number;
}

interface Offence {
  id: string;
  school_id: string;
  code: string;
  title: string;
  category: string | null;
  category_id: string | null;
  severity: string;
  marks_deducted: number;
  description: string | null;
  is_active: boolean;
}

function OffencesTab() {
  const { schoolId } = useAuth();
  const qc = useQueryClient();
  const [view, setView] = useState<"categories" | "offences">("categories");

  // Categories state
  const [newCategoryName, setNewCategoryName] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editCategoryName, setEditCategoryName] = useState("");

  // Offences state
  const [newOffence, setNewOffence] = useState({
    code: "",
    title: "",
    category_id: "",
    severity: "minor",
    marks: 2,
    description: "",
  });
  const [editingOffenceId, setEditingOffenceId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Fetch categories
  const { data: categories } = useQuery({
    queryKey: ["offence-categories", schoolId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("offence_categories" as never) as any)
        .select("*")
        .eq("school_id", schoolId)
        .order("sort_order");
      if (error) throw error;
      return data as OffenceCategory[];
    },
    enabled: !!schoolId,
  });

  // Fetch offences
  const { data: offences } = useQuery({
    queryKey: ["offences-catalog", schoolId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("offenses_catalog" as never) as any)
        .select("*")
        .eq("school_id", schoolId)
        .order("category", { ascending: true })
        .order("code", { ascending: true });
      if (error) throw error;
      return data as Offence[];
    },
    enabled: !!schoolId,
  });

  // Category management functions
  async function addCategory() {
    if (!newCategoryName.trim()) {
      toast.error("Category name is required");
      return;
    }
    setBusy(true);
    try {
      const { error } = await (supabase.from("offence_categories" as never) as any).insert({
        school_id: schoolId,
        name: newCategoryName.trim(),
        is_active: true,
        sort_order: (categories?.length || 0) + 1,
      });
      if (error) throw error;
      toast.success("Category added");
      setNewCategoryName("");
      void qc.invalidateQueries({ queryKey: ["offence-categories", schoolId] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function updateCategory(id: string, name: string) {
    if (!name.trim()) {
      toast.error("Category name cannot be empty");
      return;
    }
    setBusy(true);
    try {
      const { error } = await (supabase.from("offence_categories" as never) as any)
        .update({ name: name.trim() })
        .eq("id", id);
      if (error) throw error;
      toast.success("Category renamed");
      setEditingCategoryId(null);
      void qc.invalidateQueries({ queryKey: ["offence-categories", schoolId] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleCategoryActive(id: string, isActive: boolean) {
    setBusy(true);
    try {
      const { error } = await (supabase.from("offence_categories" as never) as any)
        .update({ is_active: isActive })
        .eq("id", id);
      if (error) throw error;
      toast.success(isActive ? "Category activated" : "Category deactivated");
      void qc.invalidateQueries({ queryKey: ["offence-categories", schoolId] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Offence management functions
  async function addOffence() {
    if (!newOffence.code.trim() || !newOffence.title.trim()) {
      toast.error("Code and title are required");
      return;
    }
    setBusy(true);
    try {
      const { error } = await (supabase.from("offenses_catalog" as never) as any).insert({
        school_id: schoolId,
        code: newOffence.code.trim(),
        title: newOffence.title.trim(),
        category_id: newOffence.category_id || null,
        category: categories?.find(c => c.id === newOffence.category_id)?.name || null,
        severity: newOffence.severity,
        marks_deducted: newOffence.marks,
        description: newOffence.description.trim() || null,
        is_active: true,
      });
      if (error) throw error;
      toast.success("Offence added");
      setNewOffence({ code: "", title: "", category_id: "", severity: "minor", marks: 2, description: "" });
      void qc.invalidateQueries({ queryKey: ["offences-catalog", schoolId] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleOffenceActive(id: string, isActive: boolean) {
    setBusy(true);
    try {
      const { error } = await (supabase.from("offenses_catalog" as never) as any)
        .update({ is_active: isActive })
        .eq("id", id);
      if (error) throw error;
      toast.success(isActive ? "Offence activated" : "Offence deactivated");
      void qc.invalidateQueries({ queryKey: ["offences-catalog", schoolId] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const activeCategories = categories?.filter(c => c.is_active) || [];
  const groupedOffences = offences?.reduce((acc, off) => {
    const cat = off.category || "Uncategorized";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(off);
    return acc;
  }, {} as Record<string, Offence[]>);

  return (
    <div className="space-y-6">
      {/* View toggle */}
      <div className="flex gap-2">
        <button
          onClick={() => setView("categories")}
          className={view === "categories" ? btn : "rounded-xl px-4 py-2 text-sm text-soft hover:text-ink"}
        >
          Categories
        </button>
        <button
          onClick={() => setView("offences")}
          className={view === "offences" ? btn : "rounded-xl px-4 py-2 text-sm text-soft hover:text-ink"}
        >
          Offences
        </button>
      </div>

      {view === "categories" && (
        <div className={panel}>
          <h3 className="mb-4 font-display text-lg font-bold text-ink">Offence Categories</h3>

          {/* Add category */}
          <div className="mb-4 flex gap-2">
            <input
              type="text"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              placeholder="New category name"
              className={inp}
              onKeyDown={(e) => e.key === "Enter" && addCategory()}
            />
            <button onClick={addCategory} disabled={busy} className={btn}>Add</button>
          </div>

          {/* Categories list */}
          <div className="space-y-2">
            {categories?.map((cat) => (
              <div key={cat.id} className="flex items-center gap-2 rounded-xl bg-glass-bright p-3">
                {editingCategoryId === cat.id ? (
                  <>
                    <input
                      type="text"
                      value={editCategoryName}
                      onChange={(e) => setEditCategoryName(e.target.value)}
                      className={inp + " flex-1"}
                    />
                    <button onClick={() => updateCategory(cat.id, editCategoryName)} className="text-sm text-ok">
                      Save
                    </button>
                    <button onClick={() => setEditingCategoryId(null)} className="text-sm text-soft">
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 text-sm font-medium text-ink">{cat.name}</span>
                    <button
                      onClick={() => {
                        setEditingCategoryId(cat.id);
                        setEditCategoryName(cat.name);
                      }}
                      className="text-sm text-brand"
                    >
                      Rename
                    </button>
                    <button
                      onClick={() => toggleCategoryActive(cat.id, !cat.is_active)}
                      className={`text-sm ${cat.is_active ? "text-warn" : "text-ok"}`}
                    >
                      {cat.is_active ? "Deactivate" : "Activate"}
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {view === "offences" && (
        <div className={panel}>
          <h3 className="mb-4 font-display text-lg font-bold text-ink">Manage Offences</h3>

          {/* Add offence form */}
          <div className="mb-6 space-y-3 rounded-xl bg-glass-bright p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                type="text"
                value={newOffence.code}
                onChange={(e) => setNewOffence({ ...newOffence, code: e.target.value })}
                placeholder="Code (e.g., A01)"
                className={inp}
              />
              <input
                type="text"
                value={newOffence.title}
                onChange={(e) => setNewOffence({ ...newOffence, title: e.target.value })}
                placeholder="Title"
                className={inp}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <select
                value={newOffence.category_id}
                onChange={(e) => setNewOffence({ ...newOffence, category_id: e.target.value })}
                className={inp}
              >
                <option value="">Select category</option>
                {activeCategories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <select
                value={newOffence.severity}
                onChange={(e) => setNewOffence({ ...newOffence, severity: e.target.value })}
                className={inp}
              >
                <option value="minor">Minor</option>
                <option value="moderate">Moderate</option>
                <option value="serious">Serious</option>
                <option value="critical">Critical</option>
              </select>
              <input
                type="number"
                value={newOffence.marks}
                onChange={(e) => setNewOffence({ ...newOffence, marks: parseInt(e.target.value) || 0 })}
                placeholder="Marks"
                className={inp}
              />
            </div>
            <input
              type="text"
              value={newOffence.description}
              onChange={(e) => setNewOffence({ ...newOffence, description: e.target.value })}
              placeholder="Description (optional)"
              className={inp}
            />
            <button onClick={addOffence} disabled={busy} className={btn}>Add Offence</button>
          </div>

          {/* Offences list grouped by category */}
          <div className="space-y-4">
            {Object.entries(groupedOffences || {}).map(([category, offs]) => (
              <div key={category}>
                <h4 className="mb-2 text-sm font-bold text-soft">{category}</h4>
                <div className="space-y-1">
                  {offs.map((off) => (
                    <div key={off.id} className="flex items-center gap-2 rounded-lg bg-glass-bright p-2 text-sm">
                      <span className="w-16 font-mono text-xs text-soft">{off.code}</span>
                      <span className="flex-1 text-ink">{off.title}</span>
                      <span className="text-xs text-faint">{off.severity}</span>
                      <span className="text-xs text-faint">-{off.marks_deducted}</span>
                      <button
                        onClick={() => toggleOffenceActive(off.id, !off.is_active)}
                        className={`text-xs ${off.is_active ? "text-ok" : "text-faint"}`}
                      >
                        {off.is_active ? "Active" : "Inactive"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CategoriesTab() {
  const { schoolId } = useAuth();
  const { data: settings } = useSchoolSettings();
  const qc = useQueryClient();
  const [newName, setNewName] = useState("");
  const [newPoints, setNewPoints] = useState(1);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPoints, setEditPoints] = useState(1);
  const [busy, setBusy] = useState(false);

  const rewardType = settings?.good_deed_reward_type ?? "recognition";
  const showPoints = rewardType === "merit_points";

  // Fetch categories
  const { data: categories, isLoading } = useQuery({
    queryKey: ["good-deed-categories", schoolId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("good_deed_categories" as never) as any)
        .select("*")
        .eq("school_id", schoolId)
        .order("name");
      if (error) throw error;
      return data as GoodDeedCategory[];
    },
    enabled: !!schoolId,
  });

  async function addCategory() {
    if (!newName.trim()) {
      toast.error("Category name is required");
      return;
    }
    setBusy(true);
    try {
      const { error } = await (supabase.from("good_deed_categories" as never) as any).insert({
        school_id: schoolId,
        name: newName.trim(),
        default_merit_points: showPoints ? newPoints : 0,
        is_active: true,
      });
      if (error) throw error;
      toast.success("Category added");
      setNewName("");
      setNewPoints(1);
      void qc.invalidateQueries({ queryKey: ["good-deed-categories", schoolId] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function updateCategory(id: string, updates: Partial<GoodDeedCategory>) {
    setBusy(true);
    try {
      const { error } = await (supabase.from("good_deed_categories" as never) as any)
        .update(updates)
        .eq("id", id);
      if (error) throw error;
      toast.success("Category updated");
      setEditingId(null);
      void qc.invalidateQueries({ queryKey: ["good-deed-categories", schoolId] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(id: string, isActive: boolean) {
    await updateCategory(id, { is_active: isActive });
  }

  function startEdit(category: GoodDeedCategory) {
    setEditingId(category.id);
    setEditName(category.name);
    setEditPoints(category.default_merit_points);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName("");
    setEditPoints(1);
  }

  return (
    <div className="space-y-6">
      {/* Reward type notice */}
      <div className={panel}>
        <div className="flex items-start gap-3">
          <div className="text-2xl">ℹ️</div>
          <div className="flex-1">
            <h3 className="font-display text-lg font-bold text-ink">
              {showPoints ? "Recognition + Merit Points" : "Recognition Only"}
            </h3>
            <p className="mt-1 text-sm text-soft">
              {showPoints
                ? "Students earn merit points for good deeds. You can set default points for each category below. Good deeds never affect conduct marks."
                : "Good deeds are recorded for recognition only. Merit point fields are hidden. Change the reward system in System Preferences if you want to award points."}
            </p>
          </div>
        </div>
      </div>

      {/* Categories list */}
      <div className={panel}>
        <h3 className="font-display text-lg font-bold text-ink">Good Deed Categories</h3>
        {isLoading ? (
          <p className="mt-4 text-sm text-soft">Loading categories...</p>
        ) : !categories || categories.length === 0 ? (
          <p className="mt-4 text-sm text-soft">No categories yet. Add one below.</p>
        ) : (
          <div className="mt-4 space-y-2">
            {categories.map((cat) => (
              <div
                key={cat.id}
                className="flex flex-col gap-3 rounded-xl border border-glass-line bg-glass-bright p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                {editingId === cat.id ? (
                  <>
                    <div className="flex-1 space-y-2">
                      <input
                        type="text"
                        className={inp}
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder="Category name"
                      />
                      {showPoints && (
                        <input
                          type="number"
                          className={inp}
                          value={editPoints}
                          onChange={(e) => setEditPoints(Number(e.target.value))}
                          min={0}
                          placeholder="Default merit points"
                        />
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => updateCategory(cat.id, { name: editName.trim(), default_merit_points: showPoints ? editPoints : 0 })}
                        className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-on-brand"
                        disabled={busy || !editName.trim()}
                      >
                        Save
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="rounded-lg px-3 py-1.5 text-xs text-soft"
                        disabled={busy}
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex-1">
                      <p className="font-semibold text-ink">{cat.name}</p>
                      {showPoints && (
                        <p className="text-xs text-soft">{cat.default_merit_points} merit point{cat.default_merit_points !== 1 ? "s" : ""}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => startEdit(cat)}
                        className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-on-brand"
                        disabled={busy}
                      >
                        Rename
                      </button>
                      <label className="flex items-center gap-1 text-xs">
                        <input
                          type="checkbox"
                          checked={cat.is_active}
                          onChange={(e) => toggleActive(cat.id, e.target.checked)}
                          disabled={busy}
                        />
                        <span className={cat.is_active ? "text-ok" : "text-faint"}>
                          {cat.is_active ? "Active" : "Inactive"}
                        </span>
                      </label>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add new category */}
      <div className={panel}>
        <h3 className="font-display text-lg font-bold text-ink">Add New Category</h3>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void addCategory();
          }}
          className="mt-4 space-y-3"
        >
          <label className="block text-xs font-semibold text-soft">
            Category name
            <input
              type="text"
              className={`${inp} mt-1`}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g., Helped a classmate"
            />
          </label>
          {showPoints && (
            <label className="block text-xs font-semibold text-soft">
              Default merit points
              <input
                type="number"
                className={`${inp} mt-1`}
                value={newPoints}
                onChange={(e) => setNewPoints(Number(e.target.value))}
                min={0}
              />
              <p className="mt-1 text-xs text-faint">This value will pre-fill when recording a good deed.</p>
            </label>
          )}
          <button className={btn} disabled={busy || !newName.trim()}>
            Add category
          </button>
        </form>
      </div>
    </div>
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
  manage_terms: "Manage academic calendar",
  school_wide_entries: "Whole-school conduct entries",
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
          manage_terms: true,
          school_wide_entries: true,
        },
        matron: {
          delete_students: false,
          manage_offences: false,
          view_audit_logs: false,
          view_reports: true,
          message_parents: true,
          send_photos: true,
          manage_terms: false,
          school_wide_entries: false,
        },
        patron: {
          delete_students: false,
          manage_offences: false,
          view_audit_logs: false,
          view_reports: true,
          message_parents: true,
          send_photos: true,
          manage_terms: false,
          school_wide_entries: false,
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
