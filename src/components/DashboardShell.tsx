import { Link, LinkProps, useNavigate, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import avatar from "@/assets/avatar.png";
import { ROLE_LABELS, useAuth } from "@/hooks/useAuth";
import { useSchoolSettings } from "@/hooks/useSchoolSettings";

const NAV_ITEMS = [
  { label: "Dashboard", to: "/", letter: "D", disciplineOnly: false },
  { label: "Students", to: "/students", letter: "S", disciplineOnly: false },
  { label: "Conduct Actions", to: "/conduct-actions", letter: "A", disciplineOnly: false },
  { label: "Reports", to: "/reports", letter: "R", disciplineOnly: false },
  { label: "Audit Logs", to: "/audit-logs", letter: "L", disciplineOnly: false },
  { label: "Settings", to: "/settings", letter: "⚙", disciplineOnly: false },
] as const;

function SidebarLink({
  item,
  active,
}: {
  item: (typeof NAV_ITEMS)[number];
  active: boolean;
}) {
  return (
    <Link
      to={item.to}
      activeOptions={{ exact: true }}
      className={
        active
          ? "flex items-center gap-3 rounded-2xl bg-brand/10 px-3 py-2.5 ring-1 ring-brand/20"
          : "flex items-center gap-3 rounded-2xl px-3 py-2.5 transition hover:bg-glass-bright"
      }
    >
      <span
        className={
          active
            ? "grid h-8 w-8 place-items-center rounded-xl bg-brand text-sm font-bold text-white shadow-brand-glow"
            : "grid h-8 w-8 place-items-center rounded-xl bg-glass-bright text-sm font-bold text-soft ring-1 ring-hairline"
        }
      >
        {item.letter}
      </span>
      <span
        className={
          active
            ? "text-sm font-semibold text-ink"
            : "text-sm font-medium text-body"
        }
      >
        {item.label}
      </span>
    </Link>
  );
}

interface DashboardShellProps {
  greeting: string;
  dateLine: string;
  children: ReactNode;
}

export function DashboardShell({ greeting, dateLine, children }: DashboardShellProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const { profile, role, isDisciplineStaff, signOut } = useAuth();
  const navItems = NAV_ITEMS.filter((i) => !i.disciplineOnly || isDisciplineStaff);
  const roleInfo = role ? ROLE_LABELS[role] : null;
  const { data: school } = useSchoolSettings();
  const displayName = profile?.full_name?.trim() || profile?.email || "Staff member";

  return (
    <div className="relative min-h-screen overflow-hidden font-sans text-body antialiased">
      <div className="app-canvas" />
      <div className="bloom bloom-a" />
      <div className="bloom bloom-b" />
      <div className="bloom bloom-c" />

      <div className="relative mx-auto flex min-h-screen max-w-[1440px] gap-6 p-6">
        <aside className="w-64 shrink-0 rounded-3xl border border-glass-line bg-glass shadow-panel-lg backdrop-blur-2xl">
          <div className="flex items-center gap-3 px-6 py-6">
            {school?.logo_url ? (
              <img src={school.logo_url} alt="School logo" className="h-11 w-11 rounded-2xl object-cover ring-1 ring-hairline" />
            ) : (
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-linear-to-br from-brand to-accent text-on-brand shadow-brand-glow">
                <span className="font-display text-lg font-bold">S</span>
              </div>
            )}
            <div className="leading-tight">
              <div className="font-display text-[15px] font-bold text-ink">{school?.school_name || "SCDMS"}</div>
              <div className="text-[11px] uppercase tracking-[0.14em] text-faint">
                Conduct &amp; Discipline
              </div>
            </div>
          </div>
          <div className="px-4">
            <div className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-faint">
              Main
            </div>
            <nav className="space-y-1">
              {navItems.map((item) => (
                <SidebarLink key={item.to} item={item} active={pathname === item.to} />
              ))}
            </nav>
          </div>
          <div className="m-4 mt-6 rounded-2xl border border-glass-line bg-glass-soft p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">
              Open cases
            </div>
            <div className="mt-1 font-display text-3xl font-bold text-ink">12</div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-track">
              <div className="h-full w-[62%] rounded-full bg-linear-to-r from-brand to-accent"></div>
            </div>
            <div className="mt-2 text-[11px] text-soft">3 flagged for review</div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <header className="flex items-center gap-4 rounded-3xl border border-glass-line bg-glass px-6 py-4 shadow-panel-lg backdrop-blur-2xl">
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="font-display text-lg font-bold text-ink">{greeting}</div>
              <div className="text-[12px] text-soft">{dateLine}</div>
            </div>
            <div className="flex items-center gap-2 rounded-2xl bg-glass-bright px-3 py-2 ring-1 ring-hairline">
              <span className="text-sm text-faint">⌕</span>
              <input
                className="w-52 bg-transparent text-sm text-body outline-none placeholder:text-faint"
                placeholder="Search students, cases, actions"
              />
            </div>
            <div className="flex items-center gap-3 rounded-2xl bg-glass-bright px-2 py-1.5 ring-1 ring-hairline">
              <img
                src={profile?.avatar_url || avatar}
                alt={displayName}
                className="h-9 w-9 rounded-xl object-cover ring-1 ring-hairline"
              />
              <div className="leading-tight">
                <div className="text-[13px] font-semibold text-ink">{displayName}</div>
                <div className="text-[11px] text-soft">
                  {profile?.job_title ?? roleInfo?.label ?? "Role pending"}
                </div>
              </div>
              <span className="rounded-lg bg-brand/10 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-brand ring-1 ring-brand/20">
                {roleInfo?.badge ?? "Staff"}
              </span>
              <button
                type="button"
                onClick={async () => {
                  await signOut();
                  navigate({ to: "/auth" });
                }}
                className="rounded-xl px-2 py-1 text-[11px] font-semibold text-soft transition hover:text-ink"
              >
                Sign out
              </button>
            </div>
          </header>

          {children}
        </div>
      </div>
    </div>
  );
}

export type { LinkProps };
