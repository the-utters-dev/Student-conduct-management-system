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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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

interface GoodDeedCategory {
  id: string;
  name: string;
  default_marks: number;
  default_merit_points: number;
  is_active: boolean;
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
  good_deed_category?: { name: string } | null;
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
  const { isDisciplineStaff, user, schoolId, school, can } = useAuth();
  const { data: schoolSettings } = useSchoolSettings();
  const queryClient = useQueryClient();

  // Mode toggle: one or multiple students
  const [selectionMode, setSelectionMode] = useState<"one" | "several" | "whole_level" | "whole_school">("one");
  const [studentId, setStudentId] = useState("");
  const [studentQuery, setStudentQuery] = useState("");
  const [listOpen, setListOpen] = useState(false);

  // Multi-student selection state
  const [selectedClassLevel, setSelectedClassLevel] = useState("");
  const [selectedStream, setSelectedStream] = useState("");
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set());

  const [entryType, setEntryType] = useState<"deduction" | "restoration" | "good_deed">("deduction");
  const [offenseId, setOffenseId] = useState("");
  const [goodDeedCategoryId, setGoodDeedCategoryId] = useState("");
  const [marks, setMarks] = useState<string>("1");
  const [meritPoints, setMeritPoints] = useState<string>("1");
  const [occurredOn, setOccurredOn] = useState(todayISO());
  const [reason, setReason] = useState("");
  const [notifyParent, setNotifyParent] = useState(true);

  // Set notifyParent to false by default for whole_school entries
  useEffect(() => {
    if (selectionMode === "whole_school") {
      setNotifyParent(false);
    } else if (selectionMode === "one" || selectionMode === "several" || selectionMode === "whole_level") {
      setNotifyParent(true);
    }
  }, [selectionMode]);
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [evidenceKey, setEvidenceKey] = useState(0);
  const [composer, setComposer] = useState<ComposerEntry | null>(null);
  const [showConfirmation, setShowConfirmation] = useState(false);

  const studentsQuery = useQuery({
    queryKey: ["students", "active", schoolId],
    enabled: Boolean(schoolId),
    queryFn: async (): Promise<StudentOption[]> => {
      if (!schoolId) return [];
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
    queryKey: ["offenses", "active", schoolId],
    enabled: Boolean(schoolId),
    queryFn: async (): Promise<Offense[]> => {
      if (!schoolId) return [];
      const { data, error } = await supabase
        .from("offenses_catalog")
        .select("id, code, title, category, severity, marks_deducted")
        .eq("is_active", true)
        .order("code");
      if (error) throw error;
      return (data ?? []) as Offense[];
    },
  });

  const [goodDeedTableMissing, setGoodDeedTableMissing] = useState(true); // Start with true, enable when table confirmed

  const goodDeedCategoriesQuery = useQuery({
    queryKey: ["good-deed-categories", "active", schoolId],
    enabled: Boolean(schoolId),
    queryFn: async (): Promise<GoodDeedCategory[]> => {
      if (!schoolId) return [];
      const res = await db
        .from("good_deed_categories")
        .select("id, name, default_marks, default_merit_points, is_active")
        .eq("is_active", true)
        .order("name");
      if (res.error) {
        // Only hide good deed option if table doesn't exist (error codes 42P01 or PGRST205)
        const code = (res.error as any)?.code;
        const message = res.error.message?.toLowerCase() ?? "";
        if (code === "42P01" || code === "PGRST205" || message.includes("does not exist")) {
          setGoodDeedTableMissing(true);
          return [];
        }
        // For any other error (e.g., RLS policy failure, network error), throw to show error
        throw res.error;
      }
      setGoodDeedTableMissing(false); // Table exists and query succeeded
      return (res.data ?? []) as unknown as GoodDeedCategory[];
    },
  });

  const termQuery = useQuery({
    queryKey: ["active-term", schoolId],
    enabled: Boolean(schoolId),
    queryFn: async () => {
      if (!schoolId) return null;
      const { data, error } = await supabase
        .from("academic_terms")
        .select("id, name, starting_marks")
        .eq("is_active", true)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const recentQuery = useQuery({
    queryKey: ["conduct-logs", "recent", schoolId],
    enabled: Boolean(schoolId),
    queryFn: async () => {
      if (!schoolId) return [];
      const res = await db
        .from("conduct_logs")
        .select("id, student_id, entry_type, marks, reason, occurred_on, evidence_url, offense:offenses_catalog(title), good_deed_category:good_deed_categories(name), student:students(full_name, admission_no, class_name, parent_phone)")
        .order("created_at", { ascending: false })
        .limit(12);
      if (res.error) throw res.error;
      return (res.data ?? []) as unknown as RecentEntry[];
    },
  });

  const balanceQuery = useQuery({
    queryKey: ["balance", studentId, schoolId],
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

  // Extract unique class levels and streams
  const classLevels = useMemo(() => {
    const levels = new Set<string>();
    students.forEach(s => {
      // Extract class level from class_name (e.g., "P1A" -> "P1", "S3B" -> "S3")
      const match = s.class_name.match(/^[A-Z]\d+/);
      if (match) levels.add(match[0]);
    });
    return Array.from(levels).sort();
  }, [students]);

  const streams = useMemo(() => {
    if (!selectedClassLevel) return [];
    const streamSet = new Set<string>();
    students.forEach(s => {
      if (s.class_name.startsWith(selectedClassLevel)) {
        // Extract stream letter (e.g., "P1A" -> "A")
        const stream = s.class_name.replace(selectedClassLevel, "");
        if (stream) streamSet.add(stream);
      }
    });
    return Array.from(streamSet).sort();
  }, [students, selectedClassLevel]);

  // Students matching the selected class/stream for multi-selection
  const matchingStudents = useMemo(() => {
    if (selectionMode === "one") return [];
    if (selectionMode === "whole_school") return students;
    if (selectionMode === "whole_level") {
      if (!selectedClassLevel) return [];
      return students.filter(s => s.class_name.startsWith(selectedClassLevel));
    }
    // selectionMode === "several"
    if (!selectedClassLevel) return [];
    return students.filter(s => {
      const matchesLevel = s.class_name.startsWith(selectedClassLevel);
      if (!selectedStream) return matchesLevel;
      return s.class_name === `${selectedClassLevel}${selectedStream}`;
    });
  }, [students, selectedClassLevel, selectedStream, selectionMode]);

  // Auto-fill marks from the offense catalogue (still editable).
  useEffect(() => {
    if (!offenseId) return;
    const offense = offensesQuery.data?.find((o) => o.id === offenseId);
    if (offense) setMarks(String(offense.marks_deducted));
  }, [offenseId, offensesQuery.data]);

  // Auto-fill marks and merit points from good deed category and reward setting
  useEffect(() => {
    if (entryType !== "good_deed" || !goodDeedCategoryId) return;
    const category = goodDeedCategoriesQuery.data?.find((c) => c.id === goodDeedCategoryId);
    if (!category) return;

    const rewardMode = schoolSettings?.good_deed_reward_type ?? "recognition";
    if (rewardMode === "recognition") {
      setMarks("0");
      setMeritPoints("0");
    } else if (rewardMode === "merit_points") {
      setMarks("0");
      setMeritPoints(String(category.default_merit_points ?? 0));
    }
  }, [goodDeedCategoryId, goodDeedCategoriesQuery.data, schoolSettings?.good_deed_reward_type, entryType]);

  const markValue = Number.parseInt(marks, 10);
  const validMarks = Number.isFinite(markValue) && markValue >= 0;
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
  const canSubmit = selectionMode === "one"
    ? Boolean(studentId && termId && validMarks && isDisciplineStaff)
    : selectionMode === "whole_school"
      ? Boolean(matchingStudents.length > 0 && termId && validMarks && isDisciplineStaff)
      : selectionMode === "whole_level"
        ? Boolean(selectedClassLevel && matchingStudents.length > 0 && termId && validMarks && isDisciplineStaff)
        : Boolean(selectedStudentIds.size > 0 && termId && validMarks && isDisciplineStaff);

  const submit = useMutation({
    mutationFn: async () => {
      if (selectionMode === "one") {
        // Single student mode (original logic)
        if (!studentId || !termId) throw new Error("Select a student and an active term first.");
        const evidence = await uploadEvidence(evidenceFile, schoolId);
        const meritPointsValue = Number.parseInt(meritPoints, 10);
        const { data: log, dropped } = await insertWithColumnFallback(
          "conduct_logs",
          {
            student_id: studentId,
            school_id: schoolId,
            term_id: termId,
            offense_id: offenseId || null,
            good_deed_category_id: goodDeedCategoryId || null,
            entry_type: entryType,
            marks: entryType === "good_deed" ? 0 : markValue,  // Good deeds NEVER change marks
            merit_points: Number.isFinite(meritPointsValue) ? meritPointsValue : 0,
            reason: reason.trim() || null,
            occurred_on: occurredOn,
            recorded_by: user?.id ?? null,
            evidence_path: evidence.evidence_path,
            evidence_url: evidence.evidence_url,
          },
          ["evidence_path", "evidence_url", "good_deed_category_id", "merit_points"],
        );

        const offense = offensesQuery.data?.find((o) => o.id === offenseId);
        const goodDeedCategory = goodDeedCategoriesQuery.data?.find((c) => c.id === goodDeedCategoryId);
        const label = entryType === "deduction" ? "Deduction" : entryType === "restoration" ? "Restoration" : "Good deed";
        const cause = entryType === "good_deed"
          ? goodDeedCategory?.name || reason.trim() || "good conduct"
          : offense?.title || reason.trim() || "conduct review";
        const startingMarks = balanceQuery.data?.starting_marks ?? (schoolSettings?.max_conduct_marks ?? 40);
        const resultingBalance = newBalance ?? currentBalance ?? startingMarks;

        let smsQueued = false;
        const phone = selectedStudent?.parent_phone ?? null;
        if (notifyParent && phone) {
          const messageBody = entryType === "good_deed"
            ? `Good news from ${schoolSettings?.school_name ?? "School"}! ${selectedStudent?.full_name} was recognised for ${cause}. Thank you for raising a responsible child.`
            : `SCDMS Update: ${selectedStudent?.full_name} received a ${label} of ${markValue} marks for '${cause}'. Current Conduct Balance: ${resultingBalance}/${startingMarks}.`;
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

        const auditAction = entryType === "good_deed" ? "CREATE_GOOD_DEED" : "CREATE_CONDUCT_LOG";
        const { error: auditError } = await supabase.from("audit_logs").insert({
          user_id: user?.id ?? null,
          action: auditAction,
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
          count: 1,
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
      } else {
        // Multiple students mode (several, whole_level, whole_school)
        const targetStudentIds = selectionMode === "whole_school" || selectionMode === "whole_level"
          ? matchingStudents.map(s => s.id)
          : Array.from(selectedStudentIds);

        if (targetStudentIds.length === 0 || !termId) throw new Error("Select students and an active term first.");

        // Upload evidence once to be reused
        const evidence = await uploadEvidence(evidenceFile, schoolId);
        const meritPointsValue = Number.parseInt(meritPoints, 10);

        const offense = offensesQuery.data?.find((o) => o.id === offenseId);
        const goodDeedCategory = goodDeedCategoriesQuery.data?.find((c) => c.id === goodDeedCategoryId);
        const label = entryType === "deduction" ? "Deduction" : entryType === "restoration" ? "Restoration" : "Good deed";
        const cause = entryType === "good_deed"
          ? goodDeedCategory?.name || reason.trim() || "good conduct"
          : offense?.title || reason.trim() || "conduct review";

        const logsToInsert = targetStudentIds.map(sid => ({
          student_id: sid,
          school_id: schoolId,
          term_id: termId,
          offense_id: offenseId || null,
          good_deed_category_id: goodDeedCategoryId || null,
          entry_type: entryType,
          marks: entryType === "good_deed" ? 0 : markValue,  // Good deeds NEVER change marks
          merit_points: Number.isFinite(meritPointsValue) ? meritPointsValue : 0,
          reason: reason.trim() || null,
          occurred_on: occurredOn,
          recorded_by: user?.id ?? null,
          evidence_path: evidence.evidence_path,
          evidence_url: evidence.evidence_url,
        }));

        // Insert all conduct logs at once (cast to any to bypass outdated Supabase types)
        const { data: logs, error: logError } = await supabase
          .from("conduct_logs")
          .insert(logsToInsert as any)
          .select("id, student_id");

        if (logError) throw new Error(logError.message);

        // Queue parent messages
        const messagesToQueue: any[] = [];
        let messagesQueued = 0;
        let studentsWithoutPhone = 0;

        if (notifyParent) {
          for (const log of (logs ?? [])) {
            const student = students.find(s => s.id === log.student_id);
            if (!student) continue;

            if (student.parent_phone) {
              const messageBody = entryType === "good_deed"
                ? `Good news from ${schoolSettings?.school_name ?? "School"}! ${student.full_name} was recognised for ${cause}. Thank you for raising a responsible child.`
                : `SCDMS Update: ${student.full_name} received a ${label} of ${markValue} marks for '${cause}'.`;

              messagesToQueue.push({
                conduct_log_id: log.id,
                student_id: log.student_id,
                recipient_phone: student.parent_phone,
                message_body: messageBody,
                status: "pending",
              });
              messagesQueued++;
            } else {
              studentsWithoutPhone++;
            }
          }

          if (messagesToQueue.length > 0) {
            const { error: notifyError } = await supabase
              .from("notification_logs")
              .insert(messagesToQueue);
            if (notifyError) {
              console.error("Failed to queue parent SMS", notifyError);
            }
          }
        }

        // Create audit logs for each entry
        const auditAction = entryType === "good_deed" ? "CREATE_GOOD_DEED" : "CREATE_CONDUCT_LOG";
        const auditLogs = (logs ?? []).map(log => ({
          user_id: user?.id ?? null,
          action: auditAction,
          entity_type: "conduct_logs",
          entity_id: log.id,
          payload: {
            student_id: log.student_id,
            action_type: entryType,
            marks_changed: entryType === "deduction" ? -markValue : markValue,
            timestamp: new Date().toISOString(),
            bulk_entry: true,
          },
        }));

        if (auditLogs.length > 0) {
          const { error: auditError } = await supabase.from("audit_logs").insert(auditLogs);
          if (auditError) console.error("Failed to write audit entries", auditError);
        }

        return {
          count: targetStudentIds.length,
          messagesQueued,
          studentsWithoutPhone,
          notifyRequested: notifyParent,
        };
      }
    },
    onSuccess: async (result) => {
      if (selectionMode === "one") {
        const smsLine = result.smsQueued
          ? "SMS queued to parent"
          : result.notifyRequested && !result.hasPhone
            ? "No parent phone on file — SMS skipped"
            : "SMS not sent";
        toast.success("Conduct log recorded successfully", {
          description: `Ledger entry saved · ${smsLine}${result.evidenceNote ? ` · ${result.evidenceNote}` : ""}`,
        });
      } else {
        const parts = [`Recorded for ${result.count} students`];
        if (result.notifyRequested) {
          if ((result.messagesQueued ?? 0) > 0) {
            parts.push(`${result.messagesQueued} parent messages queued`);
          }
          if ((result.studentsWithoutPhone ?? 0) > 0) {
            parts.push(`${result.studentsWithoutPhone} without a phone`);
          }
        }
        toast.success(parts.join(" · "));
      }

      setOffenseId("");
      setGoodDeedCategoryId("");
      setReason("");
      setMarks("1");
      setMeritPoints("1");
      setOccurredOn(todayISO());
      setEvidenceFile(null);
      setEvidenceKey((k) => k + 1);
      setSelectedStudentIds(new Set());
      await queryClient.invalidateQueries({ queryKey: ["balance"] });
      await queryClient.invalidateQueries({ queryKey: ["conduct-logs", schoolId] });
      await queryClient.invalidateQueries({ queryKey: ["notification-logs", schoolId] });
      await queryClient.invalidateQueries({ queryKey: ["audit-logs", schoolId] });
    },
    onError: (err: Error) => toast.error(err.message || "Couldn't save this entry."),
  });

  if (!schoolId) {
    return (
      <DashboardShell
        greeting="Conduct Actions"
        dateLine="Mark deductions and restorations"
      >
        <div className="rounded-3xl border border-glass-line bg-glass p-10 shadow-panel backdrop-blur-2xl">
          <h2 className="font-display text-2xl font-bold text-ink">No school context</h2>
          <p className="mt-2 max-w-md text-sm text-soft">
            This page requires a school context. Platform administrators must be assigned to a school to record conduct entries.
          </p>
        </div>
      </DashboardShell>
    );
  }

  if (!isDisciplineStaff) {
    return (
      <DashboardShell
        greeting="Conduct Actions"
        dateLine={`Mark deductions and restorations · ${school?.name ?? "School"}`}
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
      dateLine={`Mark deductions and restorations · ${school?.name ?? "School"}`}
    >
      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSubmit) return;
            // Show confirmation for whole_school and whole_level
            if (selectionMode === "whole_school" || selectionMode === "whole_level") {
              setShowConfirmation(true);
            } else {
              submit.mutate();
            }
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
            {/* Mode toggle */}
            <div>
              <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.12em] text-faint">
                Student selection
              </label>
              <div className={can("school_wide_entries") ? "grid grid-cols-2 gap-2 rounded-2xl bg-glass-bright p-1 ring-1 ring-hairline sm:grid-cols-4" : "grid grid-cols-2 gap-2 rounded-2xl bg-glass-bright p-1 ring-1 ring-hairline"}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectionMode("one");
                    setSelectedStudentIds(new Set());
                    setSelectedClassLevel("");
                    setSelectedStream("");
                  }}
                  className={
                    selectionMode === "one"
                      ? "rounded-xl bg-brand px-4 py-2.5 text-center text-[13px] font-semibold text-white shadow-brand-glow"
                      : "rounded-xl px-4 py-2.5 text-center text-[13px] font-semibold text-soft transition hover:text-ink"
                  }
                >
                  One student
                  <span className="block text-[10px] font-medium opacity-70">Individual entry</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectionMode("several");
                    setStudentId("");
                  }}
                  className={
                    selectionMode === "several"
                      ? "rounded-xl bg-brand px-4 py-2.5 text-center text-[13px] font-semibold text-white shadow-brand-glow"
                      : "rounded-xl px-4 py-2.5 text-center text-[13px] font-semibold text-soft transition hover:text-ink"
                  }
                >
                  Several students
                  <span className="block text-[10px] font-medium opacity-70">Bulk entry</span>
                </button>
                {can("school_wide_entries") && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectionMode("whole_level");
                        setStudentId("");
                        setSelectedStream("");
                        setSelectedStudentIds(new Set());
                      }}
                      className={
                        selectionMode === "whole_level"
                          ? "rounded-xl bg-brand px-4 py-2.5 text-center text-[13px] font-semibold text-white shadow-brand-glow"
                          : "rounded-xl px-4 py-2.5 text-center text-[13px] font-semibold text-soft transition hover:text-ink"
                      }
                    >
                      Whole level
                      <span className="block text-[10px] font-medium opacity-70">e.g., all S2</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectionMode("whole_school");
                        setStudentId("");
                        setSelectedClassLevel("");
                        setSelectedStream("");
                        setSelectedStudentIds(new Set());
                      }}
                      className={
                        selectionMode === "whole_school"
                          ? "rounded-xl bg-brand px-4 py-2.5 text-center text-[13px] font-semibold text-white shadow-brand-glow"
                          : "rounded-xl px-4 py-2.5 text-center text-[13px] font-semibold text-soft transition hover:text-ink"
                      }
                    >
                      Whole school
                      <span className="block text-[10px] font-medium opacity-70">All students</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Student selection (conditional based on mode) */}
            {selectionMode === "one" ? (
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
            ) : (
              <div className="space-y-4">
                {/* Whole school: show summary */}
                {selectionMode === "whole_school" && (
                  <div className="rounded-2xl border border-brand/30 bg-brand/5 p-4">
                    <p className="text-sm font-semibold text-ink">
                      Whole school selected: {students.length} student{students.length !== 1 ? "s" : ""}
                    </p>
                    <p className="mt-1 text-xs text-soft">
                      This entry will apply to all active students across all classes.
                    </p>
                  </div>
                )}

                {/* Whole level: class level selection only */}
                {selectionMode === "whole_level" && (
                  <div>
                    <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.12em] text-faint">
                      Class level
                    </label>
                    <select
                      value={selectedClassLevel}
                      onChange={(e) => {
                        setSelectedClassLevel(e.target.value);
                        setSelectedStudentIds(new Set());
                      }}
                      className={inputClass}
                    >
                      <option value="">Choose level...</option>
                      {classLevels.map((level) => (
                        <option key={level} value={level}>
                          {level}
                        </option>
                      ))}
                    </select>
                    {selectedClassLevel && matchingStudents.length > 0 && (
                      <p className="mt-2 text-xs text-soft">
                        {matchingStudents.length} student{matchingStudents.length !== 1 ? "s" : ""} in {selectedClassLevel}
                      </p>
                    )}
                  </div>
                )}

                {/* Several students: class level and stream selection */}
                {selectionMode === "several" && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.12em] text-faint">
                        Class level
                      </label>
                      <select
                        value={selectedClassLevel}
                        onChange={(e) => {
                          setSelectedClassLevel(e.target.value);
                          setSelectedStream("");
                          setSelectedStudentIds(new Set());
                        }}
                        className={inputClass}
                      >
                        <option value="">Choose level...</option>
                        {classLevels.map((level) => (
                          <option key={level} value={level}>
                            {level}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.12em] text-faint">
                        Stream (optional)
                      </label>
                      <select
                        value={selectedStream}
                        onChange={(e) => {
                          setSelectedStream(e.target.value);
                          setSelectedStudentIds(new Set());
                        }}
                        className={inputClass}
                        disabled={!selectedClassLevel}
                      >
                        <option value="">All streams</option>
                        {streams.map((stream) => (
                          <option key={stream} value={stream}>
                            {stream}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {/* Student checklist (only for "several" mode) */}
                {selectionMode === "several" && matchingStudents.length > 0 && (
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <label className="block text-[10px] font-bold uppercase tracking-[0.12em] text-faint">
                        Students ({selectedStudentIds.size} selected)
                      </label>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedStudentIds(new Set(matchingStudents.map(s => s.id)));
                          }}
                          className="text-[11px] font-semibold text-brand underline"
                        >
                          Select all
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedStudentIds(new Set());
                          }}
                          className="text-[11px] font-semibold text-soft underline"
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                    <div className="max-h-64 space-y-1 overflow-y-auto rounded-2xl border border-glass-line bg-glass-soft p-2">
                      {matchingStudents.map((student) => (
                        <label
                          key={student.id}
                          className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 transition hover:bg-glass-bright"
                        >
                          <input
                            type="checkbox"
                            checked={selectedStudentIds.has(student.id)}
                            onChange={(e) => {
                              const newSet = new Set(selectedStudentIds);
                              if (e.target.checked) {
                                newSet.add(student.id);
                              } else {
                                newSet.delete(student.id);
                              }
                              setSelectedStudentIds(newSet);
                            }}
                            className="h-4 w-4 cursor-pointer"
                          />
                          <span className="flex-1 text-[13px] font-semibold text-ink">{student.full_name}</span>
                          <span className="text-[11px] text-soft">
                            {student.admission_no} · {student.class_name}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Action type toggle */}
            <div>
              <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.12em] text-faint">
                Action type
              </label>
              <div className={`grid ${goodDeedTableMissing ? "grid-cols-2" : "grid-cols-3"} gap-2 rounded-2xl bg-glass-bright p-1 ring-1 ring-hairline`}>
                {(
                  [
                    { key: "deduction", label: "Deduction", hint: "Subtract marks", color: "brand" },
                    { key: "restoration", label: "Restoration", hint: "Add marks back", color: "brand" },
                    ...(goodDeedTableMissing
                      ? []
                      : [{ key: "good_deed" as const, label: "Good deed", hint: "Recognise positive", color: "ok" }]),
                  ] as const
                ).map((opt) => (
                  <button
                    type="button"
                    key={opt.key}
                    onClick={() => setEntryType(opt.key)}
                    className={
                      entryType === opt.key
                        ? `rounded-xl ${opt.color === "ok" ? "bg-ok text-white shadow-[0_4px_16px_rgba(34,197,94,0.3)]" : "bg-brand text-white shadow-brand-glow"} px-4 py-2.5 text-center text-[13px] font-semibold`
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
              {entryType === "good_deed" ? (
                <div>
                  <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.12em] text-faint">
                    Good deed category
                  </label>
                  <select
                    value={goodDeedCategoryId}
                    onChange={(e) => setGoodDeedCategoryId(e.target.value)}
                    className={inputClass}
                  >
                    <option value="">Select a category</option>
                    {(goodDeedCategoriesQuery.data ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
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
                    {(() => {
                      const offences = offensesQuery.data ?? [];
                      const grouped = offences.reduce((acc, o) => {
                        const cat = o.category || "Uncategorized";
                        if (!acc[cat]) acc[cat] = [];
                        acc[cat].push(o);
                        return acc;
                      }, {} as Record<string, Offense[]>);

                      return Object.entries(grouped)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([category, offs]) => (
                          <optgroup key={category} label={category}>
                            {offs
                              .sort((a, b) => a.code.localeCompare(b.code))
                              .map((o) => (
                                <option key={o.id} value={o.id}>
                                  {o.code} · {o.title} ({o.marks_deducted})
                                </option>
                              ))}
                          </optgroup>
                        ));
                    })()}
                  </select>
                </div>
              )}

              {/* Good deeds have NO marks field - they don't change conduct balance */}
              {entryType !== "good_deed" && (
                <div>
                  <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.12em] text-faint">
                    {entryType === "deduction" ? "Marks to deduct" : "Marks to restore"}
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={marks}
                    onChange={(e) => setMarks(e.target.value)}
                    className={inputClass}
                  />
                </div>
              )}
            </div>

            {entryType === "good_deed" && (
              <div>
                <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.12em] text-faint">
                  Merit points
                </label>
                <input
                  type="number"
                  min={0}
                  value={meritPoints}
                  onChange={(e) => setMeritPoints(e.target.value)}
                  className={inputClass}
                />
              </div>
            )}

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

            {can("send_photos") && (
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
            )}

            {can("message_parents") && (
              <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-glass-bright px-4 py-3 ring-1 ring-hairline">
                <input
                  type="checkbox"
                  checked={notifyParent}
                  onChange={(e) => setNotifyParent(e.target.checked)}
                  className="mt-0.5 size-4 accent-[var(--color-brand)]"
                />
                <span>
                  <span className="block text-[13px] font-semibold text-ink">
                    {entryType === "good_deed" ? "Send appreciation to parent" : "Notify parent via SMS"}
                  </span>
                  <span className={`block text-[11px] ${selectedStudent && !selectedStudent.parent_phone ? "text-warn" : "text-soft"}`}>
                    {selectedStudent
                      ? selectedStudent.parent_phone
                        ? `Queues a message to ${selectedStudent.parent_phone}`
                        : "No parent phone on file"
                      : "Queues a message to the parent number on file"}
                  </span>
                </span>
              </label>
            )}


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
                      {r.entry_type === "good_deed" ? (
                        <span className="text-ok">
                          ★ {r.marks > 0 ? `+${r.marks}` : "Recognised"}
                        </span>
                      ) : (
                        <span className={r.entry_type === "deduction" ? "text-danger" : "text-ok"}>
                          {r.entry_type === "deduction" ? "−" : "+"}{r.marks}
                        </span>
                      )}{" "}
                      · {r.entry_type === "good_deed"
                        ? r.good_deed_category?.name ?? r.reason ?? "Good conduct"
                        : r.offense?.title ?? r.reason ?? "Conduct review"} · {r.occurred_on}
                      {r.evidence_url ? " · 📎" : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {r.entry_type === "good_deed" && (
                      <a
                        href={`/certificate/${r.id}`}
                        className="rounded-lg bg-brand px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-on-brand hover:bg-brand/90"
                      >
                        Certificate
                      </a>
                    )}
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
                            entryType: r.entry_type === "good_deed" ? "good_deed" : r.entry_type === "restoration" ? "restoration" : "deduction",
                            marks: r.marks,
                            reason: r.entry_type === "good_deed" ? r.good_deed_category?.name ?? r.reason : r.offense?.title ?? r.reason,
                            balance: bal?.current_marks ?? null,
                            startingMarks: bal?.starting_marks ?? (schoolSettings?.max_conduct_marks ?? 40),
                            occurredOn: r.occurred_on,
                            evidenceUrl: r.evidence_url ?? null,
                            schoolName: schoolSettings?.school_name ?? "School",
                            goodDeedCategory: r.entry_type === "good_deed" ? r.good_deed_category?.name ?? null : null,
                          },
                        });
                      }}
                      className="shrink-0 rounded-xl px-3 py-1.5 text-[11px] font-semibold text-brand ring-1 ring-brand/30 hover:bg-brand/10"
                    >
                      Message parent
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
      {/* Confirmation dialog for whole_school and whole_level */}
      <Dialog open={showConfirmation} onOpenChange={(o) => !o && setShowConfirmation(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm {selectionMode === "whole_school" ? "Whole School" : "Whole Level"} Entry</DialogTitle>
            <DialogDescription>
              This will {entryType === "deduction" ? "deduct" : entryType === "restoration" ? "add" : "record"}{" "}
              {entryType === "good_deed" ? "a good deed for" : `${markValue} marks ${entryType === "deduction" ? "from" : "to"}`}{" "}
              <strong>{matchingStudents.length} student{matchingStudents.length !== 1 ? "s" : ""}</strong>
              {selectionMode === "whole_level" && selectedClassLevel ? ` in ${selectedClassLevel}` : ""}.
              {entryType !== "good_deed" && " This action cannot be undone."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-xl bg-glass-bright p-3 ring-1 ring-hairline">
              <p className="text-sm text-ink">
                <strong>Entry type:</strong> {entryType === "deduction" ? "Deduction" : entryType === "restoration" ? "Restoration" : "Good deed"}
              </p>
              {reason && (
                <p className="mt-1 text-sm text-ink">
                  <strong>Reason:</strong> {reason}
                </p>
              )}
            </div>
            {selectionMode === "whole_school" && (
              <label className="flex items-center gap-2 text-sm text-body">
                <input
                  type="checkbox"
                  checked={notifyParent}
                  onChange={(e) => setNotifyParent(e.target.checked)}
                />
                Send parent SMS notifications (off by default for whole-school entries)
              </label>
            )}
          </div>
          <DialogFooter className="mt-4 flex flex-col-reverse gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => setShowConfirmation(false)}
              className="rounded-xl px-4 py-2 text-sm text-soft"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setShowConfirmation(false);
                submit.mutate();
              }}
              className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-on-brand shadow-brand-glow"
            >
              Confirm and submit
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ParentMessageComposer entry={composer} onOpenChange={(o) => !o && setComposer(null)} />
    </DashboardShell>
  );
}
