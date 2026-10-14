import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { DashboardShell } from "@/components/DashboardShell";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { db, insertWithColumnFallback, uploadEvidence } from "@/lib/evidence";
import { useSchoolSettings } from "@/hooks/useSchoolSettings";
import { ParentMessageComposer, type ComposerEntry } from "@/components/ParentMessageComposer";

export const Route = createFileRoute("/_authenticated/conduct-actions")({
  head: () => ({
    meta: [
      { title: "Conduct Actions — SCDMS" },
      {
        name: "description",
        content: "Record mark deductions and restorations against student conduct balances.",
      },
      { property: "og:title", content: "Conduct Actions — SCDMS" },
      {
        property: "og:description",
        content: "Record mark deductions and restorations against student conduct balances.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ConductActionsPage,
});

interface StudentOption {
  id: string;
  admission_no: string;
  full_name: string;
  class_name: string;
  house: string | null;
  parent_phone: string | null;
}

interface Offense {
  id: string;
  code: string;
  title: string;
  category: string;
  severity: string;
  marks_deducted: number;
}

interface BalanceRow {
  student_id: string;
  term_id: string;
  term_name: string;
  starting_marks: number;
  marks_deducted: number;
  marks_restored: number;
  current_marks: number;
  entries_count: number;
}

interface RecentEntry {
  id: string;
  student_id: string;
  entry_type: string;
  marks: number;
  reason: string | null;
  occurred_on: string;
  evidence_url?: string | null;
  offense: { title: string } | null;
  student: { full_name: string; admission_no: string; class_name: string; parent_phone: string | null } | null;
}

const inputClass =
  "w-full rounded-2xl bg-glass-bright px-4 py-3 text-sm text-body outline-none ring-1 ring-hairline transition placeholder:text-faint focus:ring-2 focus:ring-brand/50";

function todayISO() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function ConductActionsPage() {
  const { isDisciplineStaff, user, schoolId } = useAuth();
  const { data: schoolSettings } = useSchoolSettings();
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [evidenceKey, setEvidenceKey] = useState(0);
  const [composer, setComposer] = useState<ComposerEntry | null>(null);

  const recentQuery = useQuery({
    queryKey: ["conduct-logs", "recent", schoolId],
    queryFn: async () => {
      let res = await db
        .from("conduct_logs")
        .select("id, student_id, entry_type, marks, reason, occurred_on, evidence_url, offense:offenses_catalog(title), student:students(full_name, admission_no, class_name, parent_phone)")
        .order("created_at", { ascending: false })
        .limit(12);
      if (res.error) {
        res = await db
          .from("conduct_logs")
          .select("id, student_id, entry_type, marks, reason, occurred_on, offense:offenses_catalog(title), student:students(full_name, admission_no, class_name, parent_phone)")
          .order("created_at", { ascending: false })
          .limit(12);
      }
      if (res.error) throw res.error;
      return (res.data ?? []) as unknown as RecentEntry[];
    },
  });

  const queryClient = useQueryClient();

  const [studentId, setStudentId] = useState("");
  const [studentQuery, setStudentQuery] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const [entryType, setEntryType] = useState<"deduction" | "restoration">("deduction");
  const [offenseId, setOffenseId] = useState("");
  const [marks, setMarks] = useState<string>("1");
  const [occurredOn, setOccurredOn] = useState(todayISO());
  const [reason, setReason] = useState("");
  const [notifyParent, setNotifyParent] = useState(true);

  const studentsQuery = useQuery({
    queryKey: ["students", "active"],
    queryFn: async (): Promise<StudentOption[]> => {
      const { data, error } = await supabase
        .from("students")
        .select("id, admission_no, full_name, class_name, house, parent_phone")
        .eq("is_active", true)
        .order("full_name");
      if (error) throw error;
      return (data ?? []) as StudentOption[];
    },
  });

  const offensesQuery = useQuery({
    queryKey: ["offenses", "active"],
    queryFn: async (): Promise<Offense[]> => {
      const { data, error } = await supabase
        .from("offenses_catalog")
        .select("id, code, title, category, severity, marks_deducted")
        .eq("is_active", true)
        .order("code");
      if (error) throw error;
      return (data ?? []) as Offense[];
    },
  });

  const termQuery = useQuery({
    queryKey: ["active-term"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("academic_terms")
        .select("id, name, starting_marks")
        .eq("is_active", true)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const balanceQuery = useQuery({
    queryKey: ["balance", studentId],
    enabled: Boolean(studentId),
    queryFn: async (): Promise<BalanceRow | null> => {
      const { data, error } = await supabase
        .from("student_conduct_balances")
        .select(
          "student_id, term_id, term_name, starting_marks, marks_deducted, marks_restored, current_marks, entries_count",
        )
        .eq("student_id", studentId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as BalanceRow | null;
    },
  });

  const students = studentsQuery.data ?? [];
  const selectedStudent = students.find((s) => s.id === studentId) ?? null;

  const filteredStudents = useMemo(() => {
    const q = studentQuery.trim().toLowerCase();
    if (!q) return students.slice(0, 40);
    return students
      .filter((s) =>
        [s.full_name, s.admission_no, s.class_name, s.house ?? ""].some((v) =>
          v.toLowerCase().includes(q),
        ),
      )
      .slice(0, 40);
  }, [students, studentQuery]);

  // Auto-fill marks from the offense catalogue (still editable).
  useEffect(() => {
    if (!offenseId) return;
    const offense = offensesQuery.data?.find((o) => o.id === offenseId);
    if (offense) setMarks(String(offense.marks_deducted));
  }, [offenseId, offensesQuery.data]);

  const markValue = Number.parseInt(marks, 10);
  const validMarks = Number.isFinite(markValue) && markValue > 0;
  const currentBalance = balanceQuery.data?.current_marks ?? null;
  const newBalance =
    currentBalance === null || !validMarks
      ? null
      : entryType === "deduction"
        ? Math.max(currentBalance - markValue, 0)
        : Math.min(
            currentBalance + markValue,
            balanceQuery.data?.starting_marks ?? currentBalance + markValue,
          );

  const termId = termQuery.data?.id ?? balanceQuery.data?.term_id ?? null;
  const canSubmit = Boolean(studentId && termId && validMarks && isDisciplineStaff);

  const submit = useMutation({
    mutationFn: async () => {
      if (!studentId || !termId) throw new Error("Select a student and an active term first.");
      const evidence = await uploadEvidence(evidenceFile, schoolId);
      const { data: log, dropped } = await insertWithColumnFallback(
        "conduct_logs",
        {
          student_id: studentId,
          term_id: termId,
          offense_id: offenseId || null,
          entry_type: entryType,
          marks: markValue,
          reason: reason.trim() || null,
          occurred_on: occurredOn,
          recorded_by: user?.id ?? null,
          evidence_path: evidence.evidence_path,
          evidence_url: evidence.evidence_url,
        },
        ["evidence_path", "evidence_url"],
      );

      const offense = offensesQuery.data?.find((o) => o.id === offenseId);
      const label = entryType === "deduction" ? "Deduction" : "Restoration";
      const cause = offense?.title || reason.trim() || "conduct review";
      const startingMarks = balanceQuery.data?.starting_marks ?? 40;
      const resultingBalance = newBalance ?? currentBalance ?? startingMarks;

      let smsQueued = false;
      const phone = selectedStudent?.parent_phone ?? null;
      if (notifyParent && phone) {
        const messageBody = `SCDMS Update: ${selectedStudent?.full_name} received a ${label} of ${markValue} marks for '${cause}'. Current Conduct Balance: ${resultingBalance}/${startingMarks}.`;
        const { error: notifyError } = await supabase.from("notification_logs").insert({
          conduct_log_id: log.id,
          student_id: studentId,
          recipient_phone: phone,
          message_body: messageBody,
          status: "pending",
        });
        if (notifyError) {
          console.error("Failed to queue parent SMS", notifyError);
        } else {
          smsQueued = true;
        }
      }

      const { error: auditError } = await supabase.from("audit_logs").insert({
        user_id: user?.id ?? null,
        action: "CREATE_CONDUCT_LOG",
        entity_type: "conduct_logs",
        entity_id: log.id,
        payload: {
          student_id: studentId,
          action_type: entryType,
          marks_changed: entryType === "deduction" ? -markValue : markValue,
          timestamp: new Date().toISOString(),
          session: {
            user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
        },
      });
      if (auditError) console.error("Failed to write audit entry", auditError);

      return {
        smsQueued,
        notifyRequested: notifyParent,
        hasPhone: Boolean(phone),
        evidenceNote: dropped.length
          ? "Evidence not stored (database not updated)"
          : evidence.usedFallback
            ? "Photo upload failed — a small copy was saved"
            : evidenceFile
              ? "Evidence attached"
              : null,
      };
    },
    onSuccess: async (result) => {
      const smsLine = result.smsQueued
        ? "SMS queued to parent"
        : result.notifyRequested && !result.hasPhone
          ? "No parent phone on file — SMS skipped"
          : "SMS not sent";
      toast.success("Conduct log recorded successfully", {
        description: `Ledger entry saved · ${smsLine}${result.evidenceNote ? ` · ${result.evidenceNote}` : ""}`,
      });
      setOffenseId("");
      setReason("");
      setMarks("1");
      setOccurredOn(todayISO());
      setEvidenceFile(null);
      setEvidenceKey((k) => k + 1);
      await queryClient.invalidateQueries({ queryKey: ["balance"] });
      await queryClient.invalidateQueries({ queryKey: ["conduct-logs"] });
      await queryClient.invalidateQueries({ queryKey: ["notification-logs"] });
      await queryClient.invalidateQueries({ queryKey: ["audit-logs"] });
    },
    onError: (err: Error) => toast.error(err.message || "Couldn't save this entry."),
  });

  if (!isDisciplineStaff) {
    return (
      <DashboardShell
        greeting="Conduct Actions"
        dateLine="Mark deductions and restorations · Northfield Academy"
      >
        <div className="rounded-3xl border border-glass-line bg-glass p-10 shadow-panel backdrop-blur-2xl">
          <h2 className="font-display text-2xl font-bold text-ink">Restricted section</h2>
          <p className="mt-2 max-w-md text-sm text-soft">
            Recording conduct entries is limited to matrons and patrons. As a school leader
            you can view student records and reports.
          </p>
        </div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell
      greeting="Conduct Actions"
      dateLine="Mark deductions and restorations · Northfield Academy"
    >
      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) submit.mutate();
          }}
          className="rounded-3xl border border-glass-line bg-glass p-6 shadow-panel backdrop-blur-2xl"
        >
          <h2 className="font-display text-xl font-bold text-ink">New conduct entry</h2>
          <p className="mt-1 text-[12px] text-soft">
            {termQuery.data
              ? `Recording against ${termQuery.data.name}`
              : "No active term configured"}
          </p>

          <div className="mt-6 space-y-5">
            {/* Student combobox */}
            <div className="relative">
              <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.12em] text-faint">
                Student
              </label>
              <input
                value={listOpen ? studentQuery : selectedStudent
                  ? `${selectedStudent.full_name} · ${selectedStudent.admission_no} · ${selectedStudent.class_name}`
                  : ""}
                onFocus={() => {
                  setListOpen(true);
                  setStudentQuery("");
                }}
                onChange={(e) => {
                  setStudentQuery(e.target.value);
                  setListOpen(true);
                }}
                onBlur={() => window.setTimeout(() => setListOpen(false), 150)}
                placeholder="Search name, admission no or class"
                className={inputClass}
              />
              {listOpen && (
                <div className="absolute z-20 mt-2 max-h-64 w-full overflow-y-auto rounded-2xl border border-glass-line bg-glass-soft p-1 shadow-panel backdrop-blur-2xl">
                  {filteredStudents.length === 0 && (
                    <p className="px-3 py-4 text-center text-[12px] text-soft">
                      No matching students.
                    </p>
                  )}
                  {filteredStudents.map((s) => (
                    <button
                      type="button"
                      key={s.id}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setStudentId(s.id);
                        setListOpen(false);
                      }}
                      className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-glass-bright"
                    >
                      <span className="text-[13px] font-semibold text-ink">{s.full_name}</span>
                      <span className="text-[11px] text-soft">
                        {s.admission_no} · {s.class_name}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Action type toggle */}
            <div>
              <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.12em] text-faint">
                Action type
              </label>
              <div className="grid grid-cols-2 gap-2 rounded-2xl bg-glass-bright p-1 ring-1 ring-hairline">
                {(
                  [
                    { key: "deduction", label: "Deduction", hint: "Subtract marks" },
                    { key: "restoration", label: "Restoration", hint: "Add marks back" },
                  ] as const
                ).map((opt) => (
                  <button
                    type="button"
                    key={opt.key}
                    onClick={() => setEntryType(opt.key)}
                    className={
                      entryType === opt.key
                        ? "rounded-xl bg-brand px-4 py-2.5 text-center text-[13px] font-semibold text-white shadow-brand-glow"
                        : "rounded-xl px-4 py-2.5 text-center text-[13px] font-semibold text-soft transition hover:text-ink"
                    }
                  >
                    {opt.label}
                    <span className="block text-[10px] font-medium opacity-70">{opt.hint}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.12em] text-faint">
                  Offense / reason code
                </label>
                <select
                  value={offenseId}
                  onChange={(e) => setOffenseId(e.target.value)}
                  className={inputClass}
                >
                  <option value="">
                    {entryType === "deduction" ? "Select an offense" : "None (restoration)"}
                  </option>
                  {(offensesQuery.data ?? []).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.code} · {o.title} ({o.marks_deducted})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.12em] text-faint">
                  Marks {entryType === "deduction" ? "to deduct" : "to restore"}
                </label>
                <input
                  type="number"
                  min={1}
                  value={marks}
                  onChange={(e) => setMarks(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>

            <div>
              <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.12em] text-faint">
                Incident date
              </label>
              <input
                type="date"
                value={occurredOn}
                max={todayISO()}
                onChange={(e) => setOccurredOn(e.target.value)}
                className={inputClass}
              />
            </div>

            <div>
              <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.12em] text-faint">
                Incident details
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={4}
                placeholder="What happened, who was involved, any follow-up agreed…"
                className={`${inputClass} resize-y`}
              />
            </div>

            <div>
              <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.12em] text-faint">
                Attach evidence (photo, optional)
              </label>
              <input
                key={evidenceKey}
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  if (f && (!f.type.startsWith("image/") || f.size > 5 * 1024 * 1024)) {
                    toast.error("Choose an image smaller than 5 MB.");
                    e.target.value = "";
                    return;
                  }
                  setEvidenceFile(f);
                }}
                className={`${inputClass} file:mr-3 file:rounded-xl file:border-0 file:bg-brand/10 file:px-3 file:py-1 file:text-brand`}
              />
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-glass-bright px-4 py-3 ring-1 ring-hairline">
              <input
                type="checkbox"
                checked={notifyParent}
                onChange={(e) => setNotifyParent(e.target.checked)}
                className="mt-0.5 size-4 accent-[var(--color-brand)]"
              />
              <span>
                <span className="block text-[13px] font-semibold text-ink">
                  Notify parent via SMS
                </span>
                <span className="block text-[11px] text-soft">
                  {selectedStudent
                    ? selectedStudent.parent_phone
                      ? `Queues a message to ${selectedStudent.parent_phone}`
                      : "No parent phone on file for this student"
                    : "Queues a message to the parent number on file"}
                </span>
              </span>
            </label>


            <button
              type="submit"
              disabled={!canSubmit || submit.isPending}
              className="w-full rounded-2xl bg-brand px-5 py-3.5 font-display text-sm font-bold text-white shadow-brand-glow transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submit.isPending ? "Saving…" : "Record conduct entry"}
            </button>
          </div>
        </form>

        {/* Balance preview */}
        <aside className="space-y-5">
          <div className="rounded-3xl border border-glass-line bg-glass p-6 shadow-panel backdrop-blur-2xl">
            <h3 className="font-display text-sm font-bold uppercase tracking-[0.12em] text-faint">
              Balance preview
            </h3>

            {!selectedStudent && (
              <p className="mt-4 text-[13px] text-soft">
                Select a student to see their live mark balance.
              </p>
            )}

            {selectedStudent && (
              <>
                <p className="mt-4 text-lg font-semibold text-ink">{selectedStudent.full_name}</p>
                <p className="text-[12px] text-soft">
                  {selectedStudent.admission_no} · {selectedStudent.class_name}
                  {selectedStudent.house ? ` · ${selectedStudent.house}` : ""}
                </p>

                {balanceQuery.isPending ? (
                  <div className="mt-5 h-10 animate-pulse rounded-2xl bg-track" />
                ) : (
                  <div className="mt-5 flex items-end gap-3">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-faint">
                        Current
                      </p>
                      <p className="font-display text-3xl font-bold text-ink">
                        {currentBalance ?? "—"}
                      </p>
                    </div>
                    <span className="pb-2 text-xl text-faint">→</span>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-faint">
                        New
                      </p>
                      <p
                        className={
                          entryType === "deduction"
                            ? "font-display text-3xl font-bold text-danger"
                            : "font-display text-3xl font-bold text-ok"
                        }
                      >
                        {newBalance ?? "—"}
                      </p>
                    </div>
                  </div>
                )}

                <dl className="mt-5 space-y-2 border-t border-hairline pt-4 text-[12px]">
                  {[
                    ["Starting marks", balanceQuery.data?.starting_marks],
                    ["Deducted this term", balanceQuery.data?.marks_deducted],
                    ["Restored this term", balanceQuery.data?.marks_restored],
                    ["Entries logged", balanceQuery.data?.entries_count],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="flex justify-between">
                      <dt className="text-soft">{label}</dt>
                      <dd className="font-semibold text-ink">{value ?? "—"}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
          </div>

          <div className="rounded-3xl border border-glass-line bg-glass p-6 shadow-panel backdrop-blur-2xl">
            <h3 className="font-display text-sm font-bold uppercase tracking-[0.12em] text-faint">
              Recent entries
            </h3>
            {(recentQuery.data ?? []).length === 0 && (
              <p className="mt-4 text-[13px] text-soft">No entries recorded yet.</p>
            )}
            <ul className="mt-4 space-y-2">
              {(recentQuery.data ?? []).map((r) => (
                <li key={r.id} className="flex items-center gap-3 rounded-2xl bg-glass-bright px-3 py-2 ring-1 ring-hairline">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-ink">{r.student?.full_name ?? "Student"}</p>
                    <p className="truncate text-[11px] text-soft">
                      <span className={r.entry_type === "deduction" ? "text-danger" : "text-ok"}>
                        {r.entry_type === "deduction" ? "−" : "+"}{r.marks}
                      </span>{" "}
                      · {r.offense?.title ?? r.reason ?? "Conduct review"} · {r.occurred_on}
                      {r.evidence_url ? " · 📎" : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      const { data: bal } = await supabase
                        .from("student_conduct_balances")
                        .select("current_marks, starting_marks")
                        .eq("student_id", r.student_id)
                        .maybeSingle();
                      setComposer({
                        conductLogId: r.id,
                        studentId: r.student_id,
                        phone: r.student?.parent_phone ?? null,
                        context: {
                          studentName: r.student?.full_name ?? "your child",
                          entryType: r.entry_type === "restoration" ? "restoration" : "deduction",
                          marks: r.marks,
                          reason: r.offense?.title ?? r.reason,
                          balance: bal?.current_marks ?? null,
                          startingMarks: bal?.starting_marks ?? 40,
                          occurredOn: r.occurred_on,
                          evidenceUrl: r.evidence_url ?? null,
                          schoolName: schoolSettings?.school_name ?? "School",
                        },
                      });
                    }}
                    className="shrink-0 rounded-xl px-3 py-1.5 text-[11px] font-semibold text-brand ring-1 ring-brand/30 hover:bg-brand/10"
                  >
                    Message parent
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
      <ParentMessageComposer entry={composer} onOpenChange={(o) => !o && setComposer(null)} />
    </DashboardShell>
  );
}
