import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { AppShell, EntityTag, Panel, StatCard, StatusPill, useScope } from "@/components/AppShell";
import {
  fmtDate,
  initials,
  useEmployeeGoals,
  useEmployees,
  useLeaveBalances,
  useMyReportingChain,
  usePerformanceReviews,

  useHolidays,
  useLeaveRequests,
  useLeaveTypes,
  useMe,
  usePolicies,
  useSubsidiaryRequestAlerts,
  useSubsidiaryRequests,
  useTimesheets,
  useMyOrg,
  LEVEL_LABEL,
  useExpenseClaims,
  useSeparationRequests,
} from "@/lib/hrms";


export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Overview — AIONOS HR Control Tower" },
      {
        name: "description",
        content:
          "Cross-entity people overview for AIONOS, Perpetuuiti, Whilter and Cloud Analogy: headcount, leave and timesheet compliance.",
      },
      { property: "og:title", content: "Overview — AIONOS HR Control Tower" },
      {
        property: "og:description",
        content: "Cross-entity people overview across the AIONOS group.",
      },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  return (
    <AppShell title="Overview" subtitle="Radar · live">
      <DashboardBody />
    </AppShell>
  );
}

function DashboardBody() {
  const { data: me } = useMe();
  const navigate = useNavigate();
  const { companyId, setCompanyId, companies, companyById, canSeeAll } = useScope();
  const { data: employees = [] } = useEmployees();
  const { data: leave = [] } = useLeaveRequests();
  const { data: leaveTypes = [] } = useLeaveTypes();
  const { data: timesheets = [] } = useTimesheets();
  const { data: policies = [] } = usePolicies();
  const { data: holidays = [] } = useHolidays();

  const isHr = !!me?.isMaster || !!me?.hrCompanyId;

  const scoped = useMemo(
    () => (companyId ? employees.filter((e) => e.company_id === companyId) : employees),
    [employees, companyId],
  );
  const scopedIds = useMemo(() => new Set(scoped.map((e) => e.id)), [scoped]);
  const scopedLeave = leave.filter((l) => scopedIds.has(l.employee_id));
  const scopedSheets = timesheets.filter((t) => scopedIds.has(t.employee_id));

  const active = scoped.filter((e) => e.status !== "offboarded");
  const onboarding = scoped.filter((e) => e.status === "onboarding");
  const pendingLeave = scopedLeave.filter((l) => l.status === "pending");
  const pendingSheets = scopedSheets.filter((t) => t.status === "submitted");
  const compliance = scopedSheets.length
    ? Math.round(
        (scopedSheets.filter((t) => t.status !== "draft").length / scopedSheets.length) * 100,
      )
    : 0;

  if (!isHr) return <EmployeeHome />;

  const locations = Array.from(new Set(holidays.map((h) => h.location)));

  return (
    <>
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-line ring-1 ring-black/5 rounded-[14px] overflow-hidden">
        <StatCard
          label="Total headcount"
          value={active.length}
          hint={`${onboarding.length} onboarding`}
          hintTone="good"
          onClick={() => navigate({ to: "/employees" })}
        />
        <StatCard
          label="Pending leave"
          value={pendingLeave.length}
          hint={`${scopedLeave.length} requests in total`}
          hintTone={pendingLeave.length ? "warn" : "soft"}
          onClick={() => navigate({ to: "/leave" })}
        />
        <StatCard
          label="Timesheets awaiting"
          value={pendingSheets.length}
          hint={`${scopedSheets.length} weeks logged`}
          onClick={() => navigate({ to: "/timesheets" })}
        />
        <StatCard
          label="Timesheet compliance"
          value={compliance}
          suffix="%"
          hint="Submitted or approved"
          hintTone={compliance >= 90 ? "good" : "warn"}
          onClick={() => navigate({ to: "/timesheets" })}
        />
      </section>

      {canSeeAll && <RequestAlerts />}

      <section className="mt-6 flex items-end justify-between flex-wrap gap-3">

        <div>
          <h1 className="text-2xl font-semibold tracking-tight max-w-[20ch] text-balance">
            {companyId ? (companyById(companyId)?.name ?? "Entity") : "Entity health radar"}
          </h1>
          <p className="text-sm text-ink-soft mt-1 max-w-[48ch] text-pretty">
            {canSeeAll
              ? "Live snapshot across every company: people, leave and timesheets."
              : "Live snapshot for your company: people, leave and timesheets."}
          </p>
        </div>
      </section>

      {canSeeAll && (
        <>
          <div className="mt-4 flex items-center gap-2 flex-wrap">
            <span className="label-mono mr-1">Filter</span>
            <button
              onClick={() => setCompanyId(null)}
              className={`h-8 px-3 rounded-md text-[12px] font-medium cursor-pointer ring-1 ${
                companyId ? "ring-line hover:bg-ink/5" : "ring-ink bg-brand text-paper"
              }`}
            >
              All entities
            </button>
            {companies.map((c) => (
              <button
                key={c.id}
                onClick={() => setCompanyId(c.id)}
                className={`h-8 px-3 rounded-md text-[12px] font-medium cursor-pointer ring-1 ${
                  companyId === c.id ? "ring-ink bg-brand text-paper" : "ring-line hover:bg-ink/5"
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>

          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            {companies
              .filter((c) => !companyId || c.id === companyId)
              .map((c) => {
                const staff = employees.filter(
                  (e) => e.company_id === c.id && e.status !== "offboarded",
                );
                const ids = new Set(staff.map((e) => e.id));
                const p = leave.filter(
                  (l) => ids.has(l.employee_id) && l.status === "pending",
                ).length;
                const approvedSheets = timesheets.filter(
                  (t) => ids.has(t.employee_id) && t.status === "approved",
                ).length;
                const submittedSheets = timesheets.filter(
                  (t) => ids.has(t.employee_id) && t.status === "submitted",
                ).length;
                return (
                  <button
                    key={c.id}
                    onClick={() => setCompanyId(companyId === c.id ? null : c.id)}
                    className={`text-left bg-panel rounded-[14px] p-4 cursor-pointer transition-shadow ring-1 ${
                      companyId === c.id ? "ring-ink" : "ring-black/5 hover:ring-ink/30"
                    }`}
                  >
                    <EntityTag company={c} />
                    <p className="text-2xl font-semibold tracking-tight mt-3">{staff.length}</p>
                    <p className="label-mono mt-1">Employees</p>
                    <div className="mt-3 pt-3 border-t border-line grid grid-cols-2 gap-2">
                      <div>
                        <p className="text-[15px] font-semibold tracking-tight">{p}</p>
                        <p className="label-mono mt-0.5">Leave pending</p>
                      </div>
                      <div>
                        <p className="text-[15px] font-semibold tracking-tight">{approvedSheets}</p>
                        <p className="label-mono mt-0.5">Sheets approved</p>
                      </div>
                    </div>
                    <p className="mt-3 text-[11px] font-mono text-ink-soft">
                      {submittedSheets} awaiting · {c.email_domain}
                    </p>
                  </button>
                );
              })}
          </div>
        </>
      )}


      <ManagerStrip />

      <div className="mt-4 grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2">
          <Panel
            title={`Roster · ${scoped.length} records`}
            meta={
              <Link to="/employees" className="text-[11px] font-mono text-ink-soft hover:text-ink">
                Open employees →
              </Link>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left label-mono border-b border-line">
                    <th className="px-4 py-2.5 font-medium">Employee</th>
                    <th className="px-4 py-2.5 font-medium">Entity</th>
                    <th className="px-4 py-2.5 font-medium">Role</th>
                    <th className="px-4 py-2.5 font-medium">Location</th>
                    <th className="px-4 py-2.5 font-medium text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {scoped.slice(0, 8).map((e) => (
                    <tr key={e.id} className="hover:bg-ink/[0.03]">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="size-8 rounded-md bg-line grid place-items-center text-[10px] font-mono font-medium text-ink-soft shrink-0">
                            {initials(e.full_name)}
                          </div>
                          <div>
                            <p className="font-medium leading-tight">{e.full_name}</p>
                            <p className="text-[11px] font-mono text-ink-soft">{e.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <EntityTag company={companyById(e.company_id)} />
                      </td>
                      <td className="px-4 py-3 text-ink-soft">{e.job_title}</td>
                      <td className="px-4 py-3 text-ink-soft">{e.location}</td>
                      <td className="px-4 py-3 text-right">
                        <StatusPill status={e.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>

        <aside className="panelin">
          <Panel title="Approvals queue">
            <div className="p-4 space-y-3">
              {pendingLeave.slice(0, 4).map((l) => {
                const emp = employees.find((e) => e.id === l.employee_id);
                const type = leaveTypes.find((t) => t.id === l.leave_type_id);
                return (
                  <div key={l.id} className="rounded-md bg-paper ring-1 ring-black/5 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[13px] font-medium">{emp?.full_name}</p>
                      <StatusPill status={l.status} />
                    </div>
                    <p className="text-[11px] font-mono text-ink-soft mt-1">
                      {type?.name} · {l.days}d · {fmtDate(l.start_date)}
                    </p>
                  </div>
                );
              })}
              {!pendingLeave.length && (
                <p className="text-[13px] text-ink-soft">Nothing awaiting your decision.</p>
              )}
              <Link
                to="/leave"
                className="block w-full h-10 rounded-md bg-brand text-paper text-[13px] font-semibold grid place-items-center hover:bg-brand-deep"
              >
                Review leave requests
              </Link>
            </div>
          </Panel>
        </aside>
      </div>

      <section className="mt-6 bg-brand text-paper rounded-[14px] overflow-hidden">
        <div className="flex items-center gap-3 px-5 h-12 border-b border-white/10 flex-wrap">
          <span className="size-2.5 rounded-[3px] bg-volt shrink-0" />
          <p className="text-[13px] font-semibold tracking-tight">Policy overview</p>
          <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-paper/50">
            Holidays, leave rules and published policies
          </span>
          <span className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-volt/15 text-volt text-[11px] font-medium">
            <span className="size-1.5 bg-volt rounded-full" />
            {me?.isMaster ? "You can edit" : "Active"}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-white/10">
          <div className="p-5">
            <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-paper/50">
              Holiday calendar
            </p>
            <p className="text-[15px] font-medium mt-2">
              Location-aware · {holidays.length} dates
            </p>
            <p className="text-[12px] text-paper/60 mt-1">{locations.join(" · ")}</p>
          </div>
          <div className="p-5">
            <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-paper/50">
              Leave policy
            </p>
            <p className="text-[15px] font-medium mt-2">
              {leaveTypes.map((t) => `${t.annual_days} ${t.code.toLowerCase()}`).join(" + ")}
            </p>
            <p className="text-[12px] text-paper/60 mt-1">Applies to every group entity</p>
          </div>
          <div className="p-5">
            <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-paper/50">
              Group policies
            </p>
            <p className="text-[15px] font-medium mt-2">{policies.length} published</p>
            <Link to="/policies" className="text-[12px] text-volt mt-1 inline-block">
              Open policy library →
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

function EmployeeHome() {
  const { data: me } = useMe();
  const navigate = useNavigate();
  const { data: leave = [] } = useLeaveRequests();
  const { data: leaveTypes = [] } = useLeaveTypes();
  const { data: timesheets = [] } = useTimesheets();
  const { data: holidays = [] } = useHolidays();
  const emp = me?.employee;
  const { data: balances = [] } = useLeaveBalances(emp?.id);
  const { data: goals = [] } = useEmployeeGoals();
  const { data: reviews = [] } = usePerformanceReviews();
  const { data: ladder = [] } = useMyReportingChain(!!emp);

  const myHolidays = holidays.filter((h) => h.location === emp?.location).slice(0, 4);
  const pending = leave.filter((l) => l.status === "pending").length;
  const thisWeek = timesheets[0];

  const myGoals = goals.filter((g) => g.employee_id === emp?.id && g.status !== "draft");
  const activeGoals = myGoals.filter((g) => g.status === "active");
  const avgProgress = myGoals.length
    ? Math.round(myGoals.reduce((s, g) => s + (g.progress ?? 0), 0) / myGoals.length)
    : 0;
  const sharedReviews = reviews.filter((r) => r.employee_id === emp?.id && r.status === "shared");
  const latestReview = sharedReviews[0];

  const balanceRows = balances
    .map((b) => {
      const type = leaveTypes.find((t) => t.id === b.leave_type_id);
      const entitled = Number(b.entitled_days ?? 0);
      const used = Number(b.used_days ?? 0);
      return {
        id: b.id,
        name: type?.name ?? "Leave",
        code: type?.code ?? "",
        entitled,
        used,
        left: Math.max(entitled - used, 0),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const daysLeft = balanceRows.reduce((s, b) => s + b.left, 0);

  return (
    <>
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-line ring-1 ring-black/5 rounded-[14px] overflow-hidden">
        <StatCard
          label="Leave days left"
          value={daysLeft}
          hint={`${pending} request${pending === 1 ? "" : "s"} pending`}
          hintTone={pending ? "warn" : "soft"}
          onClick={() => navigate({ to: "/leave" })}
        />
        <StatCard
          label="Goal progress"
          value={avgProgress}
          suffix="%"
          hint={`${activeGoals.length} active goal${activeGoals.length === 1 ? "" : "s"}`}
          hintTone={avgProgress >= 70 ? "good" : "soft"}
          onClick={() => navigate({ to: "/performance" })}
        />
        <StatCard
          label="Timesheet weeks"
          value={timesheets.length}
          hint={thisWeek ? `latest ${thisWeek.status}` : "none yet"}
          onClick={() => navigate({ to: "/timesheets" })}
        />
        <StatCard
          label="Latest rating"
          value={latestReview ? Number(latestReview.rating).toFixed(1) : "—"}
          hint={latestReview ? latestReview.period : "no review shared yet"}
          onClick={() => navigate({ to: "/performance" })}
        />
      </section>

      <h1 className="mt-6 text-2xl font-semibold tracking-tight">
        Welcome back, {emp?.full_name?.split(" ")[0] ?? "there"}
      </h1>
      <p className="text-sm text-ink-soft mt-1 max-w-[52ch] text-pretty">
        {emp?.job_title} · {emp?.department} · {emp?.location}. Everything below is your own record:
        goals, leave balance, timesheets and who you report to.
      </p>

      <div className="mt-4 grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 space-y-4">
          <Panel
            title={`My goals · ${myGoals.length}`}
            meta={
              <Link to="/performance" className="text-[11px] font-mono text-ink-soft hover:text-ink">
                Open performance →
              </Link>
            }
          >
            <div className="divide-y divide-line">
              {myGoals.map((g) => (
                <div key={g.id} className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium truncate">{g.title}</p>
                      <p className="text-[11px] font-mono text-ink-soft">
                        due {fmtDate(g.target_date)} · weight {g.weight}
                      </p>
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                      <span className="text-[12px] font-mono text-ink-soft">{g.progress}%</span>
                      <StatusPill status={g.status} />
                    </div>
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-line overflow-hidden">
                    <div
                      className="h-full bg-brand rounded-full"
                      style={{ width: `${Math.min(Math.max(g.progress, 0), 100)}%` }}
                    />
                  </div>
                </div>
              ))}
              {!myGoals.length && (
                <p className="px-4 py-6 text-[13px] text-ink-soft">No goals set for you yet.</p>
              )}
            </div>
          </Panel>

          <Panel title="Leave balance">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left label-mono border-b border-line">
                    <th className="px-4 py-2.5 font-medium">Type</th>
                    <th className="px-4 py-2.5 font-medium text-right">Entitled</th>
                    <th className="px-4 py-2.5 font-medium text-right">Used</th>
                    <th className="px-4 py-2.5 font-medium text-right">Remaining</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {balanceRows.map((b) => (
                    <tr key={b.id}>
                      <td className="px-4 py-2.5 font-medium">{b.name}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-ink-soft">
                        {b.entitled}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-ink-soft">{b.used}</td>
                      <td className="px-4 py-2.5 text-right font-mono font-semibold">{b.left}</td>
                    </tr>
                  ))}
                  {!balanceRows.length && (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-[13px] text-ink-soft">
                        No balance recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="p-4 border-t border-line flex gap-2">
              <Link
                to="/leave"
                className="h-10 px-4 rounded-md bg-brand text-paper text-[13px] font-semibold grid place-items-center hover:bg-brand-deep"
              >
                Apply for leave
              </Link>
              <Link
                to="/timesheets"
                className="h-10 px-4 rounded-md ring-1 ring-line text-[13px] font-medium grid place-items-center hover:bg-ink/5"
              >
                Fill timesheet
              </Link>
            </div>
          </Panel>

          <Panel title="Recent leave">
            <div className="divide-y divide-line">
              {leave.slice(0, 5).map((l) => (
                <div key={l.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium">
                      {leaveTypes.find((t) => t.id === l.leave_type_id)?.name}
                    </p>
                    <p className="text-[11px] font-mono text-ink-soft">
                      {fmtDate(l.start_date)} → {fmtDate(l.end_date)} · {l.days}d
                    </p>
                  </div>
                  <div className="ml-auto">
                    <StatusPill status={l.status} />
                  </div>
                </div>
              ))}
              {!leave.length && (
                <p className="px-4 py-6 text-[13px] text-ink-soft">No leave requests yet.</p>
              )}
            </div>
          </Panel>
        </div>

        <aside className="space-y-4">
          <Panel title="Reporting line">
            <div className="p-4">
              <div className="flex items-center gap-2.5">
                <div className="size-8 rounded-md bg-brand text-paper grid place-items-center text-[10px] font-mono font-medium shrink-0">
                  {initials(emp?.full_name ?? "")}
                </div>
                <div className="min-w-0">
                  <p className="text-[13px] font-medium truncate">{emp?.full_name} (you)</p>
                  <p className="text-[11px] font-mono text-ink-soft truncate">{emp?.job_title}</p>
                </div>
              </div>
              {ladder.map((m, i) => (
                <div key={m.id} className="pl-4 border-l border-line ml-4 pt-3">
                  <div className="flex items-center gap-2.5 -ml-8">
                    <div className="size-8 rounded-md bg-line grid place-items-center text-[10px] font-mono font-medium text-ink-soft shrink-0 ml-4">
                      {initials(m.full_name)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium truncate">{m.full_name}</p>
                      <p className="text-[11px] font-mono text-ink-soft truncate">
                        {i === 0 ? "Manager" : i === 1 ? "Skip manager" : `Level +${m.depth}`} ·{" "}
                        {m.job_title}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
              {!ladder.length && (
                <p className="mt-3 text-[13px] text-ink-soft">No manager assigned yet.</p>
              )}
            </div>
          </Panel>

          {latestReview && (
            <Panel title={`Review · ${latestReview.period}`}>
              <div className="p-4 space-y-2">
                <p className="text-[15px] font-semibold tracking-tight">
                  {Number(latestReview.rating).toFixed(1)} / 5
                </p>
                {latestReview.summary && (
                  <p className="text-[13px] text-ink-soft text-pretty">{latestReview.summary}</p>
                )}
                {latestReview.strengths && (
                  <p className="text-[12px] text-ink-soft">
                    <span className="label-mono">Strengths</span> · {latestReview.strengths}
                  </p>
                )}
                {latestReview.improvements && (
                  <p className="text-[12px] text-ink-soft">
                    <span className="label-mono">Focus</span> · {latestReview.improvements}
                  </p>
                )}
              </div>
            </Panel>
          )}

          <Panel title={`Holidays · ${emp?.location ?? ""}`}>
            <div className="divide-y divide-line">
              {myHolidays.map((h) => (
                <div key={h.id} className="px-4 py-3 flex items-center justify-between">
                  <p className="text-[13px]">{h.name}</p>
                  <p className="text-[11px] font-mono text-ink-soft">{fmtDate(h.holiday_date)}</p>
                </div>
              ))}
              {!myHolidays.length && (
                <p className="px-4 py-6 text-[13px] text-ink-soft">No holidays listed.</p>
              )}
            </div>
          </Panel>
        </aside>
      </div>
    </>
  );
}


function RequestAlerts() {
  const { alerts, dismiss } = useSubsidiaryRequestAlerts(true);
  const { data: requests = [] } = useSubsidiaryRequests(true);
  const pending = requests.filter((r) => r.status === "pending");

  if (!alerts.length && !pending.length) return null;

  return (
    <section className="mt-4 bg-panel rounded-[14px] ring-1 ring-black/5 overflow-hidden">
      <div className="flex items-center gap-2 px-4 h-11 border-b border-line">
        <span className="size-2 rounded-full bg-volt" />
        <p className="text-[13px] font-semibold tracking-tight">Subsidiary request alerts</p>
        <span className="label-mono">live</span>
        <Link to="/hr-accounts" className="ml-auto text-[11px] font-mono text-ink-soft hover:text-ink">
          Open admin →
        </Link>
      </div>
      <div className="divide-y divide-line">
        {alerts.map((a) => (
          <div key={a.id} className="px-4 py-3 flex items-center gap-3">
            <span
              className={`text-[10px] font-mono uppercase tracking-[0.14em] px-2 py-0.5 rounded ${
                a.kind === "approved"
                  ? "bg-brand text-paper"
                  : a.kind === "rejected"
                    ? "bg-destructive/10 text-destructive"
                    : "bg-volt/20 text-ink"
              }`}
            >
              {a.kind}
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-medium truncate">{a.title}</p>
              <p className="text-[11px] font-mono text-ink-soft truncate">{a.detail}</p>
            </div>
            <button
              onClick={() => dismiss(a.id)}
              className="ml-auto text-[11px] font-mono text-ink-soft hover:text-ink cursor-pointer"
            >
              dismiss
            </button>
          </div>
        ))}
        {!alerts.length && (
          <p className="px-4 py-3 text-[13px] text-ink-soft">
            {pending.length} request{pending.length === 1 ? "" : "s"} awaiting your decision.
          </p>
        )}
      </div>
    </section>
  );
}

/** Shown only to people who have direct reports: what is waiting on them. */
function ManagerStrip() {
  const { data: org } = useMyOrg();
  const reports = org?.everyone ?? [];
  const direct = org?.reports ?? [];
  const { data: leave = [] } = useLeaveRequests();
  const { data: timesheets = [] } = useTimesheets();
  const { data: claims = [] } = useExpenseClaims();
  const { data: separations = [] } = useSeparationRequests();

  if (reports.length === 0) return null;
  const ids = new Set(reports.map((r) => r.id));
  const items = [
    { label: "leave requests", n: leave.filter((l) => ids.has(l.employee_id) && l.status === "pending").length },
    { label: "timesheets", n: timesheets.filter((t) => ids.has(t.employee_id) && t.status === "submitted").length },
    { label: "expense claims", n: claims.filter((c) => ids.has(c.employee_id) && c.status === "submitted").length },
    { label: "resignations", n: separations.filter((s) => ids.has(s.employee_id) && s.stage === "manager_review").length },
  ];
  const total = items.reduce((sum, i) => sum + i.n, 0);

  return (
    <div className="mt-4 rounded-[14px] ring-1 ring-black/5 bg-panel px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="min-w-[220px] flex-1">
        <p className="label-mono">Your team</p>
        <p className="text-sm mt-1">
          {org ? `${LEVEL_LABEL[org.level]} · ` : ""}
          {direct.length} direct
          {reports.length > direct.length ? `, ${reports.length} in your line` : ""} ·{" "}
          {total === 0
            ? "nothing is waiting on you"
            : items
                .filter((i) => i.n > 0)
                .map((i) => `${i.n} ${i.label}`)
                .join(", ")}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Link
          to="/team"
          className="h-9 px-3 grid place-items-center rounded-lg bg-brand text-paper text-sm"
        >
          Open my team
        </Link>
        <Link
          to="/org"
          className="h-9 px-3 grid place-items-center rounded-lg ring-1 ring-black/10 text-sm"
        >
          Org chart
        </Link>
      </div>
    </div>
  );
}
