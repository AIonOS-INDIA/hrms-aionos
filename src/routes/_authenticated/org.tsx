import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Users2 } from "lucide-react";
import { AppShell, Panel, StatCard, StatusPill } from "@/components/AppShell";
import {
  fmtDate,
  LEVEL_LABEL,
  useEmployeeGoals,
  useExpenseClaims,
  useLeaveRequests,
  useLeaveTypes,
  useMyOrg,
  usePerformanceReviews,
  useTimesheets,
  type Employee,
  type OrgNode,
} from "@/lib/hrms";

export const Route = createFileRoute("/_authenticated/org")({
  head: () => ({
    meta: [
      { title: "Org chart — AIONOS HR Control Tower" },
      {
        name: "description",
        content:
          "An interactive view of your reporting line with leave, timesheet and performance summaries for every person, over any period you choose.",
      },
      { property: "og:title", content: "Org chart — AIONOS HR Control Tower" },
      {
        property: "og:description",
        content: "Explore your team structure and each person's leave, productivity and performance.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OrgPage,
});

function OrgPage() {
  return (
    <AppShell title="Org chart" subtitle="Your reporting line, with a summary for every person">
      <OrgBody />
    </AppShell>
  );
}

const RANGES = [
  { days: 30, label: "Last 30 days" },
  { days: 60, label: "Last 60 days" },
  { days: 90, label: "Last 90 days" },
  { days: 180, label: "Last 6 months" },
  { days: 365, label: "Last 12 months" },
];

const iso = (d: Date) => d.toISOString().slice(0, 10);

function OrgBody() {
  const { data: org, isLoading } = useMyOrg();
  const { data: leaveTypes = [] } = useLeaveTypes();
  const { data: leaveRequests = [] } = useLeaveRequests();
  const { data: timesheets = [] } = useTimesheets();
  const { data: claims = [] } = useExpenseClaims();
  const { data: goals = [] } = useEmployeeGoals();
  const { data: reviews = [] } = usePerformanceReviews();

  const [days, setDays] = useState(30);
  const [from, setFrom] = useState(() => iso(new Date(Date.now() - 30 * 86400000)));
  const [to, setTo] = useState(() => iso(new Date()));
  const [custom, setCustom] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (custom) return;
    setFrom(iso(new Date(Date.now() - days * 86400000)));
    setTo(iso(new Date()));
  }, [days, custom]);

  useEffect(() => {
    if (!selected && org?.reports.length) setSelected(org.reports[0]!.id);
  }, [org, selected]);

  useEffect(() => {
    if (!org) return;
    const next: Record<string, boolean> = {};
    for (const n of org.tree) next[n.person.id] = true;
    setOpen((prev) => ({ ...next, ...prev }));
  }, [org]);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !org) return null;
    return new Set(
      org.everyone
        .filter((e) =>
          [e.full_name, e.job_title, e.department, e.email]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q)),
        )
        .map((e) => e.id),
    );
  }, [search, org]);

  if (isLoading) return <Panel title="Org chart"><p className="px-4 py-8 text-sm text-ink-soft">Loading your team…</p></Panel>;

  if (!org || org.reports.length === 0) {
    return (
      <Panel title="Org chart">
        <p className="px-4 py-8 text-sm text-ink-soft">
          Nobody currently reports to you, so there is no team to explore here. If that looks wrong,
          ask HR to check the reporting manager on your team members&apos; records.
        </p>
      </Panel>
    );
  }

  const person = org.everyone.find((e) => e.id === selected) ?? org.reports[0]!;
  const nodeOf = org.flat.find((n) => n.person.id === person.id);
  const summary = summarise(person.id, { from, to, leaveRequests, timesheets, claims, goals, reviews });
  const managerOf = org.everyone.find((e) => e.id === person.manager_id) ?? org.self;

  const depthSpan = org.flat.reduce((m, n) => Math.max(m, n.depth), 0);
  const leaders = org.flat.filter((n) => n.children.length > 0).length;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <StatCard label="Your level" value={LEVEL_LABEL[org.level]} hint={org.self?.job_title ?? ""} />
        <StatCard label="Direct reports" value={org.reports.length} hint="Report straight to you" />
        <StatCard label="People in your line" value={org.everyone.length} hint={`${leaders} of them lead a team`} />
        <StatCard label="Layers below you" value={depthSpan} hint="Depth of your branch" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {RANGES.map((r) => (
          <button
            key={r.days}
            type="button"
            onClick={() => {
              setCustom(false);
              setDays(r.days);
            }}
            className={`h-9 px-3 rounded-lg text-sm cursor-pointer ring-1 ${
              !custom && days === r.days
                ? "bg-brand text-paper ring-transparent"
                : "ring-black/10 hover:bg-ink/5"
            }`}
          >
            {r.label}
          </button>
        ))}
        <span className="mx-1 text-xs text-ink-soft">or</span>
        <label className="sr-only" htmlFor="org-from">From date</label>
        <input
          id="org-from"
          type="date"
          value={from}
          onChange={(e) => {
            setCustom(true);
            setFrom(e.target.value);
          }}
          className="h-9 px-2 rounded-lg bg-panel ring-1 ring-black/10 text-sm"
        />
        <label className="sr-only" htmlFor="org-to">To date</label>
        <input
          id="org-to"
          type="date"
          value={to}
          onChange={(e) => {
            setCustom(true);
            setTo(e.target.value);
          }}
          className="h-9 px-2 rounded-lg bg-panel ring-1 ring-black/10 text-sm"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel
          title="Team structure"
          meta={
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find a person"
              aria-label="Find a person in your team"
              className="h-8 px-2 rounded-lg bg-panel ring-1 ring-black/10 text-xs w-40"
            />
          }
        >
          <ul className="py-1 max-h-[560px] overflow-y-auto">
            {org.tree.map((n) => (
              <TreeRow
                key={n.person.id}
                node={n}
                open={open}
                onToggle={(id) => setOpen((p) => ({ ...p, [id]: !p[id] }))}
                selected={person.id}
                onSelect={setSelected}
                matches={matches}
              />
            ))}
          </ul>
        </Panel>

        <div className="space-y-4">
          <Panel
            title={person.full_name}
            meta={<StatusPill status={person.status} />}
          >
            <div className="px-4 py-3 space-y-1 text-xs text-ink-soft">
              <p className="text-sm text-ink font-medium">
                {[person.job_title, person.band].filter(Boolean).join(" · ")}
              </p>
              <p>{[person.department, person.business_unit, person.office_city].filter(Boolean).join(" · ")}</p>
              <p>{person.email}</p>
              <p>
                Reports to {managerOf?.full_name ?? "—"} ·{" "}
                {nodeOf && nodeOf.children.length
                  ? `leads ${nodeOf.children.length} people (${nodeOf.total} in their line)`
                  : "no direct reports"}
              </p>
              <p>Joined {fmtDate(person.joined_on)}</p>
            </div>
          </Panel>

          <Panel
            title="Summary"
            meta={<span className="label-mono">{fmtDate(from)} → {fmtDate(to)}</span>}
          >
            <div className="grid grid-cols-2 gap-3 p-4">
              <Mini label="Leave taken" value={`${summary.leaveDays} days`} hint={`${summary.leavePending} awaiting a decision`} />
              <Mini label="Hours logged" value={summary.hours.toFixed(1)} hint={`${summary.weeks} week${summary.weeks === 1 ? "" : "s"} submitted`} />
              <Mini label="Weeks approved" value={`${summary.approvedWeeks}/${summary.weeks}`} hint={summary.pendingWeeks ? `${summary.pendingWeeks} awaiting review` : "up to date"} />
              <Mini label="Average week" value={summary.weeks ? `${(summary.hours / summary.weeks).toFixed(1)} h` : "—"} hint="against a 40 hour week" />
              <Mini label="Latest rating" value={summary.rating != null ? summary.rating.toFixed(1) : "—"} hint={summary.reviewCount ? `${summary.reviewCount} review${summary.reviewCount === 1 ? "" : "s"} in period` : "no review in period"} />
              <Mini label="Goal progress" value={summary.goalCount ? `${summary.goalProgress}%` : "—"} hint={summary.goalCount ? `${summary.goalCount} open goals` : "no goals set"} />
              <Mini label="Claims" value={summary.claimCount} hint={summary.claimAmount ? `${person.legal_entity ? "" : ""}${summary.claimAmount.toLocaleString()} submitted` : "nothing claimed"} />
              <Mini label="Leave by type" value={summary.topLeaveType ? typeName(leaveTypes, summary.topLeaveType) : "—"} hint="most used in period" />
            </div>
            <div className="px-4 pb-4 flex flex-wrap gap-3 text-xs">
              <Link to="/team" className="underline underline-offset-2">Approvals</Link>
              <Link to="/performance" className="underline underline-offset-2">Goals and reviews</Link>
              <Link to="/timesheets" className="underline underline-offset-2">Timesheets</Link>
              <Link to="/leave" className="underline underline-offset-2">Leave</Link>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function typeName(types: { id: string; name: string }[], id: string) {
  return types.find((t) => t.id === id)?.name ?? "Leave";
}

