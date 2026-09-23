import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, FilterNote, EntityTag, Panel, StatCard, StatusPill, useScope } from "@/components/AppShell";
import { Input, Select } from "@/routes/_authenticated/employees";
import {
  exportSpec,
  importSpec,
  loadCtx,
  specByKey,
  templateRow,
  type ImportResult,
  type Row,
} from "@/lib/data-io";
import {
  computePay,
  firstOfMonth,
  money,
  monthLabel,
  usePayrollRuns,
  usePayslips,
  useSalaryStructures,
  useEmployees,
  useEntityPaySettings,
  useLeaveRequests,
  useLeaveTypes,
  useMe,
  useTimesheets,
} from "@/lib/hrms";

export const Route = createFileRoute("/_authenticated/payroll")({
  head: () => ({
    meta: [
      { title: "Payroll — AIONOS HR Control Tower" },
      {
        name: "description",
        content:
          "Set salary structures, run monthly payroll for each company and give every employee their payslips.",
      },
      { property: "og:title", content: "Payroll — AIONOS HR Control Tower" },
      { property: "og:description", content: "Salaries, payroll runs and payslips." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PayrollPage,
});

function PayrollPage() {
  return (
    <AppShell title="Payroll" subtitle="Salaries · runs · payslips">
      <PayrollBody />
    </AppShell>
  );
}

function PayrollBody() {
  const { data: me } = useMe();
  const { companyId, companyById, canSeeAll } = useScope();
  const { data: employees = [] } = useEmployees();
  const { data: structures = [] } = useSalaryStructures();
  const { data: runs = [] } = usePayrollRuns();
  const { data: payslips = [] } = usePayslips();
  const { data: timesheets = [] } = useTimesheets();
  const { data: leaveRequests = [] } = useLeaveRequests();
  const { data: leaveTypes = [] } = useLeaveTypes();
  const { data: paySettings = [] } = useEntityPaySettings();
  const queryClient = useQueryClient();

  const isHr = !!me?.isMaster || !!me?.hrCompanyId || !!me?.isPayrollApprover;
  /** Only Master HR and payroll approvers touch salary records. */
  const canManagePay = !!me?.isMaster || !!me?.isPayrollApprover;
  const myId = me?.employee?.id;

  const scoped = useMemo(
    () =>
      (companyId ? employees.filter((e) => e.company_id === companyId) : employees).filter(
        (e) => e.status !== "offboarded",
      ),
    [employees, companyId],
  );
  const scopedIds = useMemo(() => new Set(scoped.map((e) => e.id)), [scoped]);

  const [period, setPeriodState] = useState(firstOfMonth().slice(0, 7));
  const setPeriod = setPeriodState;

  /** Hours signed off for the payroll month, per person. */
  const approvedHours = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of timesheets) {
      if (!t.week_start.startsWith(period)) continue;
      if (t.status !== "approved") continue;
      map.set(t.employee_id, (map.get(t.employee_id) ?? 0) + Number(t.total_hours));
    }
    return map;
  }, [timesheets, period]);

  const awaitingApproval = useMemo(
    () =>
      timesheets.filter(
        (t) =>
          t.week_start.startsWith(period) && t.status === "submitted" && scopedIds.has(t.employee_id),
      ),
    [timesheets, period, scopedIds],
  );

  /** Leave types that are not paid — those days come off the paycheck. */
  const unpaidTypeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const t of leaveTypes) {
      const label = `${t.code} ${t.name}`.toLowerCase();
      if (
        Number(t.annual_days) <= 0 ||
        label.includes("unpaid") ||
        label.includes("without pay") ||
        label.includes("lwp") ||
        label.includes("loss of pay")
      ) {
        ids.add(t.id);
      }
    }
    return ids;
  }, [leaveTypes]);

  /** Approved leave falling inside the payroll month, split paid vs unpaid. */
  const leaveInMonth = useMemo(() => {
    const monthStart = new Date(`${period}-01T00:00:00`);
    const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
    const day = 86_400_000;
    const map = new Map<string, { paid: number; unpaid: number; pending: number }>();
    for (const r of leaveRequests) {
      const start = new Date(`${r.start_date}T00:00:00`);
      const end = new Date(`${r.end_date}T00:00:00`);
      if (end < monthStart || start > monthEnd) continue;
      if (r.status === "rejected" || r.status === "cancelled") continue;
      const span = Math.round((end.getTime() - start.getTime()) / day) + 1;
      const from = start < monthStart ? monthStart : start;
      const to = end > monthEnd ? monthEnd : end;
      const inMonth = Math.round((to.getTime() - from.getTime()) / day) + 1;
      const days = (Number(r.days) || span) * (inMonth / Math.max(1, span));
      const cur = map.get(r.employee_id) ?? { paid: 0, unpaid: 0, pending: 0 };
      if (r.status === "pending") cur.pending += days;
      else if (unpaidTypeIds.has(r.leave_type_id)) cur.unpaid += days;
      else cur.paid += days;
      map.set(r.employee_id, cur);
    }
    for (const [, v] of map) {
      v.paid = Math.round(v.paid * 2) / 2;
      v.unpaid = Math.round(v.unpaid * 2) / 2;
      v.pending = Math.round(v.pending * 2) / 2;
    }
    return map;
  }, [leaveRequests, period, unpaidTypeIds]);

  const pendingLeaveCount = useMemo(
    () =>
      [...leaveInMonth.entries()].filter(([id, v]) => scopedIds.has(id) && v.pending > 0).length,
    [leaveInMonth, scopedIds],
  );

  /** Working days a legal entity counts in a month. */
  const monthDaysFor = (companyKey: string) =>
    Number(paySettings.find((p) => p.company_id === companyKey)?.working_days_per_month) || 30;

  const latestStructure = (employeeId: string) =>
    structures.find((s) => s.employee_id === employeeId);

  const mySlips = payslips.filter((p) => p.employee_id === myId);
  const visibleSlips = isHr ? payslips.filter((p) => scopedIds.has(p.employee_id)) : mySlips;
  const visibleRuns = companyId ? runs.filter((r) => r.company_id === companyId) : runs;

  const [focus, setFocus] = useState("");
  const [salarySearch, setSalarySearch] = useState("");
  const [tile, setTile] = useState<string | null>(null);
  const focusId = focus || (scoped[0]?.id ?? "");
  const focusStructure = latestStructure(focusId);

  const [salaryForm, setSalaryForm] = useState({
    annual_ctc: "",
    monthly_basic: "",
    monthly_hra: "",
    monthly_allowances: "",
    monthly_deductions: "",
    tax_percent: "10",
    currency: "INR",
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["salary_structures"] });
    queryClient.invalidateQueries({ queryKey: ["payroll_runs"] });
    queryClient.invalidateQueries({ queryKey: ["payslips"] });
  };

  const saveSalary = useMutation({
    mutationFn: async () => {
      if (!focusId) throw new Error("Pick an employee first");
      const payload = {
        employee_id: focusId,
        effective_from: `${period}-01`,
        currency: salaryForm.currency,
        annual_ctc: Number(salaryForm.annual_ctc) || 0,
        monthly_basic: Number(salaryForm.monthly_basic) || 0,
        monthly_hra: Number(salaryForm.monthly_hra) || 0,
        monthly_allowances: Number(salaryForm.monthly_allowances) || 0,
        monthly_deductions: Number(salaryForm.monthly_deductions) || 0,
        tax_percent: Number(salaryForm.tax_percent) || 0,
      };
      const existing = focusStructure;
      const { error } = existing
        ? await supabase.from("salary_structures").update(payload).eq("id", existing.id)
        : await supabase.from("salary_structures").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Salary saved");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runPayroll = useMutation({
    mutationFn: async () => {
      const target = companyId ?? me?.hrCompanyId ?? me?.payrollCompanyIds[0];
      if (!target) throw new Error("Pick a single company before running payroll");
      const month = `${period}-01`;

      const { data: run, error: runError } = await supabase
        .from("payroll_runs")
        .upsert(
          { company_id: target, period_month: month, status: "processed", processed_at: new Date().toISOString() },
          { onConflict: "company_id,period_month" },
        )
        .select("id")
        .single();
      if (runError) throw runError;

      const monthDays = monthDaysFor(target);
      const people = employees.filter((e) => e.company_id === target && e.status !== "offboarded");
      const rows = people
        .map((e) => {
          const s = latestStructure(e.id);
          if (!s) return null;
          const lop = leaveInMonth.get(e.id)?.unpaid ?? 0;
          const pay = computePay(s, lop, monthDays);
          return {
            payroll_run_id: run.id,
            employee_id: e.id,
            period_month: month,
            currency: s.currency,
            gross_pay: pay.gross,
            deductions: pay.deductions,
            tax: pay.tax,
            net_pay: pay.net,
            paid_days: Math.round((monthDays - lop) * 10) / 10,
            loss_of_pay_days: lop,
            status: "processed" as const,
          };
        })
        .filter(Boolean) as NonNullable<ReturnType<() => never>>[] | never[];

      if (!rows.length) throw new Error("No salary structures set for this company yet");
      const { error } = await supabase
        .from("payslips")
        .upsert(rows, { onConflict: "employee_id,period_month" });
      if (error) throw error;
      return rows.length;
    },
    onSuccess: (count) => {
      toast.success(`Payroll processed for ${count} people`);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const markPaid = useMutation({
    mutationFn: async (runId: string) => {
      const { error } = await supabase
        .from("payroll_runs")
        .update({ status: "paid" })
        .eq("id", runId);
      if (error) throw error;
      const { error: slipError } = await supabase
        .from("payslips")
        .update({ status: "paid" })
        .eq("payroll_run_id", runId);
      if (slipError) throw slipError;
    },
    onSuccess: () => {
      toast.success("Marked as paid");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  type PayForm = { paid_on: string; paid_amount: string; payment_reference: string };
  const [payForm, setPayForm] = useState<Record<string, PayForm>>({});

  const hrApprove = useMutation({
    mutationFn: async (slipId: string) => {
      const { error } = await supabase
        .from("payslips")
        .update({ hr_status: "approved", hr_decided_at: new Date().toISOString() })
        .eq("id", slipId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Payslip approved — ready for finance");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const financeSignOff = useMutation({
    mutationFn: async (v: { id: string; form: PayForm }) => {
      const amount = Number(v.form.paid_amount) || 0;
      if (!v.form.paid_on) throw new Error("Add the payment date");
      if (amount <= 0) throw new Error("Add the amount paid");
      const { error } = await supabase
        .from("payslips")
        .update({
          finance_status: "approved",
          finance_decided_at: new Date().toISOString(),
          paid_on: v.form.paid_on,
          paid_amount: amount,
          payment_reference: v.form.payment_reference,
          status: "paid",
        })
        .eq("id", v.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Payment recorded");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const monthSlips = visibleSlips.filter((p) => p.period_month.slice(0, 7) === period);
  const awaitingHr = monthSlips.filter((p) => p.hr_status !== "approved");
  const awaitingFinance = monthSlips.filter(
    (p) => p.hr_status === "approved" && p.finance_status !== "approved",
  );
  const salaryMatches = (
    tile === "missing" ? scoped.filter((e) => !latestStructure(e.id)) : scoped
  ).filter((e) => {
    const q = salarySearch.trim().toLowerCase();
    if (!q) return true;
    return (
      e.full_name.toLowerCase().includes(q) ||
      e.email.toLowerCase().includes(q) ||
      e.job_title.toLowerCase().includes(q)
    );
  });
  const scopedShown = salaryMatches.slice(0, 100);
  const monthCost = monthSlips.reduce((s, p) => s + Number(p.gross_pay), 0);
  const monthNet = monthSlips.reduce((s, p) => s + Number(p.net_pay), 0);
  const withoutSalary = scoped.filter((e) => !latestStructure(e.id)).length;

  /** Everything that decides this month's paycheck, person by person. */
  const worksheet = useMemo(() => {
    const q = salarySearch.trim().toLowerCase();
    return scoped
      .filter((e) => (q ? `${e.full_name} ${e.email}`.toLowerCase().includes(q) : true))
      .map((e) => {
        const s = latestStructure(e.id);
        const leave = leaveInMonth.get(e.id) ?? { paid: 0, unpaid: 0, pending: 0 };
        const days = monthDaysFor(e.company_id);
        const pay = s ? computePay(s, leave.unpaid, days) : null;
        const slip = monthSlips.find((p) => p.employee_id === e.id);
        return { person: e, structure: s, leave, days, pay, slip, hours: approvedHours.get(e.id) ?? 0 };
      })
      .filter((r) => (tile === "leave" ? r.leave.unpaid > 0 || r.leave.pending > 0 : true))
      .filter((r) => (tile === "missing" ? !r.structure : true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped, salarySearch, leaveInMonth, structures, monthSlips, approvedHours, tile, paySettings]);

  const unpaidDaysTotal =
    Math.round(
      [...leaveInMonth.entries()]
        .filter(([id]) => scopedIds.has(id))
        .reduce((s, [, v]) => s + v.unpaid, 0) * 10,
    ) / 10;

  return (
    <>
      <section className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {isHr ? (
          <>
            <StatCard
              label="Payslips this month"
              value={monthSlips.length}
              hint={monthLabel(period)}
              onClick={() => setTile(null)}
              active={tile === null}
            />
            <StatCard label="Gross cost" value={money(monthCost)} />
            <StatCard label="Net payout" value={money(monthNet)} hintTone="good" />
            <StatCard
              label="Unpaid leave days"
              value={unpaidDaysTotal}
              hint={pendingLeaveCount ? `${pendingLeaveCount} still to decide` : "click to review"}
              hintTone={pendingLeaveCount ? "warn" : undefined}
              onClick={() => setTile((p) => (p === "leave" ? null : "leave"))}
              active={tile === "leave"}
            />
            <StatCard
              label="Salary not set"
              value={withoutSalary}
              hintTone="warn"
              hint="click to review"
              onClick={() => setTile((p) => (p === "missing" ? null : "missing"))}
              active={tile === "missing"}
            />
          </>
        ) : (
          <>
            <StatCard label="Payslips" value={mySlips.length} hint="available to you" />
            <StatCard
              label="Last net pay"
              value={mySlips[0] ? money(Number(mySlips[0].net_pay), mySlips[0].currency) : "—"}
              hint={mySlips[0] ? monthLabel(mySlips[0].period_month) : ""}
            />
            <StatCard
              label="Last gross"
              value={mySlips[0] ? money(Number(mySlips[0].gross_pay), mySlips[0].currency) : "—"}
            />
            <StatCard
              label="Year to date net"
              value={money(
                mySlips
                  .filter((p) => p.period_month.startsWith(String(new Date().getFullYear())))
                  .reduce((s, p) => s + Number(p.net_pay), 0),
              )}
            />
          </>
        )}
      </section>
      {isHr && tile === "missing" && (
        <FilterNote
          label="people without a salary structure"
          count={scopedShown.length}
          onClear={() => setTile(null)}
        />
      )}
      {isHr && tile === "leave" && (
        <FilterNote
          label="people with leave affecting this month's pay"
          count={worksheet.length}
          onClear={() => setTile(null)}
        />
      )}

      <div className="mt-4 grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 space-y-4">
          {isHr && (
            <Panel
              title={`Payroll worksheet · ${monthLabel(period)}`}
              meta={
                <input
                  value={salarySearch}
                  onChange={(e) => setSalarySearch(e.target.value)}
                  placeholder="Search people"
                  className="h-7 w-44 px-2 rounded-md bg-paper ring-1 ring-line text-[12px] outline-none focus:ring-ink"
                />
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left label-mono border-b border-line">
                      <th className="px-4 py-2.5 font-medium">Employee</th>
                      {canSeeAll && <th className="px-4 py-2.5 font-medium">Entity</th>}
                      <th className="px-4 py-2.5 font-medium hidden md:table-cell">Hours approved</th>
                      <th className="px-4 py-2.5 font-medium">Leave taken</th>
                      <th className="px-4 py-2.5 font-medium">Paid days</th>
                      <th className="px-4 py-2.5 font-medium">Net this month</th>
                      {canManagePay && <th className="px-4 py-2.5 font-medium text-right">Action</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {worksheet.slice(0, 100).map((r) => (
                      <tr
                        key={r.person.id}
                        className={`hover:bg-ink/[0.03] ${focusId === r.person.id ? "bg-ink/[0.04]" : ""}`}
                      >
                        <td className="px-4 py-3">
                          <p className="font-medium">{r.person.full_name}</p>
                          <p className="text-[11px] font-mono text-ink-soft">{r.person.job_title}</p>
                        </td>
                        {canSeeAll && (
                          <td className="px-4 py-3">
                            <EntityTag company={companyById(r.person.company_id)} />
                          </td>
                        )}
                        <td className="px-4 py-3 font-mono text-[12px] text-ink-soft hidden md:table-cell">
                          {r.hours ? `${r.hours} h` : "—"}
                        </td>
                        <td className="px-4 py-3 text-[12px]">
                          <span className="font-mono text-ink-soft">{r.leave.paid} paid</span>
                          {r.leave.unpaid > 0 && (
                            <span className="ml-1 font-mono text-warn">
                              · {r.leave.unpaid} unpaid
                            </span>
                          )}
                          {r.leave.pending > 0 && (
                            <span className="ml-1 font-mono text-ink-soft">
                              · {r.leave.pending} awaiting a decision
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-[12px]">
                          {Math.round((r.days - r.leave.unpaid) * 10) / 10} / {r.days}
                        </td>
                        <td className="px-4 py-3 font-mono text-[12px] font-semibold">
                          {r.pay ? money(r.pay.net, r.structure!.currency) : "salary not set"}
                        </td>
                        {canManagePay && (
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => {
                                setFocus(r.person.id);
                                const cur = r.structure;
                                setSalaryForm({
                                  annual_ctc: String(cur?.annual_ctc ?? ""),
                                  monthly_basic: String(cur?.monthly_basic ?? ""),
                                  monthly_hra: String(cur?.monthly_hra ?? ""),
                                  monthly_allowances: String(cur?.monthly_allowances ?? ""),
                                  monthly_deductions: String(cur?.monthly_deductions ?? ""),
                                  tax_percent: String(cur?.tax_percent ?? 10),
                                  currency: cur?.currency ?? "INR",
                                });
                              }}
                              className="h-7 px-2.5 rounded-md ring-1 ring-line text-[11px] font-medium cursor-pointer hover:bg-ink/5"
                            >
                              Edit pay
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                    {!worksheet.length && (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-ink-soft">
                          Nobody matches this view.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {worksheet.length > 100 && (
                <p className="px-4 py-3 text-[12px] text-ink-soft border-t border-line">
                  Showing the first 100 of {worksheet.length} — search to narrow it down.
                </p>
              )}
            </Panel>
          )}

          {isHr && (
            <Panel
              title={`Payments · ${monthLabel(period)}`}
              meta={
                <span className="label-mono">
                  {awaitingHr.length} to approve · {awaitingFinance.length} to pay
                </span>
              }
            >
              <div className="divide-y divide-line">
                {monthSlips.map((p) => {
                  const person = employees.find((e) => e.id === p.employee_id);
                  const form = payForm[p.id] ?? {
                    paid_on: new Date().toISOString().slice(0, 10),
                    paid_amount: String(Number(p.net_pay)),
                    payment_reference: "",
                  };
                  return (
                    <div key={p.id} className="px-4 py-3 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-medium truncate">
                            {person?.full_name ?? "—"}
                          </p>
                          <p className="text-[11px] font-mono text-ink-soft">
                            Net {money(Number(p.net_pay), p.currency)} ·{" "}
                            {p.hr_status === "approved" ? "HR approved" : "HR pending"} ·{" "}
                            {p.finance_status === "approved"
                              ? "finance signed off"
                              : "finance pending"}
                          </p>
                        </div>
                        {p.hr_status !== "approved" && (
                          <button
                            onClick={() => hrApprove.mutate(p.id)}
                            className="h-7 px-2.5 rounded-md bg-brand text-paper text-[11.5px] font-semibold cursor-pointer hover:bg-brand-deep"
                          >
                            HR approve
                          </button>
                        )}
                        {p.finance_status === "approved" && (
                          <StatusPill status="approved" />
                        )}
                      </div>

                      {p.finance_status === "approved" ? (
                        <p className="text-[12px] text-ink-soft">
                          Paid {money(Number(p.paid_amount), p.currency)} on{" "}
                          {p.paid_on ?? "—"}
                          {p.payment_reference ? ` · ref ${p.payment_reference}` : ""}
                        </p>
                      ) : (
                        p.hr_status === "approved" && (
                          <div className="flex flex-wrap items-end gap-2">
                            <label className="text-[11px] font-mono text-ink-soft">
                              Payment date
                              <input
                                type="date"
                                value={form.paid_on}
                                onChange={(e) =>
                                  setPayForm({
                                    ...payForm,
                                    [p.id]: { ...form, paid_on: e.target.value },
                                  })
                                }
                                className="block h-8 px-2 rounded-md bg-paper ring-1 ring-line text-[12px] outline-none focus:ring-brand"
                              />
                            </label>
                            <label className="text-[11px] font-mono text-ink-soft">
                              Amount paid
                              <input
                                type="number"
                                value={form.paid_amount}
                                onChange={(e) =>
                                  setPayForm({
                                    ...payForm,
                                    [p.id]: { ...form, paid_amount: e.target.value },
                                  })
                                }
                                className="block h-8 w-28 px-2 rounded-md bg-paper ring-1 ring-line text-[12px] outline-none focus:ring-brand"
                              />
                            </label>
                            <label className="text-[11px] font-mono text-ink-soft">
                              Reference
                              <input
                                value={form.payment_reference}
                                onChange={(e) =>
                                  setPayForm({
                                    ...payForm,
                                    [p.id]: { ...form, payment_reference: e.target.value },
                                  })
                                }
                                placeholder="UTR / transfer id"
                                className="block h-8 w-40 px-2 rounded-md bg-paper ring-1 ring-line text-[12px] outline-none focus:ring-brand"
                              />
                            </label>
                            <button
                              onClick={() => financeSignOff.mutate({ id: p.id, form })}
                              className="h-8 px-3 rounded-md bg-brand text-paper text-[12px] font-semibold cursor-pointer hover:bg-brand-deep"
                            >
                              Finance sign off
                            </button>
                          </div>
                        )
                      )}
                    </div>
                  );
                })}
                {!monthSlips.length && (
                  <p className="px-4 py-8 text-center text-ink-soft text-[13px]">
                    Run payroll for this month to see payments here.
                  </p>
                )}
              </div>
            </Panel>
          )}

          <Panel
            title={isHr ? `Payslips · ${monthLabel(period)}` : "My payslips"}
            meta={<span className="label-mono">{(isHr ? monthSlips : mySlips).length} records</span>}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left label-mono border-b border-line">
                    {isHr && <th className="px-4 py-2.5 font-medium">Employee</th>}
                    <th className="px-4 py-2.5 font-medium">Month</th>
                    <th className="px-4 py-2.5 font-medium">Gross</th>
                    <th className="px-4 py-2.5 font-medium hidden sm:table-cell">Deductions</th>
                    <th className="px-4 py-2.5 font-medium hidden sm:table-cell">Tax</th>
                    <th className="px-4 py-2.5 font-medium">Net</th>
                    <th className="px-4 py-2.5 font-medium">Paid</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {(isHr ? monthSlips : mySlips).map((p) => (
                    <tr key={p.id} className="hover:bg-ink/[0.03]">
                      {isHr && (
                        <td className="px-4 py-3 font-medium">
                          {employees.find((e) => e.id === p.employee_id)?.full_name ?? "—"}
                        </td>
                      )}
                      <td className="px-4 py-3 font-mono text-[12px] text-ink-soft">
                        {monthLabel(p.period_month)}
                      </td>
                      <td className="px-4 py-3 font-mono text-[12px]">
                        {money(Number(p.gross_pay), p.currency)}
                      </td>
                      <td className="px-4 py-3 font-mono text-[12px] text-ink-soft hidden sm:table-cell">
                        {money(Number(p.deductions), p.currency)}
                      </td>
                      <td className="px-4 py-3 font-mono text-[12px] text-ink-soft hidden sm:table-cell">
                        {money(Number(p.tax), p.currency)}
                      </td>
                      <td className="px-4 py-3 font-mono text-[12px] font-semibold">
                        {money(Number(p.net_pay), p.currency)}
                      </td>
                      <td className="px-4 py-3 font-mono text-[12px] text-ink-soft">
                        {p.finance_status === "approved"
                          ? `${money(Number(p.paid_amount), p.currency)} · ${p.paid_on ?? ""}`
                          : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill
                          status={
                            p.finance_status === "approved"
                              ? "approved"
                              : p.hr_status === "approved"
                                ? "submitted"
                                : "pending"
                          }
                        />
                      </td>
                    </tr>
                  ))}
                  {!(isHr ? monthSlips : mySlips).length && (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-ink-soft">
                        No payslips yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>

        <aside className="space-y-4">
          <Panel title="Month">
            <div className="p-4 space-y-3">
              <Input label="Payroll month" type="month" value={period} onChange={setPeriod} />
              {isHr && (
                <button
                  onClick={() => runPayroll.mutate()}
                  disabled={runPayroll.isPending}
                  className="w-full h-9 rounded-md bg-brand text-paper text-[12px] font-semibold cursor-pointer hover:bg-brand-deep disabled:opacity-60"
                >
                  {runPayroll.isPending ? "Processing…" : "Run payroll for this month"}
                </button>
              )}
              {isHr && canSeeAll && !companyId && (
                <p className="text-[11px] font-mono text-ink-soft">
                  Choose one entity on the left to run payroll.
                </p>
              )}
              {isHr && (
                <p className="text-[12px] text-ink-soft">
                  {awaitingApproval.length
                    ? `${awaitingApproval.length} week${awaitingApproval.length > 1 ? "s" : ""} still waiting for approval this month — approve them first so paid days are right.`
                    : "All submitted weeks for this month are approved."}
                </p>
              )}
              {isHr && (
                <p className="text-[12px] text-ink-soft">
                  {pendingLeaveCount
                    ? `${pendingLeaveCount} person${pendingLeaveCount > 1 ? "s have" : " has"} leave for this month still awaiting a decision — settle it before you run pay.`
                    : `Unpaid leave this month: ${unpaidDaysTotal} day${unpaidDaysTotal === 1 ? "" : "s"}, already taken off the paycheck.`}
                </p>
              )}
            </div>
          </Panel>

          {canManagePay && (
            <>
              <SalaryImportPanel />
              <Panel title="Salary details">
                <div className="p-4 space-y-3">
                  <Select
                    label="Employee"
                    value={focusId}
                    onChange={(v) => {
                      setFocus(v);
                      const cur = latestStructure(v);
                      setSalaryForm({
                        annual_ctc: String(cur?.annual_ctc ?? ""),
                        monthly_basic: String(cur?.monthly_basic ?? ""),
                        monthly_hra: String(cur?.monthly_hra ?? ""),
                        monthly_allowances: String(cur?.monthly_allowances ?? ""),
                        monthly_deductions: String(cur?.monthly_deductions ?? ""),
                        tax_percent: String(cur?.tax_percent ?? 10),
                        currency: cur?.currency ?? "INR",
                      });
                    }}
                    options={scoped.map((e) => ({ value: e.id, label: e.full_name }))}
                  />
                  <Input
                    label="Annual package"
                    type="number"
                    value={salaryForm.annual_ctc}
                    onChange={(v) => setSalaryForm({ ...salaryForm, annual_ctc: v })}
                  />
                  <Input
                    label="Monthly basic"
                    type="number"
                    value={salaryForm.monthly_basic}
                    onChange={(v) => setSalaryForm({ ...salaryForm, monthly_basic: v })}
                  />
                  <Input
                    label="House rent allowance"
                    type="number"
                    value={salaryForm.monthly_hra}
                    onChange={(v) => setSalaryForm({ ...salaryForm, monthly_hra: v })}
                  />
                  <Input
                    label="Other allowances"
                    type="number"
                    value={salaryForm.monthly_allowances}
                    onChange={(v) => setSalaryForm({ ...salaryForm, monthly_allowances: v })}
                  />
                  <Input
                    label="Monthly deductions"
                    type="number"
                    value={salaryForm.monthly_deductions}
                    onChange={(v) => setSalaryForm({ ...salaryForm, monthly_deductions: v })}
                  />
                  <Input
                    label="Tax %"
                    type="number"
                    value={salaryForm.tax_percent}
                    onChange={(v) => setSalaryForm({ ...salaryForm, tax_percent: v })}
                  />
                  <button
                    onClick={() => saveSalary.mutate()}
                    className="w-full h-9 rounded-md bg-brand text-paper text-[12px] font-semibold cursor-pointer hover:bg-brand-deep"
                  >
                    Save salary
                  </button>
                </div>
              </Panel>

              <Panel title="Recent runs">
                <div className="divide-y divide-line">
                  {visibleRuns.slice(0, 8).map((r) => (
                    <div key={r.id} className="px-4 py-2.5 flex items-center gap-2">
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium">{monthLabel(r.period_month)}</p>
                        <p className="text-[11px] font-mono text-ink-soft truncate">
                          {companyById(r.company_id)?.name}
                        </p>
                      </div>
                      <div className="ml-auto flex items-center gap-2">
                        <StatusPill status={r.status === "paid" ? "approved" : "submitted"} />
                        {r.status !== "paid" && (
                          <button
                            onClick={() => markPaid.mutate(r.id)}
                            className="h-7 px-2.5 rounded-md ring-1 ring-line text-[11px] font-medium cursor-pointer hover:bg-ink/5"
                          >
                            Mark paid
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {!visibleRuns.length && (
                    <p className="px-4 py-6 text-center text-[12px] text-ink-soft">
                      No payroll runs yet.
                    </p>
                  )}
                </div>
              </Panel>
            </>
          )}
        </aside>
      </div>
    </>
  );
}

/** Bulk salary load — payroll team and Master HR only. */
function SalaryImportPanel() {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const spec = specByKey("salary_structures")!;
  const stamp = new Date().toISOString().slice(0, 10);

  const xlsx = async () => await import("xlsx");

  const save = (name: string, rows: Row[], XLSX: typeof import("xlsx")) => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{}]), "Salary structures");
    XLSX.writeFile(wb, name);
  };

  const template = async () => {
    setBusy("t");
    try {
      save(`salary-template-${stamp}.xlsx`, [templateRow(spec)], await xlsx());
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const exportCurrent = async () => {
    setBusy("e");
    try {
      const XLSX = await xlsx();
      const ctx = await loadCtx();
      const rows = await exportSpec(spec, ctx);
      save(`salary-${stamp}.xlsx`, rows, XLSX);
      toast.success(`${rows.length} salary rows exported`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const runImport = async (file: File) => {
    setBusy("i");
    try {
      const XLSX = await xlsx();
      const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
      const sheetName =
        wb.SheetNames.find((n) => n.toLowerCase().includes("salary")) ?? wb.SheetNames[0]!;
      const rows = XLSX.utils.sheet_to_json<Row>(wb.Sheets[sheetName]!, { defval: "", raw: false });
      const ctx = await loadCtx();
      const out = await importSpec(spec, rows, ctx);
      setResult(out);
      queryClient.invalidateQueries();
      if (out.inserted || out.updated) {
        toast.success(
          `${out.inserted} added, ${out.updated} updated${out.skipped.length ? `, ${out.skipped.length} skipped` : ""}`,
        );
      } else {
        toast.error("Nothing imported — check the skipped rows below");
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  return (
    <Panel title="Bulk salary load">
      <div className="p-4 space-y-3">
        <p className="text-[12.5px] text-ink-soft">
          Upload one sheet with everyone's pay. People are matched by work email, so an existing
          row for the same start date is updated instead of duplicated.
        </p>
        <p className="text-[11px] font-mono text-ink-soft break-words">
          {spec.fields.map((f) => f.header).join(" · ")}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={template}
            disabled={!!busy}
            className="h-8 px-3 rounded-md ring-1 ring-line text-[12px] font-medium cursor-pointer hover:bg-ink/5 inline-flex items-center gap-1.5 disabled:opacity-60"
          >
            <FileSpreadsheet className="size-3.5" /> Template
          </button>
          <button
            onClick={exportCurrent}
            disabled={!!busy}
            className="h-8 px-3 rounded-md ring-1 ring-line text-[12px] font-medium cursor-pointer hover:bg-ink/5 inline-flex items-center gap-1.5 disabled:opacity-60"
          >
            <Download className="size-3.5" /> {busy === "e" ? "Working…" : "Export"}
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={!!busy}
            className="h-8 px-3 rounded-md bg-brand text-paper text-[12px] font-semibold cursor-pointer hover:bg-brand-deep inline-flex items-center gap-1.5 disabled:opacity-60"
          >
            <Upload className="size-3.5" /> {busy === "i" ? "Loading…" : "Upload salaries"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void runImport(file);
            }}
          />
        </div>
        {result && (
          <div className="rounded-md ring-1 ring-line p-3 space-y-1">
            <p className="text-[12px] font-medium">
              {result.inserted} added · {result.updated} updated · {result.skipped.length} skipped
            </p>
            {result.skipped.slice(0, 5).map((s) => (
              <p key={s.row} className="text-[11px] font-mono text-ink-soft">
                Row {s.row}: {s.reason}
              </p>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}
