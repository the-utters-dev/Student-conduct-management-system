import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Staff sign in — SCDMS" },
      {
        name: "description",
        content:
          "Sign in to the School Conduct & Discipline Management System. For matrons, patrons and school leaders.",
      },
      { property: "og:title", content: "Staff sign in — SCDMS" },
      {
        property: "og:description",
        content: "Secure staff access to student conduct records and discipline actions.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

type Mode = "signin" | "signup";

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) navigate({ to: "/" });
    })();
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    if (mode === "signin") {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      setBusy(false);
      if (signInError) {
        setError(signInError.message);
        return;
      }
      navigate({ to: "/" });
      return;
    }

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth`,
        data: {
          full_name: fullName,
        },
      },
    });
    setBusy(false);
    if (signUpError) {
      setError(signUpError.message);
      return;
    }
    if (data.session) {
      navigate({ to: "/" });
      return;
    }
    setNotice("Account created. Your School Director will assign you a role and school. Check your email for the confirmation link, then sign in.");
    setMode("signin");
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

          <h1 className="mt-6 font-display text-2xl font-bold text-ink">
            {mode === "signin" ? "Staff sign in" : "Create staff account"}
          </h1>
          <p className="mt-1 text-[13px] text-soft">
            {mode === "signin"
              ? "School staff only. Your School Director will assign your role."
              : "Your School Director will assign you a role and school after you register."}
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            {mode === "signup" && (
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">
                  Full name
                </label>
                <input
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="mt-1 w-full rounded-2xl bg-glass-bright px-4 py-3 text-sm text-ink outline-none ring-1 ring-hairline placeholder:text-faint focus:ring-brand/40"
                  placeholder="Amara Adeyemi"
                />
              </div>
            )}

            <div>
              <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">
                School email
              </label>
              <input
                required
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-2xl bg-glass-bright px-4 py-3 text-sm text-ink outline-none ring-1 ring-hairline placeholder:text-faint focus:ring-brand/40"
                placeholder="you@northfield.ac"
              />
            </div>

            <div>
              <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">
                Password
              </label>
              <input
                required
                type="password"
                minLength={6}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-2xl bg-glass-bright px-4 py-3 text-sm text-ink outline-none ring-1 ring-hairline placeholder:text-faint focus:ring-brand/40"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="rounded-2xl bg-danger/10 px-4 py-3 text-[12px] font-medium text-danger">
                {error}
              </div>
            )}
            {notice && (
              <div className="rounded-2xl bg-ok/10 px-4 py-3 text-[12px] font-medium text-ok">
                {notice}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-2xl bg-linear-to-r from-brand to-accent px-4 py-3 text-sm font-semibold text-white shadow-brand-glow transition disabled:opacity-60"
            >
              {busy
                ? "Please wait…"
                : mode === "signin"
                  ? "Sign in"
                  : "Create account"}
            </button>
          </form>

          <button
            type="button"
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setError(null);
              setNotice(null);
            }}
            className="mt-5 w-full text-[12px] font-semibold text-brand hover:underline"
          >
            {mode === "signin"
              ? "New here? Create a staff account"
              : "Already registered? Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}
