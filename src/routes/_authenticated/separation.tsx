import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, FilterNote, EntityTag, Panel, StatCard, useScope } from "@/components/AppShell";
import { Input, Select } from "@/routes/_authenticated/employees";
import { AssetPanel } from "@/components/AssetPanel";
import { SeparationWorkflow, EXIT_REASONS, TERMINATION_REASONS } from "@/components/SeparationWorkflow";
import { DepartmentHeadsPanel } from "@/components/DepartmentHeadsPanel";
import {
  computeExitSettlement,
  fmtDate,
  money,
  useEmployees,
  useEntityPaySettings,
  useExpenseClaims,
  useLeaveBalances,
  useEmployeeAssets,
  useMe,
  useMyOrg,
  useSalaryStructures,
  useSeparationRequests,
  DEFAULT_PAY_SETTINGS,
  SEPARATION_STAGE_LABEL,
  type SeparationRequest,
  type SeparationStage,
} from "@/lib/hrms";

export const Route = createFileRoute("/_authenticated/separation")({
  head: () => ({
    meta: [
      { title: "Separation — AIONOS HR Control Tower" },
      {
        name: "description",
        content:
          "Notice of resignation with HR separation details, IT asset return and Finance full and final settlement in one tracked workflow.",
      },
      { property: "og:title", content: "Separation — AIONOS HR Control Tower" },
      {
        property: "og:description",
        content: "Resignation notice, HR, IT and Finance clearance in one flow.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SeparationPage,
});

function SeparationPage() {
  return (
    <AppShell title="Separation" subtitle="Notice · HR · IT assets · Final settlement">
      <SeparationBody />
    </AppShell>
  );
}

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

const STEPS: { key: string; label: string }[] = [
  { key: "notice", label: "Notice given" },
  { key: "manager", label: "Manager" },
  { key: "hr", label: "HR" },
  { key: "it", label: "IT assets" },
  { key: "finance", label: "Settlement" },
];

function stepIndex(stage: SeparationStage) {
  if (stage === "submitted" || stage === "manager_review") return 1;
  if (stage === "hr_review") return 2;
  if (stage === "it_clearance") return 3;
  if (stage === "finance_settlement") return 4;
  if (stage === "completed") return 5;
  return 1;
}

function StageTrack({ row }: { row: SeparationRequest }) {
  const closed = row.stage === "withdrawn" || row.stage === "rejected";
  const at = stepIndex(row.stage);
  return (
    <div className="flex items-center gap-1.5">
      {STEPS.map((s, i) => {
        const done = !closed && i < at;
        const current = !closed && i === at;
        return (
          <div key={s.key} className="flex items-center gap-1.5">
            <span
              className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                closed
                  ? "bg-ink/10 text-ink-soft"
                  : done
                    ? "bg-perp/10 text-perp"
                    : current
                      ? "bg-whilter/10 text-whilter"
                      : "bg-line/70 text-ink-soft"
              }`}
            >
              {s.label}
            </span>
            {i < STEPS.length - 1 && <span className="w-3 h-px bg-line" />}
          </div>
        );
      })}
    </div>
  );
}

function SeparationBody() {
  const { data: me } = useMe();
  const { companyId, companyById, canSeeAll } = useScope();
  const { data: employees = [] } = useEmployees();
  const { data: rows = [] } = useSeparationRequests();
  const queryClient = useQueryClient();
  const { data: paySettings = [] } = useEntityPaySettings();
  const { data: salaries = [] } = useSalaryStructures();
  const { data: claims = [] } = useExpenseClaims();
  const { data: assets = [] } = useEmployeeAssets();

  const isHr = !!me?.isMaster || !!me?.hrCompanyId;
  const isFinance = !!me?.isPayrollApprover;
  const myId = me?.employee?.id;

  const scopedIds = useMemo(() => {
    const list = companyId ? employees.filter((e) => e.company_id === companyId) : employees;
    return new Set(list.map((e) => e.id));
  }, [employees, companyId]);

  const financeIds = useMemo(() => {
    const allowed = new Set(me?.payrollCompanyIds ?? []);
    return new Set(
      employees.filter((e) => allowed.size === 0 || allowed.has(e.company_id)).map((e) => e.id),
    );
  }, [employees, me?.payrollCompanyIds]);

  const empOf = (id: string) => employees.find((e) => e.id === id);
  // Rows are already limited by access rules; HR additionally narrows by the entity picked above.
  const visible = rows.filter(
    (r) =>
      !isHr ||
      scopedIds.has(r.employee_id) ||
      (isFinance && financeIds.has(r.employee_id)) ||
      r.employee_id === myId ||
      r.initiated_by === myId ||
      empOf(r.employee_id)?.manager_id === myId,
  );
  const { data: org } = useMyOrg();
  const terminable = useMemo(() => {
    const base = isHr
      ? employees.filter((e) => (companyId ? e.company_id === companyId : true))
      : (org?.everyone ?? []);
    return base
      .filter((e) => e.id !== myId && e.status !== "offboarded")
      .sort((a, b) => a.full_name.localeCompare(b.full_name));
  }, [isHr, employees, companyId, org?.everyone, myId]);

  const [openId, setOpenId] = useState("");
  const [tile, setTile] = useState<string | null>(null);
  const activeId = openId || (visible[0]?.id ?? "");
  const active = visible.find((r) => r.id === activeId);

  const activeEmp = active ? empOf(active.employee_id) : undefined;
  const isManagerOfActive = !!activeEmp && !!myId && activeEmp.manager_id === myId;
  const openAssets = activeEmp
    ? assets.filter((a) => a.employee_id === activeEmp.id && a.status === "assigned")
    : [];
  const { data: activeBalances = [] } = useLeaveBalances(activeEmp?.id);

  /** Live worksheet finance settles against: last pay, leave, expenses. */
  const worksheet = useMemo(() => {
    if (!active || !activeEmp) return null;
    const settings =
      paySettings.find((s) => s.company_id === activeEmp.company_id) ?? DEFAULT_PAY_SETTINGS;
    const salary = salaries.find((s) => s.employee_id === activeEmp.id);
    const dueExpenses = claims
      .filter((c) => c.employee_id === activeEmp.id && c.status === "approved")
      .reduce((sum, c) => sum + Number(c.total_amount), 0);
    return {
      currency: settings.currency,
      ...computeExitSettlement({
        salary,
        settings,
        balances: activeBalances,
        expenses: dueExpenses,
        lastDay: active.approved_last_day ?? active.requested_last_day,
      }),
    };
  }, [active, activeEmp, paySettings, salaries, claims, activeBalances]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["separation_requests"] });
    queryClient.invalidateQueries({ queryKey: ["employees"] });
  };

  const [notice, setNotice] = useState({
    reason: "",
    comments: "",
    resignation_type: "resignation",
    notice_days: "60",
    requested_last_day: addDays(60),
  });

  const raise = useMutation({
    mutationFn: async () => {
      if (!myId) throw new Error("No employee record linked to your account");
      if (!notice.reason) throw new Error("Pick a reason for leaving");
      if (myOpen) throw new Error("You already have a separation in progress");
      const { error } = await supabase.from("separation_requests").insert({
        employee_id: myId,
        reason: notice.reason,
        resignation_type: notice.resignation_type,
        separation_kind: "voluntary",
        resignation_form: {
          reason: notice.reason,
          last_day: notice.requested_last_day,
          comments: notice.comments,
        },
        notice_date: today(),
        notice_days: Number(notice.notice_days) || 0,
        requested_last_day: notice.requested_last_day,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Resignation submitted — your manager and HR have been told");
      setNotice({ ...notice, reason: "", comments: "" });
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const patch = useMutation({
    mutationFn: async ({
      id,
      values,
    }: {
      id: string;
      values: Record<string, unknown>;
    }) => {
      const { error } = await supabase
        .from("separation_requests")
        .update(values as never)
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => refresh(),
    onError: (e: Error) => toast.error(e.message),
  });

  /** Approved travel claims are paid out with the full & final settlement. */
  const payClaims = async (row: SeparationRequest) => {
    const due = claims.filter((c) => c.employee_id === row.employee_id && c.status === "approved");
    for (const claim of due) {
      await supabase
        .from("expense_claims")
        .update({
          status: "reimbursed",
          reimbursed_on: today(),
          reimbursed_amount: Number(claim.total_amount),
          payment_reference: "Full & final settlement",
        })
        .eq("id", claim.id);
    }
    queryClient.invalidateQueries({ queryKey: ["expense_claims"] });
  };

  const revoke = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("revoke_my_resignation" as never, { _sep_id: id } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Resignation revoked — HR and your manager have been told");
      refresh();
      queryClient.invalidateQueries({ queryKey: ["separation_tasks"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [term, setTerm] = useState({
    employee_id: "",
    search: "",
    reason: "",
    effective_date: addDays(30),
    supporting_docs: false,
    details: "",
  });
  const terminate = useMutation({
    mutationFn: async () => {
      if (!term.employee_id) throw new Error("Pick the employee");
      if (!term.reason) throw new Error("Pick a reason for termination");
      if (!term.effective_date) throw new Error("Set the termination effective date");
      const { error } = await supabase.rpc("initiate_termination" as never, {
        _employee_id: term.employee_id,
        _form: {
          reason: term.reason,
          effective_date: term.effective_date,
          supporting_docs: term.supporting_docs,
          details: term.details,
        },
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Termination started — the next approver, Legal and the HR Head have been told");
      setTerm({ ...term, employee_id: "", search: "", reason: "", details: "", supporting_docs: false });
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const termMatches = term.search.trim()
    ? terminable
        .filter((e) =>
          `${e.full_name} ${e.email} ${e.employee_code ?? ""}`.toLowerCase().includes(term.search.toLowerCase()),
        )
        .slice(0, 8)
    : [];
  const termPicked = terminable.find((e) => e.id === term.employee_id);

  useEffect(() => {
    void supabase.rpc("run_separation_escalations" as never);
  }, []);

  const openCount = visible.filter(
    (r) => !["completed", "withdrawn", "rejected"].includes(r.stage),
  ).length;
  const withHr = visible.filter((r) => r.stage === "submitted" || r.stage === "hr_review").length;
  const withIt = visible.filter((r) => r.stage === "it_clearance").length;
  const withFinance = visible.filter((r) => r.stage === "finance_settlement").length;

  const myOpen = visible.find(
    (r) => r.employee_id === myId && !["completed", "withdrawn", "rejected"].includes(r.stage),
  );

  const shown =
    tile === "open"
      ? visible.filter((r) => !["completed", "withdrawn", "rejected"].includes(r.stage))
      : tile === "hr"
        ? visible.filter((r) => r.stage === "submitted" || r.stage === "hr_review")
        : tile === "it"
          ? visible.filter((r) => r.stage === "it_clearance")
          : tile === "finance"
            ? visible.filter((r) => r.stage === "finance_settlement")
            : visible;
  const toggle = (k: string) => setTile((prev) => (prev === k ? null : k));

  return (
    <>
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="In progress"
          value={openCount}
          hint="separations open"
          onClick={() => toggle("open")}
          active={tile === "open"}
        />
        <StatCard
          label="With HR"
          value={withHr}
          hintTone="warn"
          hint="details to confirm"
          onClick={() => toggle("hr")}
          active={tile === "hr"}
        />
        <StatCard
          label="With IT"
          value={withIt}
          hint="assets to collect"
          onClick={() => toggle("it")}
          active={tile === "it"}
        />
        <StatCard
          label="With Finance"
          value={withFinance}
          hint="settlements pending"
          onClick={() => toggle("finance")}
          active={tile === "finance"}
        />
      </section>
      {tile && <FilterNote label={tile} count={shown.length} onClear={() => setTile(null)} />}

      <div className="mt-4 grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 space-y-4">
          <Panel title={`Separations · ${shown.length}`}>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left label-mono border-b border-line">
                    <th className="px-4 py-2.5 font-medium">Person</th>
                    {canSeeAll && isHr && <th className="px-4 py-2.5 font-medium">Entity</th>}
                    <th className="px-4 py-2.5 font-medium">Last working day</th>
                    <th className="px-4 py-2.5 font-medium">Where it is</th>
                    <th className="px-4 py-2.5 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {shown.map((r) => {
                    const emp = empOf(r.employee_id);
                    return (
                      <tr
                        key={r.id}
                        className={`hover:bg-ink/[0.03] ${activeId === r.id ? "bg-ink/[0.04]" : ""}`}
                      >
                        <td className="px-4 py-3">
                          <p className="font-medium">{emp?.full_name ?? "—"}</p>
                          <p className="text-[11px] font-mono text-ink-soft">
                            {r.separation_kind === "involuntary" ? "termination" : "notice"} {fmtDate(r.notice_date)}
                          </p>
                        </td>
                        {canSeeAll && isHr && (
                          <td className="px-4 py-3">
                            <EntityTag company={emp ? companyById(emp.company_id) : undefined} />
                          </td>
                        )}
                        <td className="px-4 py-3 font-mono text-[12px] text-ink-soft">
                          {fmtDate(r.approved_last_day ?? r.requested_last_day)}
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-[12px] font-medium">
                            {SEPARATION_STAGE_LABEL[r.stage]}
                          </p>
                          <div className="mt-1.5">
                            <StageTrack row={r} />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => setOpenId(r.id)}
                            className="h-7 px-2.5 rounded-md ring-1 ring-line text-[11px] font-medium cursor-pointer hover:bg-ink/5"
                          >
                            Open
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {!visible.length && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-ink-soft">
                        {isHr ? "No separations in progress." : "You have no separation on record."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>

          {active && (
            <Panel
              title={`Clearance · ${empOf(active.employee_id)?.full_name ?? ""}`}
              meta={<span className="label-mono">{SEPARATION_STAGE_LABEL[active.stage]}</span>}
            >
              <div className="p-4 space-y-4">
                <div className="grid sm:grid-cols-3 gap-3 text-[13px]">
                  <div>
                    <p className="label-mono mb-1">
                      {active.separation_kind === "involuntary" ? "Termination · reason" : "Resignation · reason"}
                    </p>
                    <p>{active.reason || "—"}</p>
                  </div>
                  <div>
                    <p className="label-mono mb-1">
                      {active.separation_kind === "involuntary" ? "Started by" : "Notice period"}
                    </p>
                    <p>
                      {active.separation_kind === "involuntary"
                        ? (empOf(active.initiated_by ?? "")?.full_name ?? "—")
                        : `${active.notice_days} days`}
                    </p>
                  </div>
                  <div>
                    <p className="label-mono mb-1">
                      {active.separation_kind === "involuntary" ? "Effective date" : "Requested last day"}
                    </p>
                    <p>{fmtDate(active.requested_last_day)}</p>
                  </div>
                </div>

                {activeEmp && (
                  <SeparationWorkflow
                    separation={active}
                    employee={activeEmp}
                    me={me}
                    openAssetCount={openAssets.length}
                    employeesById={(id) => (id ? empOf(id) : undefined)}
                    companyName={companyById(activeEmp.company_id)?.name ?? "the company"}
                    fnfDefaults={{
                      last_day: active.approved_last_day ?? active.requested_last_day,
                      final_salary: String(worksheet?.finalSalary ?? 0),
                      encash_days: String(worksheet?.encashDays ?? 0),
                      encash_amount: String(worksheet?.encashAmount ?? 0),
                      unpaid_days: String(worksheet?.unpaidDays ?? 0),
                      unpaid_amount: String(worksheet?.unpaidAmount ?? 0),
                      expenses: String(worksheet?.expenses ?? 0),
                      reimbursement_pending: (worksheet?.expenses ?? 0) > 0 ? "Yes" : "No",
                      total_payable: String(
                        (worksheet?.finalSalary ?? 0) + (worksheet?.encashAmount ?? 0) + (worksheet?.expenses ?? 0),
                      ),
                      total_recoverable: String(worksheet?.unpaidAmount ?? 0),
                      net_payable: String(worksheet?.net ?? 0),
                      paid_on: today(),
                      approved_by: "Payroll",
                    }}
                    onFnfDone={() => payClaims(active)}
                  />
                )}

                {worksheet && (active.stage === "finance_settlement" || active.stage === "completed") && (
                  <div className="rounded-md bg-brand/[0.05] ring-1 ring-brand/15 p-3 text-[13px] space-y-1">
                    <p className="label-mono mb-1">Full & final worksheet</p>
                    <Line
                      label={`Salary to ${fmtDate(active.approved_last_day ?? active.requested_last_day)}`}
                      value={money(worksheet.finalSalary, worksheet.currency)}
                    />
                    <Line
                      label={`Unused leave paid out · ${worksheet.encashDays} days`}
                      value={money(worksheet.encashAmount, worksheet.currency)}
                    />
                    <Line
                      label={`Unpaid leave recovered · ${worksheet.unpaidDays} days`}
                      value={`− ${money(worksheet.unpaidAmount, worksheet.currency)}`}
                    />
                    <Line label="Approved expense claims still due" value={money(worksheet.expenses, worksheet.currency)} />
                    <div className="pt-1.5 mt-1.5 border-t border-brand/20">
                      <Line label="Net full & final" value={money(worksheet.net, worksheet.currency)} strong />
                    </div>
                  </div>
                )}

                {myOpen?.id === active.id && active.separation_kind !== "involuntary" && (
                  <button
                    onClick={() => revoke.mutate(active.id)}
                    disabled={active.stage === "finance_settlement"}
                    className="h-9 px-3 rounded-md ring-1 ring-line text-[12px] font-medium cursor-pointer hover:bg-ink/5"
                  >
                    Revoke my resignation
                  </button>
                )}
              </div>
            </Panel>
          )}

          {activeEmp && <AssetPanel employee={activeEmp} />}
        </div>

        <aside className="space-y-4">
          {!myOpen && myId && (
            <Panel title="Resign">
              <div className="p-4 space-y-3">
                <Select
                  label="Type"
                  value={notice.resignation_type}
                  onChange={(v) => setNotice({ ...notice, resignation_type: v })}
                  options={[
                    { value: "resignation", label: "Resignation" },
                    { value: "retirement", label: "Retirement" },
                    { value: "end_of_contract", label: "End of contract" },
                  ]}
                />
                <Input
                  label="Notice period (days)"
                  type="number"
                  value={notice.notice_days}
                  onChange={(v) =>
                    setNotice({
                      ...notice,
                      notice_days: v,
                      requested_last_day: addDays(Number(v) || 0),
                    })
                  }
                />
                <Input
                  label="Proposed last working day"
                  type="date"
                  value={notice.requested_last_day}
                  onChange={(v) => setNotice({ ...notice, requested_last_day: v })}
                />
                <Select
                  label="Reason for leaving"
                  value={notice.reason}
                  onChange={(v) => setNotice({ ...notice, reason: v })}
                  options={[
                    { value: "", label: "Choose…" },
                    ...EXIT_REASONS.map((r) => ({ value: r, label: r })),
                  ]}
                />
                <Input
                  label="Comments"
                  value={notice.comments}
                  onChange={(v) => setNotice({ ...notice, comments: v })}
                />
                <button
                  onClick={() => raise.mutate()}
                  disabled={raise.isPending}
                  className="w-full h-9 rounded-md bg-brand text-paper text-[12px] font-semibold cursor-pointer hover:bg-brand-deep disabled:opacity-60"
                >
                  {raise.isPending ? "Submitting…" : "Submit resignation"}
                </button>
              </div>
            </Panel>
          )}

          {(isHr || (org?.reports.length ?? 0) > 0) && (
            <Panel title="Start a termination">
              <div className="p-4 space-y-3">
                <p className="text-[12px] text-ink-soft">
                  For exits the company starts: performance, misconduct, redundancy, policy violation or absconding.
                  The employee is not told until the HR Head approves.
                </p>
                {termPicked ? (
                  <div className="flex items-center justify-between rounded-md ring-1 ring-line px-2.5 py-2 text-[13px]">
                    <span>
                      <span className="font-medium">{termPicked.full_name}</span>
                      <span className="block text-[11px] text-ink-soft">
                        {termPicked.job_title} · {termPicked.department}
                      </span>
                    </span>
                    <button
                      onClick={() => setTerm({ ...term, employee_id: "", search: "" })}
                      className="text-[11px] text-ink-soft hover:text-ink cursor-pointer"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <div>
                    <Input
                      label="Employee"
                      value={term.search}
                      onChange={(v) => setTerm({ ...term, search: v })}
                    />
                    {termMatches.length > 0 && (
                      <div className="mt-1 rounded-md ring-1 ring-line divide-y divide-line max-h-56 overflow-y-auto">
                        {termMatches.map((e) => (
                          <button
                            key={e.id}
                            onClick={() => setTerm({ ...term, employee_id: e.id, search: "" })}
                            className="w-full text-left px-2.5 py-1.5 text-[12.5px] hover:bg-brand/5 cursor-pointer"
                          >
                            {e.full_name}
                            <span className="block text-[11px] text-ink-soft">{e.email}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <Select
                  label="Reason for termination"
                  value={term.reason}
                  onChange={(v) => setTerm({ ...term, reason: v })}
                  options={[
                    { value: "", label: "Choose…" },
                    ...TERMINATION_REASONS.map((r) => ({ value: r, label: r })),
                  ]}
                />
                <Input
                  label="Termination effective date"
                  type="date"
                  value={term.effective_date}
                  onChange={(v) => setTerm({ ...term, effective_date: v })}
                />
                <label className="flex items-center gap-2 text-[12.5px]">
                  <input
                    type="checkbox"
                    checked={term.supporting_docs}
                    onChange={(e) => setTerm({ ...term, supporting_docs: e.target.checked })}
                    className="size-4 accent-[var(--color-brand)]"
                  />
                  Supporting documents attached
                </label>
                <Input
                  label="Details"
                  value={term.details}
                  onChange={(v) => setTerm({ ...term, details: v })}
                />
                <button
                  onClick={() => terminate.mutate()}
                  disabled={terminate.isPending}
                  className="w-full h-9 rounded-md bg-brand text-paper text-[12px] font-semibold cursor-pointer hover:bg-brand-deep disabled:opacity-60"
                >
                  {terminate.isPending ? "Starting…" : "Start termination"}
                </button>
              </div>
            </Panel>
          )}

          <Panel title="How a termination moves">
            <ol className="p-4 space-y-2.5 text-[12.5px]">
              {[
                ["Started by", "HRBP or the reporting manager fills the termination request."],
                ["Approvals, one after another", "Reporting manager → HRBP → HR Head → Legal → Payroll. Whoever started it skips their own step."],
                ["Who is told", "Legal and HR Head when it starts; the employee once HR Head approves; Payroll and Admin once fully approved."],
                ["Clearances", "IT and Admin clear 1 day before the last day."],
                ["Full & final and letter", "Payroll settles 2 days after the last day, then HR issues the relieving letter."],
                ["Escalation", "Any step untouched for 2 business days goes to the functional head, then the HR Head."],
              ].map(([h, d]) => (
                <li key={h}>
                  <span className="label-mono">{h}</span>
                  <p className="text-ink-soft">{d}</p>
                </li>
              ))}
            </ol>
          </Panel>

          <Panel title="How a resignation moves">
            <ol className="p-4 space-y-2.5 text-[12.5px]">
              {[
                ["Approvals, one after another", "Reporting manager (2 days) → HRBP (1 day) → Functional head, if one is set for the department → Payroll."],
                ["Clearances, side by side", "IT, Finance and Admin clear 2 days before the last day; HRBP holds the exit interview the day before."],
                ["Full & final", "Payroll settles salary, leave, recoveries and approved expenses after the last day."],
                ["Letters & closure", "HR issues the relieving and experience letters and the exit closes."],
                ["Escalation", "Any step untouched for 3 business days goes to the functional head, then the HR Head."],
              ].map(([h, d]) => (
                <li key={h}>
                  <span className="label-mono">{h}</span>
                  <p className="text-ink-soft">{d}</p>
                </li>
              ))}
            </ol>
          </Panel>
          {isHr && <DepartmentHeadsPanel />}
        </aside>
      </div>
    </>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={strong ? "font-medium" : "text-ink-soft"}>{label}</span>
      <span className={`font-mono ${strong ? "font-semibold" : ""}`}>{value}</span>
    </div>
  );
}
