import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { isMissingColumn, levelOf, nextAcademicYear, statusOf, type StudentRow } from "@/lib/students";

type Action = "promote" | "repeat" | "graduate";
const LEVELS = ["S1", "S2", "S3", "S4", "S5", "S6"];
const NEXT: Record<string, string> = { S1: "S2", S2: "S3", S3: "S4", S4: "S5", S5: "S6" };
const defaultAction = (lvl: string): Action => (lvl === "S6" ? "graduate" : "promote");

export function nextPlacement(s: StudentRow, action: Action) {
  const lvl = levelOf(s) ?? "";
  if (action !== "promote" || !NEXT[lvl]) return { grade_level: lvl, class_name: s.class_name };
  return { grade_level: NEXT[lvl], class_name: s.class_name.replace(/\bS[1-6]\b/i, NEXT[lvl]) };
}

function yearOptions(current: string) {
  const out: string[] = [];
  let y = current;
  for (let i = 0; i < 2; i++) { const m = y.match(/^(\d{4})\/(\d{4})$/); if (!m) break; y = `${Number(m[1] ?? 0) - 1}/${Number(m[2] ?? 0) - 1}`; }
  for (let i = 0; i < 5; i++) { out.push(y); y = nextAcademicYear(y); }
  return out.length ? out : [current];
}

