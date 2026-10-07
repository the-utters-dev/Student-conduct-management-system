import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { DashboardShell } from "@/components/DashboardShell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useSchoolSettings } from "@/hooks/useSchoolSettings";
import { CLASS_LEVELS, RWANDA_DISTRICTS, RWANDA_SECTORS, STREAMS } from "@/lib/rwanda";
import { PromotionDialog } from "@/components/PromotionDialog";
import {
  STATUS_LABELS,
  isMissingColumn,
  levelOf,
  normalizeRwPhone,
  rwCarrier,
  statusOf,
  streamOf,
  type StudentRow,
} from "@/lib/students";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/students")({
  head: () => ({
    meta: [
      { title: "Students — SCDMS" },
      {
        name: "description",
        content:
          "Student registry with admission numbers, classes, houses and parent contact numbers.",
      },
      { property: "og:title", content: "Students — SCDMS" },
      {
        property: "og:description",
        content: "Browse student records and parent contact details.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: StudentsPage,
});

const PAGE_SIZE = 25;

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function StudentsPage() {
  const { role, isDisciplineStaff } = useAuth();
  const { data: school } = useSchoolSettings();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState("");
  const [stream, setStream] = useState("");
  const [statusFilter, setStatusFilter] = useState("current");
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [toDelete, setToDelete] = useState<StudentRow | null>(null);
  const canDelete = role !== null;

  const { data, isPending, error } = useQuery({
    queryKey: ["students"],
    queryFn: async (): Promise<StudentRow[]> => {
      // Fetch in 1000-row batches so large schools aren't truncated.
      const all: StudentRow[] = [];
      for (let from = 0; ; from += 1000) {
        const { data: rows, error: queryError } = await supabase
          .from("students")
          .select("*")
          .order("full_name", { ascending: true })
          .range(from, from + 999);
        if (queryError) throw queryError;
        all.push(...((rows ?? []) as StudentRow[]));
        if (!rows || rows.length < 1000) break;
      }
      return all;
    },
  });

  const del = useMutation({
    mutationFn: async (s: StudentRow) => {
      const { error: e } = await supabase.from("students").delete().eq("id", s.id);
      if (e) {
        if (e.code === "23503")
          throw new Error("This student has conduct records, so they can't be deleted. Mark them inactive instead.");
        throw e;
      }
    },
    onSuccess: () => {
      toast.success("Student deleted");
      void qc.invalidateQueries({ queryKey: ["students"] });
    },
    onError: (e) => toast.error((e as Error).message),
    onSettled: () => setToDelete(null),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, "").replace(/^(250|0)/, "");
    return (data ?? []).filter((s) => {
      if (level && levelOf(s) !== level) return false;
      if (stream && streamOf(s) !== stream) return false;
      const st = statusOf(s);
      if (statusFilter === "current" ? st !== "active" && st !== "repeating" : statusFilter && st !== statusFilter) return false;
      if (!q) return true;
      if (qDigits.length >= 3 && (s.parent_phone ?? "").replace(/\D/g, "").includes(qDigits)) return true;
      return [s.full_name, s.admission_no, s.class_name, s.parent_name, s.father_name, s.mother_name, s.guardian_email].some(
        (v) => (v ?? "").toLowerCase().includes(q),
      );
    });
  }, [data, search, level, stream, statusFilter]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const selectCls =
    "rounded-2xl bg-glass-bright px-3 py-2 text-sm text-body ring-1 ring-hairline outline-none";

  return (
    <DashboardShell
      greeting="Students"
      dateLine={`Student registry · ${school?.school_name ?? "School"}`}
    >
      <div className="rounded-3xl border border-glass-line bg-glass p-6 shadow-panel backdrop-blur-2xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-bold text-ink">Student registry</h2>
            <p className="mt-1 text-[12px] text-soft">
              {isPending
                ? "Loading records…"
                : `${filtered.length} of ${data?.length ?? 0} students`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-2xl bg-glass-bright px-3 py-2 ring-1 ring-hairline">
              <span className="text-sm text-faint">⌕</span>
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="w-56 bg-transparent text-sm text-body outline-none placeholder:text-faint"
                placeholder="Student, parent name or phone"
              />
            </div>
            <select aria-label="Filter by level" value={level} onChange={(e) => { setLevel(e.target.value); setPage(1); }} className={selectCls}>
              <option value="">All levels</option>
              {CLASS_LEVELS.map((l) => <option key={l}>{l}</option>)}
            </select>
            <select aria-label="Filter by stream" value={stream} onChange={(e) => { setStream(e.target.value); setPage(1); }} className={selectCls}>
              <option value="">All streams</option>
              {STREAMS.filter((s) => s !== "F").map((l) => <option key={l}>{l}</option>)}
            </select>
            <select aria-label="Filter by status" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className={selectCls}>
              <option value="current">Active & repeating</option>
              <option value="active">Active</option>
              <option value="repeating">Repeating</option>
              <option value="graduated">Graduated / Alumni</option>
              <option value="">All statuses</option>
            </select>
            {role && (
              <button
                onClick={() => setPromoting(true)}
                className="rounded-2xl bg-glass-bright px-4 py-2 text-sm font-semibold text-ink ring-1 ring-hairline"
              >
                Academic Progression
              </button>
            )}
            {role && (
              <button
                onClick={() => setAdding(true)}
                className="rounded-2xl bg-brand px-4 py-2 text-sm font-semibold text-on-brand shadow-brand-glow"
              >
                + Add Student
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="mt-5 rounded-2xl bg-danger/10 px-4 py-3 text-[12px] font-medium text-danger">
            Couldn't load students: {(error as Error).message}
          </div>
        )}

        <div className="mt-5 overflow-x-auto rounded-2xl ring-1 ring-hairline">
          <table className="w-full min-w-[860px] border-collapse text-left">
            <thead>
              <tr className="bg-glass-bright">
                {["Student", "Admission no", "Class", "Residence", "Parent contact", "Status", ""].map(
                  (h, i) => (
                    <th
                      key={i}
                      className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.12em] text-faint"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {isPending &&
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-t border-hairline">
                    <td colSpan={7} className="px-4 py-4">
                      <div className="h-4 w-full animate-pulse rounded-full bg-track" />
                    </td>
                  </tr>
                ))}

              {!isPending && filtered.length === 0 && (
                <tr className="border-t border-hairline">
                  <td colSpan={7} className="px-4 py-8 text-center text-[13px] text-soft">
                    No students match these filters.
                  </td>
                </tr>
              )}

              {pageRows.map((s) => {
                const st = statusOf(s);
                const parents = [s.father_name, s.mother_name].filter(Boolean).join(" & ") || s.parent_name;
                return (
                <tr key={s.id} className="border-t border-hairline transition hover:bg-glass-bright">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-glass-bright text-[12px] font-bold text-ink ring-1 ring-hairline">
                        {initials(s.full_name)}
                      </div>
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-ink">{s.full_name}</div>
                        <div className="text-[11px] text-soft">
                          {[s.gender, s.date_of_birth && new Date(s.date_of_birth).toLocaleDateString("en-GB")]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[12px] text-body">{s.admission_no}</td>
                  <td className="px-4 py-3 text-[12px] text-body">{s.class_name}</td>
                  <td className="px-4 py-3 text-[12px] text-body">
                    {[s.cell, s.sector, s.district].filter(Boolean).join(", ") || "—"}
                  </td>
                  <td className="px-4 py-3 text-[12px] text-body">
                    <div>{parents ?? "—"}</div>
                    <div className="text-[11px] text-soft">
                      {s.parent_phone ?? "No phone"}
                      {s.notification_channel && ` · ${s.notification_channel === "both" ? "SMS + Email" : s.notification_channel.toUpperCase()}`}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-lg px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] ${
                        st === "active" ? "bg-ok/15 text-ok" : st === "graduated" ? "bg-brand/15 text-brand" : "bg-danger/15 text-danger"
                      }`}
                    >
                      {st === "inactive" ? "Inactive" : STATUS_LABELS[st]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canDelete && (
                      <button
                        onClick={() => setToDelete(s)}
                        aria-label={`Delete ${s.full_name}`}
                        className="rounded-lg px-2.5 py-1 text-[11px] font-semibold text-danger ring-1 ring-danger/30 hover:bg-danger/10"
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filtered.length > PAGE_SIZE && (
          <div className="mt-4 flex items-center justify-between text-[12px] text-soft">
            <span>
              Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}
            </span>
            <div className="flex items-center gap-2">
              <button disabled={safePage === 1} onClick={() => setPage(safePage - 1)} className="rounded-lg px-3 py-1.5 font-semibold ring-1 ring-hairline disabled:opacity-40">← Prev</button>
              <span className="font-semibold text-ink">Page {safePage} / {pages}</span>
              <button disabled={safePage === pages} onClick={() => setPage(safePage + 1)} className="rounded-lg px-3 py-1.5 font-semibold ring-1 ring-hairline disabled:opacity-40">Next →</button>
            </div>
          </div>
        )}
      </div>

      <AddStudentDialog open={adding} onOpenChange={setAdding} academicYear={school?.academic_year ?? "2026/2027"} />
      <PromotionDialog
        open={promoting}
        onOpenChange={setPromoting}
        students={data ?? []}
        academicYear={school?.academic_year ?? "2026/2027"}
        canPromote={isDisciplineStaff}
      />

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure you want to delete this student?</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete?.full_name} ({toDelete?.admission_no}) will be permanently removed. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-danger text-on-brand hover:bg-danger/90"
              onClick={(e) => {
                e.preventDefault();
                if (toDelete) del.mutate(toDelete);
              }}
            >
              {del.isPending ? "Deleting…" : "Delete student"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardShell>
  );
}

const EMPTY = {
  first_name: "",
  last_name: "",
  admission_no: "",
  date_of_birth: "",
  gender: "",
  district: "",
  sector: "",
  cell: "",
  class_level: "",
  stream: "",
  combination: "",
  parent_name: "",
  parent_phone: "",
  father_name: "",
  mother_name: "",
  guardian_email: "",
  notification_channel: "sms",
  primary_contact: "guardian",
};
type Form = typeof EMPTY;

function validate(f: Form) {
  const e: Partial<Record<keyof Form, string>> = {};
  if (!f.first_name.trim()) e.first_name = "First name is required.";
  if (!f.last_name.trim()) e.last_name = "Last name is required.";
  if (!f.admission_no.trim()) e.admission_no = "Student code is required.";
  if (!f.date_of_birth) e.date_of_birth = "Date of birth is required.";
  else {
    const age = (Date.now() - new Date(f.date_of_birth).getTime()) / 31557600000;
    if (age < 8 || age > 30) e.date_of_birth = "Enter a realistic date of birth (age 8–30).";
  }
  if (!f.gender) e.gender = "Select sex.";
  if (!f.district) e.district = "Select a district.";
  if (!f.sector.trim()) e.sector = "Sector is required.";
  if (!f.cell.trim()) e.cell = "Cell is required.";
  if (!f.class_level) e.class_level = "Select a level.";
  if (!f.stream) e.stream = "Select a stream.";
  if (f.father_name.length > 100) e.father_name = "Keep under 100 characters.";
  if (f.mother_name.length > 100) e.mother_name = "Keep under 100 characters.";
  if (!f.parent_phone.trim()) {
    if (f.notification_channel !== "email") e.parent_phone = "A phone number is needed for SMS alerts.";
  } else if (!normalizeRwPhone(f.parent_phone))
    e.parent_phone = "Enter an MTN (078/079) or Airtel (072/073) number, e.g. 788 123 456.";
  if (f.guardian_email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.guardian_email.trim()))
    e.guardian_email = "Enter a valid email address.";
  else if (!f.guardian_email.trim() && f.notification_channel !== "sms")
    e.guardian_email = "An email is needed for email alerts.";
  const designated = { father: f.father_name, mother: f.mother_name, guardian: f.parent_name }[f.primary_contact as "father"];
  if (!designated?.trim()) e.primary_contact = "Enter the name of the designated parent above.";
  return e;
}

function AddStudentDialog({ open, onOpenChange, academicYear }: { open: boolean; onOpenChange: (o: boolean) => void; academicYear: string }) {
  const qc = useQueryClient();
  const [f, setF] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const set = (k: keyof Form, v: string) => setF((p) => ({ ...p, [k]: v }));
  const sectors = RWANDA_SECTORS[f.district];
  const today = new Date().toISOString().slice(0, 10);

  const save = useMutation({
    mutationFn: async () => {
      const className = [f.class_level, f.combination.trim().toUpperCase(), f.stream].filter(Boolean).join(" ");
      const base = {
        first_name: f.first_name.trim(),
        last_name: f.last_name.trim(),
        full_name: `${f.first_name.trim()} ${f.last_name.trim()}`,
        admission_no: f.admission_no.trim(),
        date_of_birth: f.date_of_birth,
        gender: f.gender,
        district: f.district,
        sector: f.sector.trim(),
        cell: f.cell.trim(),
        class_level: f.class_level,
        stream: f.stream,
        class_name: className,
        parent_name: f.parent_name.trim() || null,
        parent_phone: normalizeRwPhone(f.parent_phone),
      };
      const extended = {
        ...base,
        father_name: f.father_name.trim() || null,
        mother_name: f.mother_name.trim() || null,
        guardian_email: f.guardian_email.trim() || null,
        notification_channel: f.notification_channel,
        primary_contact: f.primary_contact,
        status: "active",
        academic_year: academicYear,
      };
      let { error } = await supabase.from("students").insert(extended as never);
      if (isMissingColumn(error)) {
        ({ error } = await supabase.from("students").insert(base));
        if (!error) toast.warning("Saved without guardian details — the database update for these fields hasn't been applied yet.");
      }
      if (error) {
        if (error.code === "23505") throw new Error("A student with this code already exists.");
        throw error;
      }
    },
    onSuccess: () => {
      toast.success("Student added");
      void qc.invalidateQueries({ queryKey: ["students"] });
      setF(EMPTY);
      setErrors({});
      onOpenChange(false);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = validate(f);
    setErrors(v);
    if (Object.keys(v).length === 0) save.mutate();
  }

  const inp = "w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-brand/40";
  const field = (k: keyof Form, label: string, node: React.ReactNode) => (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-soft">{label}</span>
      {node}
      {errors[k] && <span className="mt-1 block text-xs text-danger">{errors[k]}</span>}
    </label>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add student</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
          {field("first_name", "First name", <input className={inp} value={f.first_name} onChange={(e) => set("first_name", e.target.value)} />)}
          {field("last_name", "Last name", <input className={inp} value={f.last_name} onChange={(e) => set("last_name", e.target.value)} />)}
          {field("admission_no", "Student code", <input className={inp} placeholder="e.g. NA-1011" value={f.admission_no} onChange={(e) => set("admission_no", e.target.value)} />)}
          {field("date_of_birth", "Date of birth", <input type="date" max={today} className={inp} value={f.date_of_birth} onChange={(e) => set("date_of_birth", e.target.value)} />)}
          {field("gender", "Sex", (
            <select className={inp} value={f.gender} onChange={(e) => set("gender", e.target.value)}>
              <option value="">Select…</option><option>Male</option><option>Female</option>
            </select>
          ))}
          {field("district", "District", (
            <select className={inp} value={f.district} onChange={(e) => setF((p) => ({ ...p, district: e.target.value, sector: "", cell: "" }))}>
              <option value="">Select district…</option>
              {Object.entries(RWANDA_DISTRICTS).map(([prov, ds]) => (
                <optgroup key={prov} label={prov}>{ds.map((d) => <option key={d}>{d}</option>)}</optgroup>
              ))}
            </select>
          ))}
          {field("sector", "Sector", sectors ? (
            <select className={inp} value={f.sector} onChange={(e) => set("sector", e.target.value)}>
              <option value="">Select sector…</option>
              {sectors.map((s) => <option key={s}>{s}</option>)}
            </select>
          ) : (
            <input className={inp} disabled={!f.district} placeholder={f.district ? "Sector name" : "Choose a district first"} value={f.sector} onChange={(e) => set("sector", e.target.value)} />
          ))}
          {field("cell", "Cell", <input className={inp} disabled={!f.sector} placeholder={f.sector ? "Cell name" : "Choose a sector first"} value={f.cell} onChange={(e) => set("cell", e.target.value)} />)}
          {field("class_level", "Level", (
            <select className={inp} value={f.class_level} onChange={(e) => set("class_level", e.target.value)}>
              <option value="">Select…</option>{CLASS_LEVELS.map((l) => <option key={l}>{l}</option>)}
            </select>
          ))}
          {field("stream", "Stream", (
            <select className={inp} value={f.stream} onChange={(e) => set("stream", e.target.value)}>
              <option value="">Select…</option>{STREAMS.map((l) => <option key={l}>{l}</option>)}
            </select>
          ))}
          {field("combination", "Combination (optional, S4–S6)", <input className={inp} placeholder="e.g. MEG, PCB" value={f.combination} onChange={(e) => set("combination", e.target.value)} />)}
          <div className="self-end pb-2 text-xs text-soft">
            Class: <span className="font-semibold text-ink">{[f.class_level, f.combination.toUpperCase(), f.stream].filter(Boolean).join(" ") || "—"}</span>
          </div>
          <div className="border-t border-hairline pt-3 text-xs font-bold uppercase tracking-[0.12em] text-faint sm:col-span-2">Parents & guardian</div>
          {field("father_name", "Father name", <input className={inp} value={f.father_name} onChange={(e) => set("father_name", e.target.value)} />)}
          {field("mother_name", "Mother name", <input className={inp} value={f.mother_name} onChange={(e) => set("mother_name", e.target.value)} />)}
          {field("parent_name", "Guardian name (optional)", <input className={inp} value={f.parent_name} onChange={(e) => set("parent_name", e.target.value)} />)}
          {field("parent_phone", "Primary guardian phone", (
            <div className="flex items-center rounded-xl border border-input bg-background focus-within:ring-2 focus-within:ring-brand/40">
              <span className="border-r border-input px-3 text-sm font-semibold text-soft">+250</span>
              <input
                className="w-full bg-transparent px-3 py-2 text-sm text-ink outline-none"
                placeholder="788 123 456"
                inputMode="tel"
                value={f.parent_phone}
                onChange={(e) => set("parent_phone", e.target.value)}
                onBlur={() => { const n = normalizeRwPhone(f.parent_phone); if (n) set("parent_phone", n.replace("+250 ", "")); }}
              />
              {rwCarrier(f.parent_phone) && <span className="px-3 text-[10px] font-bold uppercase text-ok">{rwCarrier(f.parent_phone)}</span>}
            </div>
          ))}
          {field("guardian_email", "Guardian email (optional)", <input type="email" className={inp} placeholder="parent@example.com" value={f.guardian_email} onChange={(e) => set("guardian_email", e.target.value)} />)}
          {field("notification_channel", "Preferred notification channel", (
            <select className={inp} value={f.notification_channel} onChange={(e) => set("notification_channel", e.target.value)}>
              <option value="sms">SMS (MTN/Airtel)</option><option value="email">Email</option><option value="both">Both</option>
            </select>
          ))}
          {field("primary_contact", "Primary designated parent (receives alerts)", (
            <select className={inp} value={f.primary_contact} onChange={(e) => set("primary_contact", e.target.value)}>
              <option value="father">Father</option><option value="mother">Mother</option><option value="guardian">Guardian</option>
            </select>
          ))}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <button type="button" onClick={() => onOpenChange(false)} className="rounded-xl px-4 py-2 text-sm font-semibold text-soft ring-1 ring-hairline">Cancel</button>
            <button type="submit" disabled={save.isPending} className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-on-brand shadow-brand-glow disabled:opacity-60">
              {save.isPending ? "Saving…" : "Add student"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
