import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { levelOf, nextAcademicYear, statusOf, type StudentRow } from "@/lib/students";

const NEXT: Record<string, string> = { S1: "S2", S2: "S3", S3: "S4", S4: "S5", S5: "S6" };

export function PromotionDialog({
  open,
  onOpenChange,
  students,
  academicYear,
  canPromote,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  students: StudentRow[];
  academicYear: string;
  canPromote: boolean;
}) {
  const qc = useQueryClient();
  const { schoolId } = useAuth();
  const [repeating, setRepeating] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const newYear = nextAcademicYear(academicYear);

  const eligible = useMemo(
    () => students.filter((s) => { const st = statusOf(s); return (st === "active" || st === "repeating") && levelOf(s); }),
    [students],
  );
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? eligible.filter((s) => `${s.full_name} ${s.admission_no} ${s.class_name}`.toLowerCase().includes(t)) : eligible;
  }, [eligible, q]);

  const counts = useMemo(() => {
    let promote = 0, graduate = 0;
    for (const s of eligible) {
      if (repeating.has(s.id)) continue;
      if (levelOf(s) === "S6") graduate++; else promote++;
    }
    return { promote, graduate, repeat: repeating.size };
  }, [eligible, repeating]);

  const run = useMutation({
    mutationFn: async () => {
      const hasStatus = eligible.some((s) => "status" in s);
      const updated = eligible.map((s) => {
        const lvl = levelOf(s)!;
        const row: StudentRow = { ...s };
        if (repeating.has(s.id)) {
          if (hasStatus) row.status = "repeating";
        } else if (lvl === "S6") {
          row.is_active = false;
          if (hasStatus) row.status = "graduated";
        } else {
          const nl = NEXT[lvl] ?? lvl;
          row.class_level = nl;
          row.class_name = s.class_name.replace(/\bS[1-6]\b/i, nl);
          if (hasStatus) row.status = "active";
        }
        if ("academic_year" in s) row.academic_year = newYear;
        return row;
      });
      for (let i = 0; i < updated.length; i += 200) {
        const { error } = await supabase
          .from("students")
          .upsert(updated.slice(i, i + 200) as never, { onConflict: "id" });
        if (error) throw error;
      }
      // Advance the school's academic year (leaders/admins only; ignore if not permitted).
      // Update the academic year of the school on screen (the viewed school in support view).
      if (schoolId) {
        await (supabase.from("school_settings") as any).update({ academic_year: newYear }).eq("school_id", schoolId);
      } else {
        await supabase.from("school_settings").update({ academic_year: newYear }).eq("id", 1);
      }
    },
    onSuccess: () => {
      toast.success(
        `Promotion complete: ${counts.promote} promoted, ${counts.graduate} graduated, ${counts.repeat} repeating.`,
      );
      void qc.invalidateQueries({ queryKey: ["students"] });
      void qc.invalidateQueries({ queryKey: ["school-settings"] });
      setRepeating(new Set());
      onOpenChange(false);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const toggle = (id: string) =>
    setRepeating((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>Annual class promotion</DialogTitle>
          <DialogDescription>
            {academicYear} → {newYear}. S1–S5 move up one level, S6 become Graduated / Alumni. Tick students who should repeat.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-2 text-center">
          {[["Promote", counts.promote, "text-ok"], ["Graduate", counts.graduate, "text-brand"], ["Repeat", counts.repeat, "text-danger"]].map(([l, n, c]) => (
            <div key={l as string} className="rounded-2xl bg-glass-bright p-3 ring-1 ring-hairline">
              <div className={`font-display text-2xl font-bold ${c}`}>{n as number}</div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-faint">{l as string}</div>
            </div>
          ))}
        </div>

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Search ${eligible.length} active students…`}
          className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-ink outline-none"
        />

        <div className="max-h-[40vh] overflow-y-auto rounded-2xl ring-1 ring-hairline">
          {shown.map((s) => {
            const lvl = levelOf(s)!;
            const rep = repeating.has(s.id);
            return (
              <label key={s.id} className="flex cursor-pointer items-center gap-3 border-b border-hairline px-4 py-2 text-[13px] last:border-0 hover:bg-glass-bright">
                <input type="checkbox" checked={rep} onChange={() => toggle(s.id)} className="h-4 w-4 accent-[var(--color-danger)]" aria-label={`Mark ${s.full_name} as repeating`} />
                <span className="flex-1 font-semibold text-ink">{s.full_name}</span>
                <span className="w-24 text-soft">{s.admission_no}</span>
                <span className="w-40 text-right text-body">
                  {s.class_name} → {rep ? <b className="text-danger">{lvl} (repeat)</b> : lvl === "S6" ? <b className="text-brand">Alumni</b> : <b className="text-ok">{NEXT[lvl]}</b>}
                </span>
              </label>
            );
          })}
          {shown.length === 0 && <div className="p-6 text-center text-sm text-soft">No active students.</div>}
        </div>

        <div className="flex items-center justify-end gap-2">
          {!canPromote && <span className="mr-auto text-xs text-danger">Only Matrons/Patrons and administrators can run promotion.</span>}
          <button onClick={() => onOpenChange(false)} className="rounded-xl px-4 py-2 text-sm font-semibold text-soft ring-1 ring-hairline">Cancel</button>
          <button
            disabled={!canPromote || run.isPending || eligible.length === 0}
            onClick={() => run.mutate()}
            className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-on-brand shadow-brand-glow disabled:opacity-50"
          >
            {run.isPending ? "Promoting…" : "Promote Eligible Students"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