export function AcademicProgressionModal({
  open, onOpenChange, students, academicYear,
}: { open: boolean; onOpenChange: (o: boolean) => void; students: StudentRow[]; academicYear: string }) {
  const qc = useQueryClient();
  const years = useMemo(() => yearOptions(academicYear), [academicYear]);
  const [fromYear, setFromYear] = useState(academicYear);
  const [toYear, setToYear] = useState(nextAcademicYear(academicYear));
  const [level, setLevel] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Record<string, Action>>({});

  useEffect(() => { setFromYear(academicYear); setToYear(nextAcademicYear(academicYear)); }, [academicYear]);

  const pool = useMemo(
    () => students.filter((s) => {
      const st = statusOf(s);
      const lvl = levelOf(s);
      return (st === "active" || st === "repeating") && lvl && (!level || lvl === level);
    }),
    [students, level],
  );
  useEffect(() => { setSelected(new Set(pool.map((s) => s.id))); }, [pool]);

  const actionOf = (s: StudentRow) => overrides[s.id] ?? defaultAction(levelOf(s)!);
  const bulk = (a: Action) =>
    setOverrides((p) => { const n = { ...p }; for (const id of selected) n[id] = a; return n; });

  const run = useMutation({
    mutationFn: async () => {
      const chosen = pool.filter((s) => selected.has(s.id));
      if (!chosen.length) throw new Error("Select at least one student.");
      if (fromYear === toYear) throw new Error("Target year must differ from current year.");
      const items = chosen.map((s) => ({ student_id: s.id, action: actionOf(s), ...nextPlacement(s, actionOf(s)) }));

      const rpc = await supabase.rpc("promote_students_batch" as never, { p_from_year: fromYear, p_to_year: toYear, p_items: items } as never);
      if (!rpc.error) return { count: chosen.length, mode: "atomic" as const };
      const missingFn = ["PGRST202", "42883"].includes(rpc.error.code ?? "");
      if (!missingFn) throw rpc.error;

      // Fallback: function not installed yet — history (best effort) then student updates.
      const hist = await supabase.from("student_academic_history" as never).insert(
        chosen.map((s) => ({ student_id: s.id, academic_year: fromYear, grade_level: levelOf(s), class_name: s.class_name, status: statusOf(s) })) as never,
      );
      const hasExtra = chosen.some((s) => "status" in s);
      for (const s of chosen) {
        const it = items.find((i) => i.student_id === s.id)!;
        const base = { class_level: it.grade_level, class_name: it.class_name, is_active: it.action !== "graduate" };
        const extra = hasExtra ? { academic_year: toYear, status: it.action === "graduate" ? "graduated" : it.action === "repeat" ? "repeating" : "active" } : {};
        let { error } = await supabase.from("students").update({ ...base, ...extra } as never).eq("id", s.id);
        if (error && isMissingColumn(error)) ({ error } = await supabase.from("students").update(base as never).eq("id", s.id));
        if (error) throw error;
      }
      return { count: chosen.length, mode: hist.error ? ("no-history" as const) : ("fallback" as const) };
    },
    onSuccess: async ({ count, mode }) => {
      await supabase.from("school_settings").update({ academic_year: toYear }).eq("id", 1);
      toast.success(`Rollover complete: ${count} students moved to ${toYear}.`);
      if (mode === "no-history") toast.warning("History wasn't saved — run supabase/academic-progression.sql to enable it.");
      void qc.invalidateQueries({ queryKey: ["students"] });
      void qc.invalidateQueries({ queryKey: ["school-settings"] });
      setOverrides({});
      onOpenChange(false);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const sel = "rounded-xl border border-input bg-background px-3 py-2 text-sm text-ink";
  const allOn = pool.length > 0 && pool.every((s) => selected.has(s.id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>End-of-year rollover</DialogTitle>
          <DialogDescription>Record this year's placement in history, then move students into the new academic year.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-2">
          <label className="text-xs font-semibold text-soft">Current year
            <select value={fromYear} onChange={(e) => setFromYear(e.target.value)} className={`${sel} mt-1 w-full`}>{years.map((y) => <option key={y}>{y}</option>)}</select>
          </label>
          <label className="text-xs font-semibold text-soft">Target year
            <select value={toYear} onChange={(e) => setToYear(e.target.value)} className={`${sel} mt-1 w-full`}>{years.map((y) => <option key={y}>{y}</option>)}</select>
          </label>
          <label className="text-xs font-semibold text-soft">Class level
            <select value={level} onChange={(e) => setLevel(e.target.value)} className={`${sel} mt-1 w-full`}>
              <option value="">All levels</option>{LEVELS.map((l) => <option key={l}>{l}</option>)}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-soft">Set {selected.size} selected to:</span>
          {(["promote", "repeat", "graduate"] as Action[]).map((a) => (
            <button key={a} onClick={() => bulk(a)} className="rounded-lg bg-glass-bright px-3 py-1 font-semibold capitalize text-ink ring-1 ring-hairline">{a}</button>
          ))}
        </div>

        <div className="max-h-[40vh] overflow-y-auto rounded-2xl ring-1 ring-hairline">
          <label className="flex items-center gap-3 border-b border-hairline px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
            <input type="checkbox" checked={allOn} onChange={() => setSelected(allOn ? new Set() : new Set(pool.map((s) => s.id)))} aria-label="Select all" />
            Student
          </label>
          {pool.map((s) => {
            const a = actionOf(s);
            const to = nextPlacement(s, a);
            return (
              <div key={s.id} className="flex items-center gap-3 border-b border-hairline px-4 py-2 text-[13px] last:border-0">
                <input type="checkbox" checked={selected.has(s.id)} aria-label={`Select ${s.full_name}`}
                  onChange={() => setSelected((p) => { const n = new Set(p); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n; })} />
                <span className="flex-1 font-semibold text-ink">{s.full_name}</span>
                <span className="w-20 text-soft">{s.class_name}</span>
                <select value={a} onChange={(e) => setOverrides((p) => ({ ...p, [s.id]: e.target.value as Action }))} className="rounded-lg border border-input bg-background px-2 py-1 text-xs text-ink">
                  <option value="promote" disabled={levelOf(s) === "S6"}>Promote</option>
                  <option value="repeat">Repeat / Retain</option>
                  <option value="graduate">Graduate</option>
                </select>
                <span className="w-24 text-right font-semibold text-body">{a === "graduate" ? "Alumni" : to.class_name}</span>
              </div>
            );
          })}
          {pool.length === 0 && <div className="p-6 text-center text-sm text-soft">No students at this level.</div>}
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={() => onOpenChange(false)} className="rounded-xl px-4 py-2 text-sm font-semibold text-soft ring-1 ring-hairline">Cancel</button>
          <button disabled={run.isPending || selected.size === 0} onClick={() => run.mutate()}
            className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-on-brand shadow-brand-glow disabled:opacity-50">
            {run.isPending ? "Rolling over…" : `Run rollover (${selected.size})`}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