function Mini({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl ring-1 ring-black/5 bg-panel px-3 py-2">
      <p className="label-mono text-[11px] text-ink-soft">{label}</p>
      <p className="text-lg font-semibold mt-0.5">{value}</p>
      {hint ? <p className="text-[11px] text-ink-soft mt-0.5">{hint}</p> : null}
    </div>
  );
}

function TreeRow({
  node,
  open,
  onToggle,
  selected,
  onSelect,
  matches,
}: {
  node: OrgNode;
  open: Record<string, boolean>;
  onToggle: (id: string) => void;
  selected: string;
  onSelect: (id: string) => void;
  matches: Set<string> | null;
}) {
  const isOpen = open[node.person.id] ?? false;
  const hasKids = node.children.length > 0;
  const dim = matches ? !matches.has(node.person.id) : false;
  return (
    <li>
      <div
        className={`flex items-center gap-1 pr-3 py-1.5 rounded-lg ${
          selected === node.person.id ? "bg-brand/10" : "hover:bg-ink/5"
        } ${dim ? "opacity-40" : ""}`}
        style={{ paddingLeft: 8 + (node.depth - 1) * 16 }}
      >
        <button
          type="button"
          onClick={() => hasKids && onToggle(node.person.id)}
          aria-label={hasKids ? (isOpen ? "Collapse" : "Expand") : "No reports"}
          className={`h-6 w-6 grid place-items-center rounded ${hasKids ? "cursor-pointer hover:bg-ink/10" : "opacity-25"}`}
        >
          {hasKids ? (
            isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />
          ) : (
            <span className="h-1.5 w-1.5 rounded-full bg-ink/30" />
          )}
        </button>
        <button
          type="button"
          onClick={() => onSelect(node.person.id)}
          className="flex-1 text-left cursor-pointer min-w-0"
        >
          <span className="text-sm truncate block">{node.person.full_name}</span>
          <span className="text-[11px] text-ink-soft truncate block">
            {[node.person.job_title, node.person.department].filter(Boolean).join(" · ")}
          </span>
        </button>
        {hasKids ? (
          <span className="text-[11px] text-ink-soft font-mono flex items-center gap-1">
            <Users2 className="h-3 w-3" />
            {node.total}
          </span>
        ) : null}
      </div>
      {hasKids && isOpen ? (
        <ul>
          {node.children.map((c) => (
            <TreeRow
              key={c.person.id}
              node={c}
              open={open}
              onToggle={onToggle}
              selected={selected}
              onSelect={onSelect}
              matches={matches}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function summarise(
  employeeId: string,
  ctx: {
    from: string;
    to: string;
    leaveRequests: { employee_id: string; start_date: string; status: string; days: number; leave_type_id: string }[];
    timesheets: { employee_id: string; week_start: string; status: string; total_hours: number }[];
    claims: { employee_id: string; created_at: string; total_amount: number; status: string }[];
    goals: { employee_id: string; progress: number; status: string }[];
    reviews: { employee_id: string; review_date: string; rating: number }[];
  },
) {
  const inRange = (d?: string | null) => !!d && d.slice(0, 10) >= ctx.from && d.slice(0, 10) <= ctx.to;

  const leave = ctx.leaveRequests.filter((r) => r.employee_id === employeeId && inRange(r.start_date));
  const leaveDays = leave.filter((r) => r.status === "approved").reduce((n, r) => n + Number(r.days || 0), 0);
  const leavePending = leave.filter((r) => r.status === "pending").length;
  const byType = new Map<string, number>();
  for (const r of leave.filter((x) => x.status === "approved")) {
    byType.set(r.leave_type_id, (byType.get(r.leave_type_id) ?? 0) + Number(r.days || 0));
  }
  const topLeaveType = [...byType.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const sheets = ctx.timesheets.filter((t) => t.employee_id === employeeId && inRange(t.week_start));
  const hours = sheets.reduce((n, t) => n + Number(t.total_hours || 0), 0);
  const approvedWeeks = sheets.filter((t) => t.status === "approved").length;
  const pendingWeeks = sheets.filter((t) => t.status === "submitted").length;

  const claims = ctx.claims.filter((c) => c.employee_id === employeeId && inRange(c.created_at));
  const claimAmount = claims.reduce((n, c) => n + Number(c.total_amount || 0), 0);

  const reviews = ctx.reviews.filter((r) => r.employee_id === employeeId && inRange(r.review_date));
  const rating = reviews.length ? Number(reviews[0]!.rating) : null;

  const goals = ctx.goals.filter((g) => g.employee_id === employeeId && g.status !== "draft");
  const goalProgress = goals.length
    ? Math.round(goals.reduce((n, g) => n + Number(g.progress || 0), 0) / goals.length)
    : 0;

  return {
    leaveDays: Math.round(leaveDays * 10) / 10,
    leavePending,
    topLeaveType,
    hours,
    weeks: sheets.length,
    approvedWeeks,
    pendingWeeks,
    claimCount: claims.length,
    claimAmount,
    rating,
    reviewCount: reviews.length,
    goalCount: goals.length,
    goalProgress,
  };
}

export default OrgPage;
