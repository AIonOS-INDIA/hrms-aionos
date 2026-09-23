import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, FilterNote, EntityTag, Panel, StatCard, useScope } from "@/components/AppShell";
import { Input, Select } from "@/routes/_authenticated/employees";
import { AssetPanel } from "@/components/AssetPanel";
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

  const visible =
    isHr || isFinance
      ? rows.filter(
          (r) =>
            (isHr && scopedIds.has(r.employee_id)) ||
            (isFinance && financeIds.has(r.employee_id)) ||
            r.employee_id === myId ||
            !!empOf(r.employee_id)?.manager_id &&
              empOf(r.employee_id)?.manager_id === myId,
        )
      : rows.filter(
          (r) => r.employee_id === myId || empOf(r.employee_id)?.manager_id === myId,
        );

  const [openId, setOpenId] = useState("");
  const [tile, setTile] = useState<string | null>(null);
  const activeId = openId || (visible[0]?.id ?? "");
  const active = visible.find((r) => r.id === activeId);
  const empOf = (id: string) => employees.find((e) => e.id === id);

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
    resignation_type: "resignation",
    notice_days: "60",
    requested_last_day: addDays(60),
  });

  const raise = useMutation({
    mutationFn: async () => {
      if (!myId) throw new Error("No employee record linked to your account");
      if (visible.some((r) => !["completed", "withdrawn", "rejected"].includes(r.stage)))
        throw new Error("You already have a separation in progress");
      const { error } = await supabase.from("separation_requests").insert({
        employee_id: myId,
        reason: notice.reason,
        resignation_type: notice.resignation_type,
        notice_date: today(),
        notice_days: Number(notice.notice_days) || 0,
        requested_last_day: notice.requested_last_day,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Notice submitted to HR");
      setNotice({ ...notice, reason: "" });
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

  const finish = useMutation({
    mutationFn: async (row: SeparationRequest) => {
      const { error } = await supabase
        .from("separation_requests")
        .update({
          finance_status: "approved",
          finance_decided_at: new Date().toISOString(),
          settlement_paid_on: hr.settlement_paid_on || today(),
          settlement_amount: Number(hr.settlement_amount) || 0,
          final_salary_amount: worksheet?.finalSalary ?? 0,
          leave_encashment_days: worksheet?.encashDays ?? 0,
          leave_encashment_amount: worksheet?.encashAmount ?? 0,
          unpaid_leave_days: worksheet?.unpaidDays ?? 0,
          unpaid_leave_amount: worksheet?.unpaidAmount ?? 0,
          expense_reimbursement_amount: worksheet?.expenses ?? 0,
          finance_note: hr.finance_note,
          stage: "completed",
        })
        .eq("id", row.id);
      if (error) throw error;

      // Approved travel claims are paid out with the settlement.
      const dueClaimIds = claims
        .filter((c) => c.employee_id === row.employee_id && c.status === "approved")
        .map((c) => c.id);
      for (const claimId of dueClaimIds) {
        const claim = claims.find((c) => c.id === claimId)!;
        await supabase
          .from("expense_claims")
          .update({
            status: "reimbursed",
            reimbursed_on: hr.settlement_paid_on || today(),
            reimbursed_amount: Number(claim.total_amount),
            payment_reference: "Full & final settlement",
          })
          .eq("id", claimId);
      }

      const { error: empError } = await supabase
        .from("employees")
        .update({ status: "offboarded", exit_on: row.approved_last_day ?? row.requested_last_day })
        .eq("id", row.employee_id);
      if (empError) throw empError;
    },
    onSuccess: () => {
      toast.success("Full & final settled, exit recorded");
      queryClient.invalidateQueries({ queryKey: ["expense_claims"] });
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Editable desk fields for the open record
  const [hr, setHr] = useState({
    manager_note: "",
    approved_last_day: "",
    hr_note: "",
    it_assets: "",
    it_note: "",
    finance_note: "",
    settlement_amount: "0",
    settlement_paid_on: today(),
  });
  const [loadedFor, setLoadedFor] = useState("");
  if (active && loadedFor !== active.id) {
    setLoadedFor(active.id);
    setHr({
      manager_note: active.manager_note,
      approved_last_day: active.approved_last_day ?? active.requested_last_day,
      hr_note: active.hr_note,
      it_assets: active.it_assets,
      it_note: active.it_note,
      finance_note: active.finance_note,
      settlement_amount: String(
        Number(active.settlement_amount) || worksheet?.net || 0,
      ),
      settlement_paid_on: active.settlement_paid_on ?? today(),
    });
  }

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
                            notice {fmtDate(r.notice_date)}
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
                    <p className="label-mono mb-1">Reason</p>
                    <p>{active.reason || "—"}</p>
                  </div>
                  <div>
                    <p className="label-mono mb-1">Notice period</p>
                    <p>{active.notice_days} days</p>
                  </div>
                  <div>
                    <p className="label-mono mb-1">Requested last day</p>
                    <p>{fmtDate(active.requested_last_day)}</p>
                  </div>
                </div>

                {/* Direct manager */}
                <div className="rounded-md ring-1 ring-line p-3 space-y-3">
                  <p className="label-mono">
                    Step 1 · Direct manager — {active.manager_status}
                    {active.manager_decided_at
                      ? ` · ${fmtDate(active.manager_decided_at.slice(0, 10))}`
                      : ""}
                  </p>
                  {isManagerOfActive && active.manager_status === "pending" ? (
                    <>
                      <Input
                        label="Manager note (handover, cover, last day)"
                        value={hr.manager_note}
                        onChange={(v) => setHr({ ...hr, manager_note: v })}
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() =>
                            patch.mutate({
                              id: active.id,
                              values: {
                                manager_status: "approved",
                                manager_note: hr.manager_note,
                                manager_decided_at: new Date().toISOString(),
                                stage: "hr_review",
                              },
                            })
                          }
                          className="h-9 px-3 rounded-md bg-brand text-paper text-[12px] font-semibold cursor-pointer hover:bg-brand-deep"
                        >
                          Accept & send to HR
                        </button>
                        <button
                          onClick={() =>
                            patch.mutate({
                              id: active.id,
                              values: {
                                manager_status: "rejected",
                                manager_note: hr.manager_note,
                                manager_decided_at: new Date().toISOString(),
                              },
                            })
                          }
                          className="h-9 px-3 rounded-md ring-1 ring-line text-[12px] font-medium text-destructive cursor-pointer hover:bg-ink/5"
                        >
                          Raise a concern
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="text-[13px] text-ink-soft">
                      {active.manager_note ||
                        (active.manager_status === "pending"
                          ? "Waiting for the reporting manager to acknowledge the notice."
                          : "Manager decision recorded.")}
                    </p>
                  )}
                </div>

                {/* HR */}
                <div className="rounded-md ring-1 ring-line p-3 space-y-3">
                  <p className="label-mono">
                    Step 2 · HR separation details — {active.hr_status}
                  </p>
                  {isHr ? (
                    <>
                      <div className="grid sm:grid-cols-2 gap-3">
                        <Input
                          label="Agreed last working day"
                          type="date"
                          value={hr.approved_last_day}
                          onChange={(v) => setHr({ ...hr, approved_last_day: v })}
                        />
                        <Input
                          label="HR note"
                          value={hr.hr_note}
                          onChange={(v) => setHr({ ...hr, hr_note: v })}
                        />
                      </div>
                      <label className="flex items-center gap-2 text-[13px]">
                        <input
                          type="checkbox"
                          className="size-4 accent-black cursor-pointer"
                          checked={active.exit_interview_done}
                          onChange={(e) =>
                            patch.mutate({
                              id: active.id,
                              values: { exit_interview_done: e.target.checked },
                            })
                          }
                        />
                        Exit interview done
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() =>
                            patch.mutate({
                              id: active.id,
                              values: {
                                hr_status: "approved",
                                hr_note: hr.hr_note,
                                approved_last_day: hr.approved_last_day,
                                hr_decided_at: new Date().toISOString(),
                                stage: "it_clearance",
                              },
                            })
                          }
                          disabled={active.hr_status === "approved"}
                          className="h-9 px-3 rounded-md bg-brand text-paper text-[12px] font-semibold cursor-pointer hover:bg-brand-deep disabled:opacity-50"
                        >
                          Accept & send to IT
                        </button>
                        <button
                          onClick={() =>
                            patch.mutate({
                              id: active.id,
                              values: {
                                hr_status: "rejected",
                                hr_note: hr.hr_note,
                                hr_decided_at: new Date().toISOString(),
                                stage: "rejected",
                              },
                            })
                          }
                          className="h-9 px-3 rounded-md ring-1 ring-line text-[12px] font-medium text-destructive cursor-pointer hover:bg-ink/5"
                        >
                          Decline
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="text-[13px] text-ink-soft">
                      {active.hr_note || "Your HR team is confirming the details."}
                    </p>
                  )}
                </div>

                {/* IT */}
                <div className="rounded-md ring-1 ring-line p-3 space-y-3">
                  {openAssets.length > 0 && (
                    <p className="text-[12.5px] text-ink-soft">
                      {openAssets.length} item{openAssets.length === 1 ? "" : "s"} still with this
                      person — mark each one returned in the asset list below.
                    </p>
                  )}
                  <p className="label-mono">Step 3 · IT asset return — {active.it_status}</p>
                  {isHr ? (
                    <>
                      <div className="grid sm:grid-cols-2 gap-3">
                        <Input
                          label="Assets to return"
                          value={hr.it_assets}
                          onChange={(v) => setHr({ ...hr, it_assets: v })}
                        />
                        <Input
                          label="IT note"
                          value={hr.it_note}
                          onChange={(v) => setHr({ ...hr, it_note: v })}
                        />
                      </div>
                      <button
                        onClick={() =>
                          patch.mutate({
                            id: active.id,
                             values: {
                               it_status: "approved",
                               it_assets: hr.it_assets,
                               it_note: hr.it_note,
                               it_decided_at: new Date().toISOString(),
                               stage: "finance_settlement",
                               finance_routed_at: new Date().toISOString(),
                               final_salary_amount: worksheet?.finalSalary ?? 0,
                               leave_encashment_days: worksheet?.encashDays ?? 0,
                               leave_encashment_amount: worksheet?.encashAmount ?? 0,
                               unpaid_leave_days: worksheet?.unpaidDays ?? 0,
                               unpaid_leave_amount: worksheet?.unpaidAmount ?? 0,
                               expense_reimbursement_amount: worksheet?.expenses ?? 0,
                               settlement_amount: worksheet?.net ?? 0,
                             },
                          })
                        }
                        disabled={
                          active.hr_status !== "approved" ||
                          active.it_status === "approved" ||
                          openAssets.length > 0
                        }
                        className="h-9 px-3 rounded-md bg-brand text-paper text-[12px] font-semibold cursor-pointer hover:bg-brand-deep disabled:opacity-50"
                      >
                        Assets returned & access closed
                      </button>
                    </>
                  ) : (
                    <p className="text-[13px] text-ink-soft">
                      {active.it_assets
                        ? `To return: ${active.it_assets}`
                        : "Nothing listed for return yet."}
                    </p>
                  )}
                </div>

                {/* Finance */}
                <div className="rounded-md ring-1 ring-line p-3 space-y-3">
                  <p className="label-mono">
                    Step 4 · Full & final settlement — {active.finance_status}
                    {active.finance_routed_at
                      ? ` · with finance since ${fmtDate(active.finance_routed_at.slice(0, 10))}`
                      : ""}
                  </p>

                  {worksheet && (
                    <div className="rounded-md bg-brand/[0.05] ring-1 ring-brand/15 p-3 text-[13px] space-y-1">
                      <p className="label-mono mb-1">What finance owes</p>
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
                      <Line
                        label="Approved expense claims still due"
                        value={money(worksheet.expenses, worksheet.currency)}
                      />
                      <div className="pt-1.5 mt-1.5 border-t border-brand/20">
                        <Line
                          label="Net full & final"
                          value={money(worksheet.net, worksheet.currency)}
                          strong
                        />
                      </div>
                    </div>
                  )}

                  {isHr || isFinance ? (
                    <>
                      <div className="grid sm:grid-cols-3 gap-3">
                        <Input
                          label="Settlement amount"
                          type="number"
                          value={hr.settlement_amount}
                          onChange={(v) => setHr({ ...hr, settlement_amount: v })}
                        />
                        <Input
                          label="Pay out on"
                          type="date"
                          value={hr.settlement_paid_on}
                          onChange={(v) => setHr({ ...hr, settlement_paid_on: v })}
                        />
                        <Input
                          label="Finance note"
                          value={hr.finance_note}
                          onChange={(v) => setHr({ ...hr, finance_note: v })}
                        />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() =>
                            setHr({
                              ...hr,
                              settlement_amount: String(worksheet?.net ?? 0),
                            })
                          }
                          className="h-9 px-3 rounded-md ring-1 ring-line text-[12px] font-medium cursor-pointer hover:bg-ink/5"
                        >
                          Use calculated amount
                        </button>
                        <button
                          onClick={() => finish.mutate(active)}
                          disabled={
                            active.it_status !== "approved" ||
                            active.stage === "completed" ||
                            finish.isPending
                          }
                          className="h-9 px-3 rounded-md bg-brand text-paper text-[12px] font-semibold cursor-pointer hover:bg-brand-deep disabled:opacity-50"
                        >
                          {finish.isPending ? "Paying out…" : "Pay out & close exit"}
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="text-[13px] text-ink-soft">
                      {active.finance_status === "approved"
                        ? `${money(Number(active.settlement_amount))} settled${
                            active.settlement_paid_on
                              ? ` on ${fmtDate(active.settlement_paid_on)}`
                              : ""
                          }`
                        : "Settlement is calculated once assets are returned."}
                    </p>
                  )}
                </div>

                {!isHr && myOpen?.id === active.id && (
                  <button
                    onClick={() =>
                      patch.mutate({ id: active.id, values: { stage: "withdrawn" } })
                    }
                    className="h-9 px-3 rounded-md ring-1 ring-line text-[12px] font-medium cursor-pointer hover:bg-ink/5"
                  >
                    Withdraw my notice
                  </button>
                )}
              </div>
            </Panel>
          )}

          {activeEmp && <AssetPanel employee={activeEmp} />}
        </div>

        <aside className="space-y-4">
          {!myOpen && myId && (
            <Panel title="Give notice">
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
                <Input
                  label="Reason"
                  value={notice.reason}
                  onChange={(v) => setNotice({ ...notice, reason: v })}
                />
                <button
                  onClick={() => raise.mutate()}
                  disabled={raise.isPending}
                  className="w-full h-9 rounded-md bg-brand text-paper text-[12px] font-semibold cursor-pointer hover:bg-brand-deep disabled:opacity-60"
                >
                  {raise.isPending ? "Submitting…" : "Submit notice"}
                </button>
              </div>
            </Panel>
          )}

          <Panel title="How it moves">
            <ol className="p-4 space-y-3 text-[13px]">
              <li>
                <span className="label-mono">1 · Notice</span>
                <p className="text-ink-soft">Employee submits notice with a proposed last day.</p>
              </li>
              <li>
                <span className="label-mono">2 · Manager</span>
                <p className="text-ink-soft">
                  The reporting manager accepts the notice and confirms handover.
                </p>
              </li>
              <li>
                <span className="label-mono">3 · HR</span>
                <p className="text-ink-soft">
                  HR confirms the last working day, handover and exit interview.
                </p>
              </li>
              <li>
                <span className="label-mono">4 · IT</span>
                <p className="text-ink-soft">Laptop and other assets returned, access closed.</p>
              </li>
              <li>
                <span className="label-mono">5 · Finance</span>
                <p className="text-ink-soft">
                  Full and final amount paid out and the exit is recorded.
                </p>
              </li>
            </ol>
          </Panel>
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
