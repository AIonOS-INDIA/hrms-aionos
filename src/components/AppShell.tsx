import { useEffect, useMemo, useState, type ReactNode } from "react";
import aionosMark from "@/assets/aionos-mark.png";
import { NotificationBell } from "@/components/NotificationBell";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  Award,
  BadgeIndianRupee,
  Briefcase,
  Building2,
  CalendarDays,
  Clock3,
  FileSpreadsheet,
  FileText,
  GraduationCap,
  HeartPulse,
  IdCard,
  LayoutDashboard,
  LogOut,
  Menu,
  Scale,
  ReceiptText,
  Settings2,
  ShieldCheck,
  UserMinus,
  UserPlus,
  Users,
  Users2,
  Network,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Assistant } from "@/components/Assistant";
import {
  accentClass,
  initials,
  useCompanies,
  useHeadcounts,
  useMe,
  type Company,
  useAmIManager,
} from "@/lib/hrms";
import { ScopeContext, useScope, type ScopeValue } from "@/lib/scope";

export { useScope };
export type { ScopeValue };

type NavItem = {
  to: string;
  label: string;
  group: string;
  icon: LucideIcon;
  hrOnly: boolean;
  masterOnly?: boolean;
  managerOnly?: boolean;
};

const NAV: NavItem[] = [
  // Employee-facing, in the order a person uses them
  { to: "/dashboard", label: "Overview", group: "My workspace", icon: LayoutDashboard, hrOnly: false },
  { to: "/profile", label: "My record", group: "My workspace", icon: IdCard, hrOnly: false },
  {
    to: "/team",
    label: "My team",
    group: "My workspace",
    icon: Users2,
    hrOnly: false,
    managerOnly: true,
  },
  {
    to: "/org",
    label: "Org chart",
    group: "My workspace",
    icon: Network,
    hrOnly: false,
    managerOnly: true,
  },
  { to: "/onboarding", label: "Joining", group: "My workspace", icon: UserPlus, hrOnly: false },
  { to: "/separation", label: "Separation", group: "My workspace", icon: UserMinus, hrOnly: false },
  { to: "/timesheets", label: "Timesheets", group: "My workspace", icon: Clock3, hrOnly: false },
  { to: "/leave", label: "Leave", group: "My workspace", icon: CalendarDays, hrOnly: false },
  { to: "/performance", label: "Performance", group: "My workspace", icon: Award, hrOnly: false },
  { to: "/learning", label: "Learning", group: "My workspace", icon: GraduationCap, hrOnly: false },
  { to: "/payroll", label: "Payroll", group: "My workspace", icon: Wallet, hrOnly: false },
  { to: "/expenses", label: "Expenses", group: "My workspace", icon: ReceiptText, hrOnly: false },
  { to: "/benefits", label: "Benefits", group: "My workspace", icon: HeartPulse, hrOnly: false },
  { to: "/compliance", label: "Documents", group: "My workspace", icon: FileText, hrOnly: false },
  { to: "/policies", label: "Policies", group: "My workspace", icon: Scale, hrOnly: false },
  // HR operations
  { to: "/employees", label: "Employees", group: "HR operations", icon: Users, hrOnly: true },
  { to: "/recruitment", label: "Hiring", group: "HR operations", icon: Briefcase, hrOnly: true },
  { to: "/salary", label: "Salary setup", group: "HR operations", icon: BadgeIndianRupee, hrOnly: true },
  { to: "/finance", label: "Finance", group: "HR operations", icon: Wallet, hrOnly: true },
  {
    to: "/data-transfer",
    label: "Import & export",
    group: "HR operations",
    icon: FileSpreadsheet,
    hrOnly: true,
  },
  // Master only
  {
    to: "/entities",
    label: "Entity setup",
    group: "Administration",
    icon: Building2,
    hrOnly: true,
    masterOnly: true,
  },
  {
    to: "/hr-accounts",
    label: "Admin",
    group: "Administration",
    icon: Settings2,
    hrOnly: true,
    masterOnly: true,
  },
];

const NAV_GROUPS = ["My workspace", "HR operations", "Administration"] as const;

