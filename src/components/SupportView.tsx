import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/** Shown on every page while the platform owner is viewing a school's workspace. */
export function SupportViewBanner() {
  const { supportView, school, exitSupportView } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  if (!supportView) return null;

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-ink"
    >
      <span className="min-w-0 flex-1">
        Viewing <strong className="font-semibold">{school?.name ?? "this school"}</strong> as platform owner
        <span aria-hidden="true"> — </span>
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const id = school?.id;
          await exitSupportView();
          setBusy(false);
          if (id) navigate({ to: "/platform/schools/$schoolId", params: { schoolId: id } });
          else navigate({ to: "/platform" });
        }}
        className="rounded-xl bg-warn px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
      >
        {busy ? "Exiting…" : "Exit"}
      </button>
    </div>
  );
}

type SchoolOption = { id: string; name: string; status: string };

/** Lets the platform owner choose which school's workspace to open. */
export function SchoolPicker() {
  const { enterSupportView } = useAuth();
  const [search, setSearch] = useState("");
  const [opening, setOpening] = useState<string | null>(null);

  const { data: schools, isLoading, error } = useQuery({
    queryKey: ["support-view", "schools"],
    queryFn: async () => {
      const db = supabase as unknown as SupabaseClient;
      const { data, error } = await db.from("schools").select("id, name, status").order("name");
      if (error) throw error;
      return (data ?? []) as SchoolOption[];
    },
  });

  const term = search.trim().toLowerCase();
  const filtered = (schools ?? []).filter((s) => !term || s.name.toLowerCase().includes(term));

  return (
    <div className="rounded-3xl border border-glass-line bg-glass p-6 shadow-panel backdrop-blur-2xl">
      <h2 className="font-display text-xl font-bold text-ink">Choose a school</h2>
      <p className="mt-1 max-w-xl text-sm text-soft">
        School pages show one school at a time. Pick a school to open its workspace in support view. Everything you
        record there is saved to that school and marked as done by the platform owner.
      </p>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search schools"
        aria-label="Search schools"
        className="mt-4 w-full rounded-2xl bg-glass-bright px-4 py-2.5 text-sm text-ink outline-none ring-1 ring-hairline placeholder:text-faint focus:ring-brand/40 sm:max-w-sm"
      />
      <div className="mt-4">
        {isLoading ? (
          <p className="text-sm text-soft">Loading schools…</p>
        ) : error ? (
          <p className="text-sm text-danger">Could not load schools: {(error as Error).message}</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-soft">{term ? "No school matches your search." : "No schools yet."}</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {filtered.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  disabled={opening !== null}
                  onClick={async () => {
                    setOpening(s.id);
                    try {
                      await enterSupportView(s.id);
                    } catch (e) {
                      toast.error((e as Error).message);
                    } finally {
                      setOpening(null);
                    }
                  }}
                  className="flex w-full items-center justify-between gap-3 rounded-2xl bg-glass-bright px-4 py-3 text-left ring-1 ring-hairline transition hover:ring-brand/40 disabled:opacity-60"
                >
                  <span className="min-w-0 truncate text-sm font-semibold text-ink">{s.name}</span>
                  <span className={`shrink-0 text-[11px] font-semibold uppercase tracking-wide ${s.status === "active" ? "text-ok" : "text-warn"}`}>
                    {opening === s.id ? "Opening…" : s.status}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
