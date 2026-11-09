import { Link, LinkProps, useNavigate, useRouterState } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Home,
  Menu,
  ScrollText,
  Settings2,
  Users,
  Building2,
  type LucideIcon,
} from "lucide-react";
import avatar from "@/assets/avatar.png";
import { useAuth } from "@/hooks/useAuth";
import { useSchoolSettings } from "@/hooks/useSchoolSettings";
import { useConductStandings } from "@/hooks/useConductStandings";
import { SchoolPicker, SupportViewBanner } from "@/components/SupportView";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

// Pages that show one school's data. The platform owner must pick a school (support view) first.
const SCHOOL_PAGES = new Set(["/", "/students", "/conduct-actions", "/reports", "/audit-logs"]);

const NAV_ITEMS = [
  { label: "Dashboard", to: "/", icon: Home, disciplineOnly: false },
  { label: "Students", to: "/students", icon: Users, disciplineOnly: false },
  { label: "Conduct Actions", to: "/conduct-actions", icon: ClipboardList, disciplineOnly: false },
  { label: "Reports", to: "/reports", icon: BarChart3, disciplineOnly: false },
  { label: "Audit Logs", to: "/audit-logs", icon: ScrollText, disciplineOnly: false },
  { label: "Settings", to: "/settings", icon: Settings2, disciplineOnly: false },
  { label: "Platform", to: "/platform", icon: Building2, disciplineOnly: false, adminOnly: true },
] as {
  label: string;
  to: "/" | "/students" | "/conduct-actions" | "/reports" | "/audit-logs" | "/settings" | "/platform";
  icon: LucideIcon;
  disciplineOnly: boolean;
  adminOnly?: boolean;
}[];

type NavItem = (typeof NAV_ITEMS)[number];