export function AppShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle: string;
  actions?: ReactNode | undefined;
  children: ReactNode;
}) {
  const { data: me } = useMe();
  const { data: companies = [] } = useCompanies();
  const { data: counts = {} } = useHeadcounts();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const isMaster = !!me?.isMaster;
  const hrCompanyIds = useMemo(() => me?.hrCompanyIds ?? [], [me]);
  const isHr = isMaster || hrCompanyIds.length > 0;
  const isManager = useAmIManager();
  const [selected, setSelected] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Entities this person may work in: everything for Master HR, the mapped
  // entities for company HR, their own entity for everyone else.
  const allowedCompanies = useMemo(() => {
    if (isMaster) return companies;
    if (hrCompanyIds.length) return companies.filter((c) => hrCompanyIds.includes(c.id));
    const own = me?.employee?.company_id;
    return companies.filter((c) => c.id === own);
  }, [companies, hrCompanyIds, isMaster, me?.employee?.company_id]);

  const companyId = isMaster
    ? selected
    : selected && allowedCompanies.some((c) => c.id === selected)
      ? selected
      : (allowedCompanies[0]?.id ?? null);

  const scope = useMemo<ScopeValue>(
    () => ({
      companyId,
      setCompanyId: setSelected,
      companies: allowedCompanies,
      companyById: (id: string) => companies.find((c) => c.id === id),
      canSeeAll: isMaster,
    }),
    [companyId, companies, allowedCompanies, isMaster],
  );

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/", replace: true });
  }

  const roleLabel = isMaster
    ? "Master HR · All entities"
    : hrCompanyIds.length
      ? `Company HR · ${
          hrCompanyIds.length > 1
            ? `${hrCompanyIds.length} entities`
            : (scope.companyById(hrCompanyIds[0]!)?.name ?? "")
        }`
      : `Employee · ${me?.employee ? (scope.companyById(me.employee.company_id)?.name ?? "") : ""}`;

  const visibleNav = NAV.filter(
    (n) => (!n.hrOnly || isHr) && (!n.masterOnly || isMaster) && (!n.managerOnly || isManager),
  );

  const sidebar = (
    <div className="flex h-full flex-col bg-[linear-gradient(180deg,var(--color-brand-soft)_0%,var(--color-panel)_38%)] backdrop-blur-xl">
      <div className="flex items-center gap-2.5 h-16 px-5 shrink-0">
        <div className="size-9 rounded-xl bg-paper grid place-items-center p-1.5 ring-1 ring-brand/25 shadow-sm">
          <img src={aionosMark} alt="AIONOS logo" className="size-full object-contain" />
        </div>
        <div>
          <p className="text-[14px] font-semibold leading-none tracking-tight">AIONOS</p>
          <p className="label-mono mt-1">HR Control Tower</p>
        </div>
        <button
          onClick={() => setMobileOpen(false)}
          className="md:hidden ml-auto size-8 grid place-items-center rounded-lg hover:bg-ink/5 cursor-pointer"
          aria-label="Close menu"
        >
          <X className="size-4" />
        </button>
      </div>

      <nav className="px-3 pt-1 pb-4 space-y-5 flex-1 min-h-0 overflow-y-auto">
        {NAV_GROUPS.map((group) => {
          const items = visibleNav.filter((n) => n.group === group);
          if (items.length === 0) return null;
          return (
            <div key={group}>
              <p className="label-mono px-2 mb-2">{group}</p>
              <div className="space-y-0.5 text-[13px]">
                {items.map((n) => {
                  const active = pathname === n.to;
                  const Icon = n.icon;
                  return (
                    <Link
                      key={n.to}
                      to={n.to}
                      preload="intent"
                      className={`group relative flex items-center gap-2.5 px-3 py-2 rounded-xl transition-colors ${
                        active
                          ? "bg-brand/12 font-medium text-brand-deep ring-1 ring-brand/20"
                          : "text-ink-soft hover:bg-brand/8 hover:text-brand-deep"
                      }`}
                    >
                      <span
                        className={`absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-full transition-opacity ${
                          active ? "bg-brand opacity-100" : "opacity-0"
                        }`}
                      />
                      <Icon
                        className={`size-4 shrink-0 ${active ? "text-brand" : "text-ink-soft"}`}
                      />
                      <span className="truncate">{n.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="shrink-0 px-3 py-3 border-t border-line">
        <div className="flex items-center gap-2.5 px-2">
          <div className="size-9 rounded-xl bg-[linear-gradient(140deg,var(--color-brand-deep),var(--color-brand))] grid place-items-center text-paper text-[12px] font-semibold font-mono shrink-0">
            {initials(me?.employee?.full_name ?? me?.email ?? "??")}
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-medium truncate">
              {me?.employee?.full_name ?? me?.email}
            </p>
            <p className="label-mono truncate">{roleLabel}</p>
          </div>
        </div>
        <button
          onClick={signOut}
          className="mt-3 w-full h-9 rounded-xl text-[12px] font-medium ring-1 ring-line hover:bg-ink/5 cursor-pointer inline-flex items-center justify-center gap-2"
        >
          <LogOut className="size-3.5" />
          Sign out
        </button>
      </div>
    </div>
  );

  return (
    <ScopeContext.Provider value={scope}>
      <div className="min-h-screen bg-paper text-ink">
        <aside className="hidden md:block fixed inset-y-0 left-0 w-64 border-r border-line">
          {sidebar}
        </aside>

        {mobileOpen && (
          <div className="md:hidden fixed inset-0 z-40">
            <button
              aria-label="Close menu"
              onClick={() => setMobileOpen(false)}
              className="absolute inset-0 bg-ink/30 backdrop-blur-[2px]"
            />
            <div className="absolute inset-y-0 left-0 w-72 border-r border-line shadow-xl bg-panel">
              {sidebar}
            </div>
          </div>
        )}

        <main className="md:pl-64">
          <header className="sticky top-0 z-20 bg-paper/85 backdrop-blur-xl border-b border-brand/15">
            <div className="h-16 flex items-center gap-3 px-4 lg:px-8">
              <button
                onClick={() => setMobileOpen(true)}
                className="md:hidden size-9 grid place-items-center rounded-xl ring-1 ring-line hover:bg-ink/5 cursor-pointer"
                aria-label="Open menu"
              >
                <Menu className="size-4" />
              </button>
              <div className="min-w-0 hidden sm:block sm:w-56 lg:w-64 shrink-0">
                <h1 className="text-[15px] font-semibold leading-none tracking-tight truncate">
                  {title}
                </h1>
                <p className="label-mono mt-1.5 truncate">{subtitle}</p>
              </div>
              <div className="flex-1 min-w-0 flex justify-center">
                <div className="w-full max-w-xl">
                  <Assistant />
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {isMaster && (
                  <span className="hidden xl:inline-flex items-center gap-1.5 h-8 px-2.5 rounded-full ring-1 ring-line text-[11px] font-medium text-ink-soft">
                    <ShieldCheck className="size-3.5" />
                    {companyId === null
                      ? "All entities"
                      : (scope.companyById(companyId)?.name ?? "Entity")}
                  </span>
                )}
                {actions}
                <NotificationBell />
              </div>
            </div>
          </header>
          <div className="px-4 lg:px-8 py-6 pb-16">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className="label-mono mr-1">Entity scope</span>
              {isMaster && (
                <button
                  onClick={() => setSelected(null)}
                  className={`inline-flex items-center gap-2 h-8 pl-2.5 pr-3 rounded-full transition-colors cursor-pointer ${
                    companyId === null
                      ? "bg-[linear-gradient(100deg,var(--color-brand-deep),var(--color-brand))] text-paper shadow-sm"
                      : "ring-1 ring-line hover:bg-brand/8"
                  }`}
                >
                  <span className="size-2 rounded-[3px] bg-volt shrink-0" />
                  <span className="text-[12px] font-medium">All entities</span>
                  <span
                    className={`text-[10px] font-mono ${companyId === null ? "text-paper/70" : "text-ink-soft"}`}
                  >
                    ALL
                  </span>
                </button>
              )}
              {allowedCompanies.map((c) => {
                const switchable = isMaster || allowedCompanies.length > 1;
                return (
                  <button
                    key={c.id}
                    disabled={!switchable}
                    onClick={() => setSelected(c.id)}
                    className={`inline-flex items-center gap-2 h-8 pl-2.5 pr-3 rounded-full transition-colors ${
                      companyId === c.id
                        ? "bg-[linear-gradient(100deg,var(--color-brand-deep),var(--color-brand))] text-paper shadow-sm"
                        : "ring-1 ring-line hover:bg-brand/8"
                    } ${switchable ? "cursor-pointer" : "cursor-default"}`}
                  >
                    <span
                      className={`size-2 rounded-[3px] shrink-0 ${accentClass[c.accent] ?? "bg-ink"} ${
                        companyId === c.id && c.accent === "aionos" ? "bg-volt" : ""
                      }`}
                    />
                    <span
                      className={`text-[12px] font-medium ${companyId === c.id ? "" : "text-ink-soft"}`}
                    >
                      {c.name}
                      {c.is_parent ? " (Parent)" : ""}
                    </span>
                    <span
                      className={`text-[10px] font-mono ${companyId === c.id ? "text-paper/70" : "text-ink-soft"}`}
                    >
                      {counts[c.id] ?? 0}
                    </span>
                  </button>
                );
              })}
            </div>
            {children}
          </div>
        </main>
      </div>
    </ScopeContext.Provider>
  );
}

export function FilterNote({
  label,
  count,
  onClear,
}: {
  label: string;
  count: number;
  onClear: () => void;
}) {
  return (
    <div className="mt-3 flex items-center gap-2">
      <span className="text-[12px] text-ink-soft">
        Showing <b className="text-ink capitalize">{label}</b> · {count} records
      </span>
      <button
        type="button"
        onClick={onClear}
        className="h-7 px-3 rounded-full ring-1 ring-line text-[12px] cursor-pointer hover:bg-ink/5"
      >
        Clear filter ✕
      </button>
    </div>
  );
}

export function StatCard({
  label,
  value,
  suffix,
  hint,
  hintTone = "soft",
  onClick,
  active,
}: {
  label: string;
  value: string | number;
  suffix?: string | undefined;
  hint?: string | undefined;
  hintTone?: "soft" | "good" | "warn" | undefined;
  onClick?: (() => void) | undefined;
  active?: boolean | undefined;
}) {
  const tone =
    hintTone === "good" ? "text-perp" : hintTone === "warn" ? "text-whilter" : "text-ink-soft";
  const body = (
    <>
      <p className="label-mono">{label}</p>
      <p className="text-3xl font-semibold leading-none tracking-tight mt-2">
        {value}
        {suffix ? <span className="text-lg align-top">{suffix}</span> : null}
      </p>
      {hint ? <p className={`text-[11px] font-mono mt-2 ${tone}`}>{hint}</p> : null}
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={!!active}
        className={`text-left w-full p-4 rounded-[14px] ring-1 transition-all cursor-pointer hover:shadow-sm ${
          active ? "bg-brand/10 ring-brand/40" : "bg-panel ring-black/5 hover:bg-brand/[0.05]"
        }`}
      >
        {body}
      </button>
    );
  }
  return (
    <div className="bg-panel p-4 rounded-[14px] ring-1 ring-black/5 transition-shadow hover:shadow-sm">
      {body}
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: "bg-perp/10 text-perp",
    approved: "bg-perp/10 text-perp",
    submitted: "bg-cloud/10 text-cloud",
    pending: "bg-whilter/10 text-whilter",
    on_leave: "bg-whilter/10 text-whilter",
    onboarding: "bg-line/70 text-ink-soft",
    draft: "bg-line/70 text-ink-soft",
    offboarded: "bg-ink/10 text-ink-soft",
    rejected: "bg-destructive/10 text-destructive",
    cancelled: "bg-ink/10 text-ink-soft",
  };
  const cls = map[status] ?? "bg-line/70 text-ink-soft";
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium ${cls}`}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {status.replace("_", " ")}
    </span>
  );
}

export function EntityTag({ company }: { company?: Company | undefined }) {
  if (!company) return <span className="text-ink-soft">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px]">
      <span className={`size-2 rounded-[3px] shrink-0 ${accentClass[company.accent] ?? "bg-ink"}`} />
      {company.name}
    </span>
  );
}

export function Panel({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: ReactNode | undefined;
  children: ReactNode;
}) {
  return (
    <div className="bg-panel ring-1 ring-black/5 rounded-[14px] overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-2 min-h-11 border-b border-line">
        <p className="label-mono min-w-0">{title}</p>
        {meta}
      </div>
      {children}
    </div>
  );
}
