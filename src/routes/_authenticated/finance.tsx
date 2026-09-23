import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  AppShell,
  EntityTag,
  Panel,
  StatCard,
  StatusPill,
  useScope,
} from "@/components/AppShell";
import {
  money,
  monthLabel,
  useEmployees,
  useMe,
  usePayslips,
  useSalaryStructures,
} from "@/lib/hrms";

export const Route = createFileRoute("/_authenticated/finance")({
  head: () => ({
    meta: [
      { title: "Finance — AIONOS HR Control Tower" },
      {
        name: "description",
        content:
          "Track payslips waiting for sign-off, payments already released and every employee's salary and deductions.",
      },
      { property: "og:title", content: "Finance — AIONOS HR Control Tower" },
      {
        property: "og:description",
        content: "Pending payslips, released payments and salary detail in one place.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FinancePage,
});

function FinancePage() {
  return (
    <AppShell title="Finance" subtitle="Payments · sign-off · salary detail">
      <FinanceBody />
    </AppShell>
  );
}

type Tab = "pending" | "paid" | "salary";

function FinanceBody() {
  const { data: me } = useMe();
  const { companyId, companyById } = useScope();
  const { data: employees = [] } = useEmployees();
  const { data: payslips = [], refetch } = usePayslips();
  const { data: structures = [] } = useSalaryStructures();

  const isHr = !!me?.isMaster || !!me?.hrCompanyId || !!me?.isPayrollApprover;
  const [tab, setTab] = useState<Tab>("pending");
  const [search, setSearch] = useState("");
  const [forms, setForms] = useState<
    Record<string, { paid_on: string; paid_amount: string; payment_reference: string }>
  >({});

  const peopleById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);

  const scopedSlips = useMemo(() => {
    const term = search.trim().toLowerCase();
    return payslips.filter((p) => {
      const person = peopleById.get(p.employee_id);
      if (!person) return false;
      if (companyId && person.company_id !== companyId) return false;
      if (term && !person.full_name.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [payslips, peopleById, companyId, search]);

  const awaitingHr = scopedSlips.filter((p) => p.hr_status !== "approved");
  const awaitingFinance = scopedSlips.filter(
    (p) => p.hr_status === "approved" && p.finance_status !== "approved",
  );
  const signedOff = scopedSlips.filter((p) => p.finance_status === "approved");
  const released = signedOff.reduce((sum, p) => sum + Number(p.paid_amount || 0), 0);
  const currency = scopedSlips[0]?.currency ?? "INR";

  const approve = useMutation({
    mutationFn: async (slipId: string) => {
      const { error } = await supabase
        .from("payslips")
        .update({
          hr_status: "approved",
          hr_decided_at: new Date().toISOString(),
        })
        .eq("id", slipId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Payslip approved — ready for payment");
      void refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const signOff = useMutation({
    mutationFn: async (slipId: string) => {
      const form = forms[slipId];
      const paidOn = form?.paid_on || new Date().toISOString().slice(0, 10);
      const slip = scopedSlips.find((p) => p.id === slipId);
      const amount = Number(form?.paid_amount ?? slip?.net_pay ?? 0);
      if (amount <= 0) throw new Error("Add the amount paid");
      const { error } = await supabase
        .from("payslips")
        .update({
          finance_status: "approved",
          finance_decided_at: new Date().toISOString(),
          paid_on: paidOn,
          paid_amount: amount,
          payment_reference: form?.payment_reference ?? "",
          status: "paid",
        })
        .eq("id", slipId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Payment recorded");
      void refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!isHr) {
    return (
      <Panel title="Finance">
        <p className="px-4 py-8 text-center text-ink-soft text-[13px]">
          Your payslips and salary details are on the Payroll page.
        </p>
      </Panel>
    );
  }

  const latestStructure = (employeeId: string) =>
    structures
      .filter((s) => s.employee_id === employeeId)
      .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Waiting on HR"
          value={awaitingHr.length}
          hint="Not approved yet"
          hintTone="warn"
          onClick={() => setTab("pending")}
          active={tab === "pending"}
        />
        <StatCard
          label="Ready to pay"
          value={awaitingFinance.length}
          hint="Approved by HR"
          onClick={() => setTab("pending")}
          active={tab === "pending"}
        />
        <StatCard
          label="Signed off"
          value={signedOff.length}
          hint="Payments released"
          hintTone="good"
          onClick={() => setTab("paid")}
          active={tab === "paid"}
        />
        <StatCard
          label="Total released"
          value={money(released, currency)}
          hint="Across shown payslips"
          onClick={() => setTab("paid")}
          active={tab === "paid"}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["pending", "Pending payslips"],
            ["paid", "Signed-off payments"],
            ["salary", "Salary & deductions"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`h-8 px-3 rounded-lg text-[12.5px] font-medium cursor-pointer ring-1 ${
              tab === key
                ? "bg-brand text-paper ring-brand"
                : "bg-paper ring-line hover:bg-ink/5"
            }`}
          >
            {label}
          </button>
        ))}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search employee"
          className="ml-auto h-8 w-full sm:w-56 px-3 rounded-lg bg-paper ring-1 ring-line text-[12.5px] outline-none focus:ring-brand"
        />
      </div>

      {tab === "pending" && (
        <Panel
          title="Pending payslips"
          meta={<span className="label-mono">{awaitingHr.length + awaitingFinance.length} open</span>}
        >
          <div className="divide-y divide-line">
            {[...awaitingFinance, ...awaitingHr].map((p) => {
              const person = peopleById.get(p.employee_id);
              const readyToPay = p.hr_status === "approved";
              const form = forms[p.id] ?? {
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
                        {monthLabel(p.period_month)} · net {money(Number(p.net_pay), p.currency)}
                      </p>
                    </div>
                    {person && <EntityTag company={companyById(person.company_id)} />}
                    <StatusPill status={readyToPay ? "submitted" : "pending"} />
                  </div>
                  {readyToPay ? (
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="text-[11px] font-mono text-ink-soft">
                        Payment date
                        <input
                          type="date"
                          value={form.paid_on}
                          onChange={(e) =>
                            setForms({ ...forms, [p.id]: { ...form, paid_on: e.target.value } })
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
                            setForms({ ...forms, [p.id]: { ...form, paid_amount: e.target.value } })
                          }
                          className="block h-8 w-28 px-2 rounded-md bg-paper ring-1 ring-line text-[12px] outline-none focus:ring-brand"
                        />
                      </label>
                      <label className="text-[11px] font-mono text-ink-soft">
                        Reference
                        <input
                          value={form.payment_reference}
                          onChange={(e) =>
                            setForms({
                              ...forms,
                              [p.id]: { ...form, payment_reference: e.target.value },
                            })
                          }
                          placeholder="UTR / transfer id"
                          className="block h-8 w-40 px-2 rounded-md bg-paper ring-1 ring-line text-[12px] outline-none focus:ring-brand"
                        />
                      </label>
                      <button
                        onClick={() => signOff.mutate(p.id)}
                        className="h-8 px-3 rounded-md bg-brand text-paper text-[12px] font-semibold cursor-pointer hover:bg-brand-deep"
                      >
                        Sign off payment
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[12px] text-ink-soft flex-1 min-w-[8rem]">
                        Needs approval before payment.
                      </p>
                      <button
                        onClick={() => approve.mutate(p.id)}
                        className="h-9 px-3 rounded-md bg-brand text-paper text-[12px] font-semibold cursor-pointer hover:bg-brand-deep"
                      >
                        Approve payslip
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {!awaitingHr.length && !awaitingFinance.length && (
              <p className="px-4 py-8 text-center text-ink-soft text-[13px]">
                Nothing pending — every payslip here is settled.
              </p>
            )}
          </div>
        </Panel>
      )}

      {tab === "paid" && (
        <Panel
          title="Signed-off payments"
          meta={<span className="label-mono">{signedOff.length} paid</span>}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left label-mono border-b border-line">
                  <th className="px-4 py-2.5 font-medium">Employee</th>
                  <th className="px-4 py-2.5 font-medium hidden md:table-cell">Entity</th>
                  <th className="px-4 py-2.5 font-medium">Month</th>
                  <th className="px-4 py-2.5 font-medium">Paid</th>
                  <th className="px-4 py-2.5 font-medium hidden sm:table-cell">Date</th>
                  <th className="px-4 py-2.5 font-medium hidden lg:table-cell">Reference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {signedOff.map((p) => {
                  const person = peopleById.get(p.employee_id);
                  return (
                    <tr key={p.id} className="hover:bg-ink/[0.03]">
                      <td className="px-4 py-3 font-medium">{person?.full_name ?? "—"}</td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        {person && <EntityTag company={companyById(person.company_id)} />}
                      </td>
                      <td className="px-4 py-3 font-mono text-[12px] text-ink-soft">
                        {monthLabel(p.period_month)}
                      </td>
                      <td className="px-4 py-3 font-mono text-[12px] font-semibold">
                        {money(Number(p.paid_amount), p.currency)}
                      </td>
                      <td className="px-4 py-3 font-mono text-[12px] text-ink-soft hidden sm:table-cell">
                        {p.paid_on ?? "—"}
                      </td>
                      <td className="px-4 py-3 font-mono text-[12px] text-ink-soft hidden lg:table-cell">
                        {p.payment_reference || "—"}
                      </td>
                    </tr>
                  );
                })}
                {!signedOff.length && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-ink-soft">
                      No payments signed off yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {tab === "salary" && (
        <Panel
          title="Salary & deductions"
          meta={<span className="label-mono">per employee</span>}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left label-mono border-b border-line">
                  <th className="px-4 py-2.5 font-medium">Employee</th>
                  <th className="px-4 py-2.5 font-medium hidden md:table-cell">Entity</th>
                  <th className="px-4 py-2.5 font-medium">Annual pay</th>
                  <th className="px-4 py-2.5 font-medium hidden sm:table-cell">Monthly basic</th>
                  <th className="px-4 py-2.5 font-medium hidden lg:table-cell">Allowances</th>
                  <th className="px-4 py-2.5 font-medium">Deductions</th>
                  <th className="px-4 py-2.5 font-medium hidden sm:table-cell">Tax %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {employees
                  .filter((e) => (companyId ? e.company_id === companyId : true))
                  .filter((e) =>
                    search.trim()
                      ? e.full_name.toLowerCase().includes(search.trim().toLowerCase())
                      : true,
                  )
                  .filter((e) => e.status !== "offboarded")
                  .slice(0, 100)
                  .map((e) => {
                    const s = latestStructure(e.id);
                    return (
                      <tr key={e.id} className="hover:bg-ink/[0.03]">
                        <td className="px-4 py-3 font-medium">{e.full_name}</td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          <EntityTag company={companyById(e.company_id)} />
                        </td>
                        <td className="px-4 py-3 font-mono text-[12px]">
                          {s ? money(Number(s.annual_ctc), s.currency) : "Not set"}
                        </td>
                        <td className="px-4 py-3 font-mono text-[12px] text-ink-soft hidden sm:table-cell">
                          {s ? money(Number(s.monthly_basic), s.currency) : "—"}
                        </td>
                        <td className="px-4 py-3 font-mono text-[12px] text-ink-soft hidden lg:table-cell">
                          {s
                            ? money(
                                Number(s.monthly_hra) + Number(s.monthly_allowances),
                                s.currency,
                              )
                            : "—"}
                        </td>
                        <td className="px-4 py-3 font-mono text-[12px] text-ink-soft">
                          {s ? money(Number(s.monthly_deductions), s.currency) : "—"}
                        </td>
                        <td className="px-4 py-3 font-mono text-[12px] text-ink-soft hidden sm:table-cell">
                          {s ? `${Number(s.tax_percent)}%` : "—"}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}
