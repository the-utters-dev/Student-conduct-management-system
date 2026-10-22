import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/change-password")({
  head: () => ({
    meta: [
      { title: "Change your password — SCDMS" },
      {
        name: "description",
        content: "Choose a new password for your SCDMS account.",
      },
      { property: "og:title", content: "Change your password — SCDMS" },
      {
        property: "og:description",
        content: "Choose a new password for your SCDMS account.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ChangePasswordPage,
});

function ChangePasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        // Not logged in - redirect to auth
        navigate({ to: "/auth", search: { message: null } });
        return;
      }

      // Check if user needs to change password
      const mustChange = data.session.user.user_metadata?.['must_change_password'];
      if (!mustChange) {
        // Already changed or not required - redirect to dashboard
        navigate({ to: "/" });
        return;
      }

      setCheckingSession(false);
    })();
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Validate password length
    if (password.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }

    // Validate passwords match
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setBusy(true);
    const { data: userData, error: updateError } = await supabase.auth.updateUser({
      password,
      data: { must_change_password: false },
    });
    setBusy(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    // Write audit log for password change
    if (userData?.user) {
      // Get user's school_id for audit log
      const { data: profile } = await supabase
        .from("profiles")
        .select("school_id")
        .eq("id", userData.user.id)
        .maybeSingle();

      await supabase.from("audit_logs").insert({
        user_id: userData.user.id,
        action: "PASSWORD_CHANGED",
        entity_type: "auth",
        entity_id: userData.user.id,
        payload: { source: "temporary_password_change" },
        school_id: profile?.school_id ?? null,
      });
    }

    // Success - redirect to dashboard
    navigate({ to: "/" });
  }

  if (checkingSession) {
    return (
      <div className="relative min-h-screen overflow-hidden font-sans text-body antialiased">
        <div className="app-canvas" />
        <div className="bloom bloom-a" />
        <div className="bloom bloom-b" />
        <div className="bloom bloom-c" />
        <div className="relative grid min-h-screen place-items-center p-6">
          <div className="text-soft">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden font-sans text-body antialiased">
      <div className="app-canvas" />
      <div className="bloom bloom-a" />
      <div className="bloom bloom-b" />
      <div className="bloom bloom-c" />

      <div className="relative grid min-h-screen place-items-center p-6">
        <div className="w-full max-w-md rounded-3xl border border-glass-line bg-glass p-8 shadow-panel-lg backdrop-blur-2xl">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-linear-to-br from-brand to-accent text-white shadow-brand-glow">
              <span className="font-display text-lg font-bold">S</span>
            </div>
            <div className="leading-tight">
              <div className="font-display text-[15px] font-bold text-ink">SCDMS</div>
              <div className="text-[11px] uppercase tracking-[0.14em] text-faint">
                Conduct &amp; Discipline
              </div>
            </div>
          </div>

          <h1 className="mt-6 font-display text-2xl font-bold text-ink">Choose your new password</h1>
          <p className="mt-1 text-[13px] text-soft">
            You are using a temporary password. Please choose a strong password with at least 8 characters.
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">
                New password
              </label>
              <input
                required
                type="password"
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-2xl bg-glass-bright px-4 py-3 text-sm text-ink outline-none ring-1 ring-hairline placeholder:text-faint focus:ring-brand/40"
                placeholder="••••••••"
              />
            </div>

            <div>
              <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">
                Confirm password
              </label>
              <input
                required
                type="password"
                minLength={8}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="mt-1 w-full rounded-2xl bg-glass-bright px-4 py-3 text-sm text-ink outline-none ring-1 ring-hairline placeholder:text-faint focus:ring-brand/40"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="rounded-2xl bg-danger/10 px-4 py-3 text-[12px] font-medium text-danger">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-2xl bg-linear-to-r from-brand to-accent px-4 py-3 text-sm font-semibold text-white shadow-brand-glow transition disabled:opacity-60"
            >
              {busy ? "Please wait…" : "Update password"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
