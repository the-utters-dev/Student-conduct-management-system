import { Link, LinkProps, useNavigate, useRouterState } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { Menu } from "lucide-react";
import avatar from "@/assets/avatar.png";
import { useAuth } from "@/hooks/useAuth";
import { useSchoolSettings } from "@/hooks/useSchoolSettings";
import { useConductStandings } from "@/hooks/useConductStandings";
import { SchoolPicker, SupportViewBanner } from "@/components/SupportView";

// Pages that show one school's data. The platform owner must pick a school (support view) first.
const SCHOOL_PAGES = new Set(["/", "/students", "/conduct-actions", "/reports", "/audit-logs"]);

const NAV_ITEMS = [
  { label: "Dashboard", to: "/", letter: "D", disciplineOnly: false },
  { label: "Students", to: "/students", letter: "S", disciplineOnly: false },
  { label: "Conduct Actions", to: "/conduct-actions", letter: "A", disciplineOnly: false },
  { label: "Reports", to: "/reports", letter: "R", disciplineOnly: false },
  { label: "Audit Logs", to: "/audit-logs", letter: "L", disciplineOnly: false },
  { label: "Settings", to: "/settings", letter: "⚙", disciplineOnly: false },
  { label: "Platform", to: "/platform", letter: "P", disciplineOnly: false, adminOnly: true },
] as {
  label: string;
  to: "/" | "/students" | "/conduct-actions" | "/reports" | "/audit-logs" | "/settings" | "/platform";
  letter: string;
  disciplineOnly: boolean;
  adminOnly?: boolean;
}[];

type NavItem = (typeof NAV_ITEMS)[number];

function SidebarLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      to={item.to}
      activeOptions={{ exact: true }}
      onClick={onNavigate}
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const { profile, school: tenantSchool, role, scope, isDisciplineStaff, isPlatformAdmin, supportView, tenancyEnabled, schoolId, can, roleLabel, signOut } = useAuth();
  const needsSchoolPick = isPlatformAdmin && !supportView && tenancyEnabled && SCHOOL_PAGES.has(pathname);
  const navItems = NAV_ITEMS.filter(
    (i) =>
      (!i.disciplineOnly || isDisciplineStaff) &&
      (!i.adminOnly || isPlatformAdmin) &&
      // Hide audit logs if user doesn't have permission
      (i.to !== "/audit-logs" || can("view_audit_logs")) &&
      // Hide reports if user doesn't have permission
      (i.to !== "/reports" || can("view_reports")),
  );
  const blocked = !isPlatformAdmin && tenancyEnabled && profile
    ? !schoolId && !role
      ? "Your account is waiting for your school to activate it. A School Director will assign you a role and school."
      : !schoolId
        ? "Your account isn't linked to a school yet. Ask your platform administrator to assign you."
        : tenantSchool && tenantSchool.status !== "active"
          ? `${tenantSchool.name}'s subscription is ${tenantSchool.status}. Contact your platform administrator to restore access.`
          : null
    : null;
  const roleLabelText = role ? roleLabel(role) : null;
  const { data: school } = useSchoolSettings();
  const schoolName = isPlatformAdmin && !supportView
    ? "SCDMS Platform"
    : (tenantSchool?.name || school?.school_name || "Your School");
  const { atRisk, criticalCount } = useConductStandings();
  const openCases = atRisk.length;
  const displayName = profile?.full_name?.trim() || profile?.email || "Staff member";
  const scopeBadge = scope === "Female" ? "Girls" : scope === "Male" ? "Boys" : null;

  return (
    <div className="relative min-h-screen overflow-x-clip font-sans text-body antialiased">
      <div className="app-canvas" />
      <div className="bloom bloom-a" />
      <div className="bloom bloom-b" />
      <div className="bloom bloom-c" />

      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Close navigation menu"
            className="absolute inset-0 bg-slate-950/35"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside
            id="mobile-navigation"
            className="relative h-full w-[min(20rem,85vw)] overflow-y-auto border-r border-glass-line bg-glass p-4 shadow-panel-lg backdrop-blur-2xl"
          >
            <div className="flex items-center gap-3 px-2 py-3">
              {school?.logo_url ? (
                <img src={school.logo_url} alt="School logo" className="h-11 w-11 rounded-2xl object-cover ring-1 ring-hairline" />
              ) : (
                <div className="grid h-11 w-11 place-items-center rounded-2xl bg-linear-to-br from-brand to-accent text-on-brand shadow-brand-glow">
                  <span className="font-display text-lg font-bold">S</span>
                </div>
              )}
              <div className="leading-tight">
                <div className="font-display text-[15px] font-bold text-ink">{schoolName}</div>
                <div className="text-[11px] uppercase tracking-[0.14em] text-faint">
                  Conduct &amp; Discipline
                </div>
              </div>
            </div>
            <div className="mt-5 px-1">
              <div className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-faint">
                Main
              </div>
              <nav aria-label="Main navigation" className="space-y-1">
                {navItems.map((item) => (
                  <SidebarLink
                    key={item.to}
                    item={item}
                    active={pathname === item.to}
                    onNavigate={() => setMobileMenuOpen(false)}
                  />
                ))}
              </nav>
            </div>
          </aside>
        </div>
      )}

      <div className="relative mx-auto flex min-h-screen max-w-[1440px] gap-3 p-3 md:gap-6 md:p-6">
        <aside className="hidden w-64 shrink-0 rounded-3xl border border-glass-line bg-glass shadow-panel-lg backdrop-blur-2xl md:block">
          <div className="flex items-center gap-3 px-6 py-6">
            {school?.logo_url ? (
              <img src={school.logo_url} alt="School logo" className="h-11 w-11 rounded-2xl object-cover ring-1 ring-hairline" />
            ) : (
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-linear-to-br from-brand to-accent text-on-brand shadow-brand-glow">
                <span className="font-display text-lg font-bold">S</span>
              </div>
            )}
            <div className="leading-tight">
              <div className="font-display text-[15px] font-bold text-ink">{schoolName}</div>
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
            <div className="mt-1 font-display text-3xl font-bold text-ink">{openCases}</div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-track">
              <div
                className="h-full rounded-full bg-linear-to-r from-brand to-accent"
                style={{ width: `${Math.min(100, openCases * 10)}%` }}
              ></div>
            </div>
            <div className="mt-2 text-[11px] text-soft">{criticalCount} critical — flagged for review</div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-3 md:gap-6">
          <div className="flex items-center gap-3 rounded-2xl border border-glass-line bg-glass px-4 py-3 shadow-panel-lg backdrop-blur-2xl md:hidden">
            <button
              type="button"
              aria-label="Open navigation menu"
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-navigation"
              onClick={() => setMobileMenuOpen((isOpen) => !isOpen)}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-ink transition hover:bg-glass-bright"
            >
              <Menu size={21} aria-hidden="true" />
            </button>
            <div className="min-w-0 flex-1">
              <div className="truncate font-display text-sm font-bold text-ink">{schoolName}</div>
              <div className="text-[10px] uppercase tracking-[0.14em] text-faint">Conduct &amp; Discipline</div>
            </div>
          </div>

          <header className="flex flex-wrap items-center gap-3 rounded-2xl border border-glass-line bg-glass px-4 py-3 shadow-panel-lg backdrop-blur-2xl md:flex-nowrap md:gap-4 md:rounded-3xl md:px-6 md:py-4">
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="font-display text-lg font-bold text-ink">{greeting}</div>
              <div className="text-[12px] text-soft">{dateLine}</div>
            </div>
            <div className="order-3 flex w-full min-w-0 items-center gap-2 rounded-2xl bg-glass-bright px-3 py-2 ring-1 ring-hairline md:order-none md:w-auto">
              <span className="text-sm text-faint">⌕</span>
              <input
                className="w-full bg-transparent text-sm text-body outline-none placeholder:text-faint md:w-52"
                placeholder="Search students, cases, actions"
              />
            </div>
            <div className="ml-auto flex max-w-full items-center gap-2 rounded-2xl bg-glass-bright px-2 py-1.5 ring-1 ring-hairline md:gap-3">
              <img
                src={profile?.avatar_url || avatar}
                alt={displayName}
                className="h-9 w-9 rounded-xl object-cover ring-1 ring-hairline"
              />
              <div className="hidden leading-tight sm:block">
                <div className="text-[13px] font-semibold text-ink">{displayName}</div>
                <div className="text-[11px] text-soft">
                  {profile?.job_title ?? roleLabelText ?? "Role pending"}
                </div>
              </div>
              {scopeBadge && (
                <span className="hidden rounded-lg bg-accent/10 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-accent ring-1 ring-accent/20 sm:inline">
                  {scopeBadge}
                </span>
              )}
              <span className="hidden rounded-lg bg-brand/10 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-brand ring-1 ring-brand/20 sm:inline">
                {roleLabelText ?? "Staff"}
              </span>
              <button
                type="button"
                onClick={async () => {
                  await signOut();
                  navigate({ to: "/auth", search: { message: null } });
                }}
                className="rounded-xl px-2 py-1 text-[11px] font-semibold text-soft transition hover:text-ink"
              >
                Sign out
              </button>
            </div>
          </header>

          <SupportViewBanner />

          {blocked ? (
            <div className="rounded-3xl border border-glass-line bg-glass p-10 shadow-panel backdrop-blur-2xl">
              <h2 className="font-display text-2xl font-bold text-ink">Access paused</h2>
              <p className="mt-2 max-w-md text-sm text-soft">{blocked}</p>
            </div>
          ) : needsSchoolPick ? (
            <SchoolPicker />
          ) : (
            children
          )}
        </div>
      </div>
    </div>
  );
}

export type { LinkProps };
