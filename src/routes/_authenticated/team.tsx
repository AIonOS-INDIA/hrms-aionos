import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, Panel, StatCard, StatusPill } from "@/components/AppShell";
import {
  fmtDate,
  useExpenseClaims,
  useLeaveRequests,
  useLeaveTypes,
  useMe,
  useMyOrg,
  LEVEL_LABEL,
  useSeparationRequests,
  useTimesheets,
  type Employee,
} from "@/lib/hrms";

export const Route = createFileRoute("/_authenticated/team")({
  head: () => ({
    meta: [
      { title: "My team — AIONOS HR Control Tower" },
      {
        name: "description",
        content:
          "Everything a manager, skip-level manager or executive decides in one place: leave requests, weekly timesheets, travel claims and resignations from their whole reporting line.",
      },
      { property: "og:title", content: "My team — AIONOS HR Control Tower" },
      {
        property: "og:description",
        content: "Approve leave, timesheets, expenses and resignations for your direct reports.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TeamPage,
});

function TeamPage() {
  return (
    <AppShell title="My team" subtitle="Approvals and status for the people who report to you">
      <TeamBody />
    </AppShell>
  );
}

type Tile = "people" | "leave" | "timesheets" | "expenses" | "exits" | null;

function TeamBody() {
  const { data: me } = useMe();
  const { data: org, isLoading } = useMyOrg();
  const reports = org?.everyone ?? [];
  const direct = org?.reports ?? [];
  const { data: leaveTypes = [] } = useLeaveTypes();
  const { data: leaveRequests = [] } = useLeaveRequests();
  const { data: timesheets = [] } = useTimesheets();
  const { data: claims = [] } = useExpenseClaims();
  const { data: separations = [] } = useSeparationRequests();
  const queryClient = useQueryClient();

  const [tile, setTile] = useState<Tile>(null);
  const [note, setNote] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const reportIds = useMemo(() => new Set(reports.map((r) => r.id)), [reports]);
  const selectedPerson = selectedId ? (reports.find((r) => r.id === selectedId) ?? null) : null;
  const nameOf = (id: string) => reports.find((r) => r.id === id)?.full_name ?? "Team member";
  const typeOf = (id: string) => leaveTypes.find((t) => t.id === id)?.name ?? "Leave";

  const pendingLeave = leaveRequests.filter(
    (r) => reportIds.has(r.employee_id) && r.status === "pending",
  );
  const pendingSheets = timesheets.filter(
    (t) => reportIds.has(t.employee_id) && t.status === "submitted",
  );
  const pendingClaims = claims.filter(
    (c) => reportIds.has(c.employee_id) && c.status === "submitted",
  );
  const pendingExits = separations.filter(
    (s) => reportIds.has(s.employee_id) && s.stage === "manager_review",
  );

  const refresh = (keys: string[]) => {
    for (const k of keys) queryClient.invalidateQueries({ queryKey: [k] });
  };

  const decideLeave = useMutation({
    mutationFn: async (v: { id: string; approve: boolean }) => {
      const { error } = await supabase
        .from("leave_requests")
        .update({
          status: v.approve ? "approved" : "rejected",
          decision_note: note.trim(),
        })
        .eq("id", v.id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      setNote("");
      refresh(["leave_requests", "leave_balances"]);
      toast.success(v.approve ? "Leave approved" : "Leave declined");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const decideSheet = useMutation({
    mutationFn: async (v: { id: string; approve: boolean }) => {
      const { error } = await supabase
        .from("timesheets")
        .update({ status: v.approve ? "approved" : "rejected" })
        .eq("id", v.id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      setNote("");
      refresh(["timesheets"]);
      toast.success(v.approve ? "Timesheet approved" : "Sent back for changes");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const decideClaim = useMutation({
    mutationFn: async (v: { id: string; approve: boolean }) => {
      const { error } = await supabase
        .from("expense_claims")
        .update({ status: v.approve ? "approved" : "rejected" })
        .eq("id", v.id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      refresh(["expense_claims"]);
      toast.success(v.approve ? "Claim approved — finance will reimburse" : "Claim rejected");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const decideExit = useMutation({
    mutationFn: async (v: { id: string; approve: boolean }) => {
      const { error } = await supabase
        .from("separation_requests")
        .update({
          manager_status: v.approve ? "approved" : "rejected",
          manager_note: note.trim(),
          manager_decided_at: new Date().toISOString(),
          stage: v.approve ? "hr_review" : "rejected",
        })
        .eq("id", v.id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      setNote("");
      refresh(["separation_requests"]);
      toast.success(v.approve ? "Sent to HR" : "Concern raised with HR");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!isLoading && reports.length === 0) {
    return (
      <Panel title="My team">
        <p className="px-4 py-8 text-sm text-ink-soft">
          Nobody currently reports to you, so there is nothing to approve here. If that looks wrong,
          ask HR to check the reporting manager on your team members&apos; records.
        </p>
      </Panel>
    );
  }

  const show = (t: Tile) => tile === null || tile === t;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
        <StatCard
          label="Direct reports"
          value={direct.length}
          hint={
            reports.length > direct.length
              ? `${reports.length} people in your line`
              : "See who reports to you"
          }
          onClick={() => setTile(tile === "people" ? null : "people")}
          active={tile === "people"}
        />
        <StatCard
          label="Leave to decide"
          value={pendingLeave.length}
          hint={pendingLeave.length ? "Waiting on you" : "All clear"}
          hintTone={pendingLeave.length ? "warn" : "good"}
          onClick={() => setTile(tile === "leave" ? null : "leave")}
          active={tile === "leave"}
        />
        <StatCard
          label="Timesheets to review"
          value={pendingSheets.length}
          hint={pendingSheets.length ? "Submitted weeks" : "All clear"}
          hintTone={pendingSheets.length ? "warn" : "good"}
          onClick={() => setTile(tile === "timesheets" ? null : "timesheets")}
          active={tile === "timesheets"}
        />
        <StatCard
          label="Claims to approve"
          value={pendingClaims.length}
          hint={pendingClaims.length ? "Travel and expenses" : "All clear"}
          hintTone={pendingClaims.length ? "warn" : "good"}
          onClick={() => setTile(tile === "expenses" ? null : "expenses")}
          active={tile === "expenses"}
        />
        <StatCard
          label="Resignations"
          value={pendingExits.length}
          hint={pendingExits.length ? "Awaiting your view" : "None open"}
          hintTone={pendingExits.length ? "warn" : "good"}
          onClick={() => setTile(tile === "exits" ? null : "exits")}
          active={tile === "exits"}
        />
      </div>

      {tile && tile !== "people" ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note sent with your decision"
            aria-label="Decision note"
            className="flex-1 min-w-[220px] h-9 px-3 rounded-lg bg-panel ring-1 ring-black/10 text-sm"
          />
          <button
            type="button"
            onClick={() => setTile(null)}
            className="h-9 px-3 rounded-lg ring-1 ring-black/10 text-sm cursor-pointer hover:bg-ink/5"
          >
            Show everything
          </button>
        </div>
      ) : null}

      {show("leave") ? (
        <Panel title="Leave requests" meta={<span className="label-mono">{pendingLeave.length} waiting</span>}>
          {pendingLeave.length === 0 ? (
            <Empty text="No leave request is waiting for you." />
          ) : (
            <ul className="divide-y divide-line">
              {pendingLeave.map((r) => (
                <Row
                  key={r.id}
                  title={nameOf(r.employee_id)}
                  detail={`${typeOf(r.leave_type_id)} · ${fmtDate(r.start_date)} → ${fmtDate(r.end_date)} · ${r.days} day${r.days === 1 ? "" : "s"}`}
                  sub={r.reason}
                  busy={decideLeave.isPending}
                  onApprove={() => decideLeave.mutate({ id: r.id, approve: true })}
                  onReject={() => decideLeave.mutate({ id: r.id, approve: false })}
                  rejectLabel="Decline"
                />
              ))}
            </ul>
          )}
        </Panel>
      ) : null}

      {show("timesheets") ? (
        <Panel title="Weekly timesheets" meta={<span className="label-mono">{pendingSheets.length} submitted</span>}>
          {pendingSheets.length === 0 ? (
            <Empty text="No timesheet is waiting for review." />
          ) : (
            <ul className="divide-y divide-line">
              {pendingSheets.map((t) => (
                <Row
                  key={t.id}
                  title={nameOf(t.employee_id)}
                  detail={`Week of ${fmtDate(t.week_start)} · ${t.total_hours} hours`}
                  sub={t.note}
                  busy={decideSheet.isPending}
                  onApprove={() => decideSheet.mutate({ id: t.id, approve: true })}
                  onReject={() => decideSheet.mutate({ id: t.id, approve: false })}
                  rejectLabel="Send back"
                />
              ))}
            </ul>
          )}
        </Panel>
      ) : null}

      {show("expenses") ? (
        <Panel title="Travel and expense claims" meta={<span className="label-mono">{pendingClaims.length} submitted</span>}>
          {pendingClaims.length === 0 ? (
            <Empty text="No claim is waiting for you." />
          ) : (
            <ul className="divide-y divide-line">
              {pendingClaims.map((c) => (
                <Row
                  key={c.id}
                  title={nameOf(c.employee_id)}
                  detail={`${c.title} · ${c.currency} ${Number(c.total_amount).toLocaleString()}${c.destination ? ` · ${c.destination}` : ""}`}
                  sub={c.purpose}
                  busy={decideClaim.isPending}
                  onApprove={() => decideClaim.mutate({ id: c.id, approve: true })}
                  onReject={() => decideClaim.mutate({ id: c.id, approve: false })}
                  rejectLabel="Reject"
                />
              ))}
            </ul>
          )}
        </Panel>
      ) : null}

      {show("exits") ? (
        <Panel title="Resignations" meta={<span className="label-mono">{pendingExits.length} awaiting you</span>}>
          {pendingExits.length === 0 ? (
            <Empty text="Nobody on your team has given notice." />
          ) : (
            <ul className="divide-y divide-line">
              {pendingExits.map((s) => (
                <Row
                  key={s.id}
                  title={nameOf(s.employee_id)}
                  detail={`Notice on ${fmtDate(s.notice_date)} · last day requested ${fmtDate(s.requested_last_day)}`}
                  sub={s.reason}
                  busy={decideExit.isPending}
                  approveLabel="Accept & send to HR"
                  rejectLabel="Raise a concern"
                  onApprove={() => decideExit.mutate({ id: s.id, approve: true })}
                  onReject={() => decideExit.mutate({ id: s.id, approve: false })}
                />
              ))}
            </ul>
          )}
        </Panel>
      ) : null}

      {show("people") ? (
        <Panel
          title="Your team"
          meta={
            <span className="flex items-center gap-3">
              <span className="label-mono">{org ? LEVEL_LABEL[org.level] : ""}</span>
              <Link to="/org" className="text-xs underline underline-offset-2">
                Org chart
              </Link>
              <Link to="/performance" className="text-xs underline underline-offset-2">
                Goals and reviews
              </Link>
            </span>
          }
        >
          <ul className="divide-y divide-line">
            {(org?.flat ?? []).map(({ person: r, depth }) => (
              <TeamRow
                key={r.id}
                person={r}
                depth={depth}
                selected={selectedId === r.id}
                onSelect={() => setSelectedId(selectedId === r.id ? null : r.id)}
                openLeave={pendingLeave.filter((l) => l.employee_id === r.id).length}
                openSheets={pendingSheets.filter((t) => t.employee_id === r.id).length}
                openClaims={pendingClaims.filter((c) => c.employee_id === r.id).length}
              />
            ))}
          </ul>
          {selectedPerson ? (
            <div className="border-t border-line px-4 py-4 space-y-4 bg-ink/[0.02]">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">{selectedPerson.full_name}</p>
                  <p className="text-xs text-ink-soft mt-0.5">
                    {[selectedPerson.job_title, selectedPerson.band, selectedPerson.department]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="h-8 px-3 rounded-lg ring-1 ring-black/10 text-xs cursor-pointer hover:bg-ink/5"
                >
                  Close
                </button>
              </div>
              <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3 text-xs">
                <Field label="Work email" value={selectedPerson.email} />
                <Field label="Phone" value={selectedPerson.phone} />
                <Field label="Legal entity" value={selectedPerson.legal_entity} />
                <Field label="Business unit" value={selectedPerson.business_unit} />
                <Field
                  label="Office"
                  value={[selectedPerson.office_city, selectedPerson.office_area]
                    .filter(Boolean)
                    .join(", ")}
                />
                <Field label="Employment type" value={selectedPerson.employment_type} />
                <Field label="Joined on" value={fmtDate(selectedPerson.joined_on)} />
                <Field label="Reports to" value={nameOf(selectedPerson.manager_id ?? "")} />
                <Field
                  label="Leads"
                  value={`${(org?.flat ?? []).filter((n) => n.person.manager_id === selectedPerson.id).length} people`}
                />
              </dl>
              <div className="grid gap-3 sm:grid-cols-3">
                <MiniStat
                  label="Leave waiting on you"
                  value={pendingLeave.filter((l) => l.employee_id === selectedPerson.id).length}
                />
                <MiniStat
                  label="Timesheets to review"
                  value={pendingSheets.filter((t) => t.employee_id === selectedPerson.id).length}
                />
                <MiniStat
                  label="Claims to approve"
                  value={pendingClaims.filter((c) => c.employee_id === selectedPerson.id).length}
                />
              </div>
              <div className="flex flex-wrap gap-3 text-xs">
                <Link to="/org" className="underline underline-offset-2">
                  See full summary in the org chart
                </Link>
                <Link to="/performance" className="underline underline-offset-2">
                  Goals and reviews
                </Link>
              </div>
            </div>
          ) : (
            <p className="border-t border-line px-4 py-3 text-xs text-ink-soft">
              Select anyone above to see their details.
            </p>
          )}
        </Panel>
      ) : null}

      {me?.employee ? null : (
        <p className="text-xs text-ink-soft">
          Your employee record is not linked yet — ask HR to check your work email.
        </p>
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="px-4 py-6 text-sm text-ink-soft">{text}</p>;
}

function Row({
  title,
  detail,
  sub,
  busy,
  onApprove,
  onReject,
  approveLabel = "Approve",
  rejectLabel = "Reject",
}: {
  title: string;
  detail: string;
  sub?: string | undefined;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
  approveLabel?: string;
  rejectLabel?: string;
}) {
  return (
    <li className="px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="min-w-[200px] flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-ink-soft mt-0.5">{detail}</p>
        {sub ? <p className="text-xs text-ink-soft mt-0.5 italic">{sub}</p> : null}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onApprove}
          className="h-9 px-3 rounded-lg bg-brand text-paper text-sm cursor-pointer disabled:opacity-50"
        >
          {approveLabel}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onReject}
          className="h-9 px-3 rounded-lg ring-1 ring-black/10 text-sm cursor-pointer hover:bg-ink/5 disabled:opacity-50"
        >
          {rejectLabel}
        </button>
      </div>
    </li>
  );
}

function Field({ label, value }: { label: string; value?: string | null | undefined }) {
  return (
    <div>
      <dt className="text-ink-soft">{label}</dt>
      <dd className="font-medium mt-0.5 break-words">{value?.trim() ? value : "—"}</dd>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-panel ring-1 ring-black/10 px-3 py-2">
      <p className="text-xs text-ink-soft">{label}</p>
      <p className="text-lg font-semibold mt-0.5">{value}</p>
    </div>
  );
}

function TeamRow({
  person,
  depth,
  selected,
  onSelect,
  openLeave,
  openSheets,
  openClaims,
}: {
  person: Employee;
  depth: number;
  selected: boolean;
  onSelect: () => void;
  openLeave: number;
  openSheets: number;
  openClaims: number;
}) {
  const open = openLeave + openSheets + openClaims;
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={`w-full text-left px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 cursor-pointer hover:bg-ink/5 ${
          selected ? "bg-brand/10" : ""
        }`}
      >
        <div className="min-w-[200px] flex-1" style={{ paddingLeft: (depth - 1) * 16 }}>
          <p className="text-sm font-medium">{person.full_name}</p>
          <p className="text-xs text-ink-soft mt-0.5">
            {[person.job_title, person.department, person.office_city].filter(Boolean).join(" · ")}
          </p>
        </div>
        <StatusPill status={person.status} />
        <p className="text-xs text-ink-soft font-mono w-40 text-right">
          {open === 0 ? "nothing pending" : `${open} waiting on you`}
        </p>
      </button>
    </li>
  );
}