function SidebarLink({
  item,
  active,
  onNavigate,
  collapsed = false,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      activeOptions={{ exact: true }}
      onClick={onNavigate}
      title={collapsed ? item.label : undefined}
      aria-label={collapsed ? item.label : undefined}
      className={
        active
          ? `flex items-center ${collapsed ? "justify-center" : "gap-3"} rounded-2xl bg-brand/10 px-3 py-2.5 ring-1 ring-brand/20`
          : `flex items-center ${collapsed ? "justify-center" : "gap-3"} rounded-2xl px-3 py-2.5 transition hover:bg-glass-bright`
      }
    >
      <span
        className={
          active
            ? "grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand text-white shadow-brand-glow"
            : "grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-glass-bright text-soft ring-1 ring-hairline"
        }
      >
        <Icon size={18} aria-hidden="true" />
      </span>
      {!collapsed && <span className={active ? "text-sm font-semibold text-ink" : "text-sm font-medium text-body"}>{item.label}</span>}
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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
  const breadcrumbs = getBreadcrumbs(pathname, greeting);
  const backPath = getBackPath(pathname);

  return (
    <div className="relative min-h-screen overflow-x-clip font-sans text-body antialiased">
      <div className="app-canvas" />
      <div className="bloom bloom-a" />
      <div className="bloom bloom-b" />
      <div className="bloom bloom-c" />

      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent id="mobile-navigation" side="left" className="w-[min(20rem,85vw)] max-w-[20rem] overflow-y-auto border-r border-glass-line bg-glass p-4 shadow-panel-lg backdrop-blur-2xl md:hidden">
          <SheetTitle className="sr-only">Main navigation</SheetTitle>
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
                    active={pathname === item.to || (item.to !== "/" && pathname.startsWith(`${item.to}/`))}
                    onNavigate={() => setMobileMenuOpen(false)}
                  />
                ))}
              </nav>
            </div>
        </SheetContent>
      </Sheet>

      <div className="relative mx-auto flex min-h-screen max-w-[1440px] gap-3 p-3 md:gap-6 md:p-6">
        <aside className={`hidden shrink-0 rounded-3xl border border-glass-line bg-glass shadow-panel-lg backdrop-blur-2xl transition-[width] duration-300 md:block ${sidebarCollapsed ? "w-20" : "w-64"}`}>
          <div className={`flex items-center ${sidebarCollapsed ? "justify-center px-3" : "gap-3 px-6"} py-6`}>
            {school?.logo_url ? (
              <img src={school.logo_url} alt="School logo" className="h-11 w-11 rounded-2xl object-cover ring-1 ring-hairline" />
            ) : (
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-linear-to-br from-brand to-accent text-on-brand shadow-brand-glow">
                <span className="font-display text-lg font-bold">S</span>
              </div>
            )}
            {!sidebarCollapsed && <div className="min-w-0 leading-tight">
              <div className="font-display text-[15px] font-bold text-ink">{schoolName}</div>
              <div className="text-[11px] uppercase tracking-[0.14em] text-faint">
                Conduct &amp; Discipline
              </div>
            </div>}
          </div>
          <div className={sidebarCollapsed ? "px-2" : "px-4"}>
            <button
              type="button"
              onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              className={`mb-3 flex h-9 w-full items-center rounded-xl text-soft transition hover:bg-glass-bright hover:text-ink ${sidebarCollapsed ? "justify-center" : "justify-end px-3"}`}
            >
              {sidebarCollapsed ? <ChevronRight size={18} aria-hidden="true" /> : <ChevronLeft size={18} aria-hidden="true" />}
            </button>
            {!sidebarCollapsed && (
            <div className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-faint">
              Main
            </div>
            )}
            <nav aria-label="Main navigation" className="space-y-1">
              {navItems.map((item) => (
              <SidebarLink key={item.to} item={item} active={pathname === item.to || (item.to !== "/" && pathname.startsWith(`${item.to}/`))} collapsed={sidebarCollapsed} />
              ))}
            </nav>
          </div>
          {!sidebarCollapsed && <div className="m-4 mt-6 rounded-2xl border border-glass-line bg-glass-soft p-4">
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
          </div>}
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

          <header className="flex flex-wrap items-center gap-3 rounded-2xl border border-glass-line bg-glass px-4 py-3 shadow-panel-lg backdrop-blur-2xl lg:flex-nowrap lg:gap-4 lg:rounded-3xl lg:px-6 lg:py-4">
            <div className="order-first flex w-full min-w-0 items-center gap-3 lg:order-none lg:w-auto lg:flex-1">
              {backPath && (
                <button
                  type="button"
                  onClick={() => navigate({ to: backPath })}
                  className="inline-flex shrink-0 items-center gap-1 rounded-xl px-2 py-1.5 text-xs font-semibold text-soft transition hover:bg-glass-bright hover:text-ink"
                >
                  <ChevronLeft size={15} aria-hidden="true" />
                  Back
                </button>
              )}
              <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 overflow-hidden text-xs text-soft">
                {breadcrumbs.map((crumb, index) => (
                  <span key={`${crumb}-${index}`} className="flex min-w-0 shrink-0 items-center gap-1.5">
                    {index > 0 && <span className="text-faint">/</span>}
                    {index === breadcrumbs.length - 1 ? (
                      <span className="truncate font-semibold text-ink">{crumb}</span>
                    ) : crumb === "Home" ? (
                      <Link to="/" className="truncate transition hover:text-ink">{crumb}</Link>
                    ) : crumb === "Settings" ? (
                      <Link to="/settings" className="truncate transition hover:text-ink">{crumb}</Link>
                    ) : crumb === "Certificates" ? (
                      <Link to="/settings/certificates" className="truncate transition hover:text-ink">{crumb}</Link>
                    ) : <span className="truncate">{crumb}</span>}
                  </span>
                ))}
              </nav>
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="font-display text-lg font-bold text-ink">{greeting}</div>
              <div className="text-[12px] text-soft">{dateLine}</div>
            </div>
            <div className="order-3 flex w-full min-w-0 items-center gap-2 rounded-2xl bg-glass-bright px-3 py-2 ring-1 ring-hairline lg:order-none lg:w-auto">
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

function getBreadcrumbs(pathname: string, currentLabel: string) {
  const segments = pathname.split("/").filter(Boolean);
  const labels: Record<string, string> = {
    settings: "Settings",
    certificates: "Certificates",
    bulk: "Bulk Certificates",
    students: "Students",
    "conduct-actions": "Conduct Actions",
    reports: "Reports",
    "audit-logs": "Audit Logs",
    platform: "Platform",
    certificate: "Certificate",
  };
  const crumbs = ["Home"];
  for (const segment of segments) {
    const label = labels[segment];
    if (label && crumbs[crumbs.length - 1] !== label) crumbs.push(label);
  }
  if (crumbs.length === 1 || crumbs[crumbs.length - 1] !== currentLabel) crumbs.push(currentLabel);
  return crumbs;
}

function getBackPath(pathname: string): "/" | "/settings" | "/settings/certificates" | "/conduct-actions" | "/students" | "/reports" | "/audit-logs" | "/platform" | null {
  if (pathname.startsWith("/settings/")) return "/settings";
  if (pathname === "/certificates/bulk") return "/settings/certificates";
  if (pathname.startsWith("/certificate/")) return "/conduct-actions";
  if (pathname.startsWith("/students/")) return "/students";
  if (pathname.startsWith("/conduct-actions/")) return "/conduct-actions";
  if (pathname.startsWith("/reports/")) return "/reports";
  if (pathname.startsWith("/audit-logs/")) return "/audit-logs";
  if (pathname.startsWith("/platform/")) return "/platform";
  if (pathname !== "/" && !["/students", "/conduct-actions", "/reports", "/audit-logs", "/settings", "/platform"].includes(pathname)) {
    return "/";
  }
  return null;
}
