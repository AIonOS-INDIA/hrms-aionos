import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, EntityTag, Panel, StatCard, useScope } from "@/components/AppShell";
import { Input, Select } from "@/routes/_authenticated/employees";
import {
  computePay,
  firstOfMonth,
  fmtDate,
  money,
  useEmployees,
  useMe,
  useSalaryStructures,
  type SalaryStructure,
} from "@/lib/hrms";

export const Route = createFileRoute("/_authenticated/salary")({
  head: () => ({
    meta: [
      { title: "Salary setup — AIONOS HR Control Tower" },
      {
        name: "description",
        content:
          "Set each employee's salary, allowances and deductions so monthly payslips can be generated.",
      },
      { property: "og:title", content: "Salary setup — AIONOS HR Control Tower" },
      {
        property: "og:description",
        content: "Per-employee pay components feeding monthly payslips.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SalaryPage,
});

function SalaryPage() {
  return (
    <AppShell title="Salary setup" subtitle="Pay components · allowances · deductions">
      <SalaryBody />
    </AppShell>
  );
}

const emptyForm = {
  effective_from: firstOfMonth(),
  currency: "INR",
  annual_ctc: "",
  monthly_basic: "",
  monthly_hra: "",
  monthly_allowances: "",
  monthly_deductions: "",
  tax_percent: "10",
};

function SalaryBody() {
  const { data: me } = useMe();
  const { companyId, companyById, canSeeAll } = useScope();
  const { data: employees = [] } = useEmployees();
  const { data: structures = [] } = useSalaryStructures();
  const queryClient = useQueryClient();

  const isHr = !!me?.isMaster || !!me?.hrCompanyId;
  const myId = me?.employee?.id;

  const scoped = useMemo(
    () =>
      (companyId ? employees.filter((e) => e.company_id === companyId) : employees).filter(
        (e) => e.status !== "offboarded",
      ),
    [employees, companyId],
  );

  const latest = (employeeId: string) => structures.find((s) => s.employee_id === employeeId);

  const [search, setSearch] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [focus, setFocus] = useState("");
  const [form, setForm] = useState(emptyForm);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scoped
      .filter((e) => (onlyMissing ? !latest(e.id) : true))
      .filter(
        (e) =>
          !q ||
          e.full_name.toLowerCase().includes(q) ||
          e.email.toLowerCase().includes(q) ||
          e.job_title.toLowerCase().includes(q),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped, search, onlyMissing, structures]);

  const focusId = focus || rows[0]?.id || scoped[0]?.id || "";
  const focusEmployee = employees.find((e) => e.id === focusId);
  const focusStructure = latest(focusId);

  const pick = (id: string) => {
    setFocus(id);
    const cur = latest(id);
    setForm(
      cur
        ? {
            effective_from: cur.effective_from,
            currency: cur.currency,
            annual_ctc: String(cur.annual_ctc ?? ""),
            monthly_basic: String(cur.monthly_basic ?? ""),
            monthly_hra: String(cur.monthly_hra ?? ""),
            monthly_allowances: String(cur.monthly_allowances ?? ""),
            monthly_deductions: String(cur.monthly_deductions ?? ""),
            tax_percent: String(cur.tax_percent ?? 10),
          }
        : emptyForm,
    );
  };

  const num = (v: string) => Number(v) || 0;
  const draft: SalaryStructure = {
    id: "draft",
    employee_id: focusId,
    effective_from: form.effective_from,
    currency: form.currency,
    annual_ctc: num(form.annual_ctc),
    monthly_basic: num(form.monthly_basic),
    monthly_hra: num(form.monthly_hra),
    monthly_allowances: num(form.monthly_allowances),
    monthly_deductions: num(form.monthly_deductions),
    tax_percent: num(form.tax_percent),
  };
  const preview = computePay(draft);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["salary_structures"] });

  const save = useMutation({
    mutationFn: async () => {
      if (!focusId) throw new Error("Pick an employee first");
      if (draft.monthly_basic <= 0) throw new Error("Monthly basic must be more than zero");
      const payload = {
        employee_id: focusId,
        effective_from: form.effective_from,
        currency: form.currency,
        annual_ctc: draft.annual_ctc,
        monthly_basic: draft.monthly_basic,
        monthly_hra: draft.monthly_hra,
        monthly_allowances: draft.monthly_allowances,
        monthly_deductions: draft.monthly_deductions,
        tax_percent: draft.tax_percent,
      };
      const { error } = focusStructure
        ? await supabase.from("salary_structures").update(payload).eq("id", focusStructure.id)
        : await supabase.from("salary_structures").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Salary saved");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const fillFromCtc = () => {
    const ctc = num(form.annual_ctc);
    if (!ctc) {
      toast.error("Enter the annual package first");
      return;
    }
    const monthly = ctc / 12;
    setForm({
      ...form,
      monthly_basic: String(Math.round(monthly * 0.5)),
      monthly_hra: String(Math.round(monthly * 0.2)),
      monthly_allowances: String(Math.round(monthly * 0.3)),
      monthly_deductions: form.monthly_deductions || String(Math.round(monthly * 0.06)),
    });
  };

  const configured = scoped.filter((e) => latest(e.id)).length;
  const monthlyCost = scoped.reduce((sum, e) => {
    const s = latest(e.id);
    return sum + (s ? computePay(s).gross : 0);
  }, 0);

  const mySalary = myId ? latest(myId) : undefined;

  if (!isHr) {
    const pay = mySalary ? computePay(mySalary) : null;
    return (
      <Panel title="My salary">
        <div className="p-4 space-y-2 text-[13px]">
          {mySalary && pay ? (
            <>
              <Row label="Effective from" value={fmtDate(mySalary.effective_from)} />
              <Row label="Monthly basic" value={money(mySalary.monthly_basic, mySalary.currency)} />
              <Row
                label="House rent allowance"
                value={money(mySalary.monthly_hra, mySalary.currency)}
              />
              <Row
                label="Other allowances"
                value={money(mySalary.monthly_allowances, mySalary.currency)}
              />
              <Row label="Deductions" value={money(pay.deductions, mySalary.currency)} />
              <Row label="Tax" value={money(pay.tax, mySalary.currency)} />
              <Row label="Monthly net" value={money(pay.net, mySalary.currency)} />
            </>
          ) : (
            <p className="text-ink-soft">Your salary details are not set up yet.</p>
          )}
        </div>
      </Panel>
    );
  }

  return (
    <>
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="People in scope"
          value={scoped.length}
          hint="active employees"
          onClick={() => setOnlyMissing(false)}
          active={!onlyMissing}
        />
        <StatCard
          label="Salary set"
          value={configured}
          hintTone="good"
          hint="ready for payroll"
          onClick={() => setOnlyMissing(false)}
          active={false}
        />
        <StatCard
          label="Salary missing"
          value={scoped.length - configured}
          hintTone="warn"
          hint="click to review"
          onClick={() => setOnlyMissing(true)}
          active={onlyMissing}
        />
        <StatCard label="Monthly gross" value={money(monthlyCost)} hint="current structures" />
      </section>

      <div className="mt-4 grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 space-y-4">
          <Panel
            title={`Salary structures · ${rows.length}`}
            meta={
              <button
                onClick={() => setOnlyMissing(!onlyMissing)}
                className={`h-7 px-2.5 rounded-md ring-1 ring-line text-[11px] font-medium cursor-pointer hover:bg-ink/5 ${
                  onlyMissing ? "bg-brand text-paper" : ""
                }`}
              >
                {onlyMissing ? "Showing not set" : "Show not set"}
              </button>
            }
          >
            <div className="p-4 border-b border-line">
              <Input label="Search people" value={search} onChange={setSearch} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left label-mono border-b border-line">
                    <th className="px-4 py-2.5 font-medium">Employee</th>
                    {canSeeAll && <th className="px-4 py-2.5 font-medium">Entity</th>}
                    <th className="px-4 py-2.5 font-medium">Basic</th>
                    <th className="px-4 py-2.5 font-medium">Allowances</th>
                    <th className="px-4 py-2.5 font-medium">Deductions</th>
                    <th className="px-4 py-2.5 font-medium">Net (est.)</th>
                    <th className="px-4 py-2.5 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((e) => {
                    const s = latest(e.id);
                    const pay = s ? computePay(s) : null;
                    return (
                      <tr
                        key={e.id}
                        className={`hover:bg-ink/[0.03] ${focusId === e.id ? "bg-ink/[0.04]" : ""}`}
                      >
                        <td className="px-4 py-3">
                          <p className="font-medium">{e.full_name}</p>
                          <p className="text-[11px] font-mono text-ink-soft">{e.job_title}</p>
                        </td>
                        {canSeeAll && (
                          <td className="px-4 py-3">
                            <EntityTag company={companyById(e.company_id)} />
                          </td>
                        )}
                        <td className="px-4 py-3 font-mono text-[12px]">
                          {s ? money(s.monthly_basic, s.currency) : "—"}
                        </td>
                        <td className="px-4 py-3 font-mono text-[12px] text-ink-soft">
                          {s
                            ? money(Number(s.monthly_hra) + Number(s.monthly_allowances), s.currency)
                            : "—"}
                        </td>
                        <td className="px-4 py-3 font-mono text-[12px] text-ink-soft">
                          {pay && s ? money(pay.deductions + pay.tax, s.currency) : "—"}
                        </td>
                        <td className="px-4 py-3 font-mono text-[12px] font-semibold">
                          {pay && s ? money(pay.net, s.currency) : "not set"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => pick(e.id)}
                            className="h-7 px-2.5 rounded-md ring-1 ring-line text-[11px] font-medium cursor-pointer hover:bg-ink/5"
                          >
                            {s ? "Edit" : "Set up"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {!rows.length && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-ink-soft">
                        No people match this view.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>

        <aside className="space-y-4">
          <Panel
            title={focusEmployee ? focusEmployee.full_name : "Salary details"}
            meta={
              <span className="label-mono">{focusStructure ? "editing" : "new structure"}</span>
            }
          >
            <div className="p-4 space-y-3">
              <Select
                label="Employee"
                value={focusId}
                onChange={pick}
                options={scoped.map((e) => ({ value: e.id, label: e.full_name }))}
              />
              <Input
                label="Effective from"
                type="date"
                value={form.effective_from}
                onChange={(v) => setForm({ ...form, effective_from: v })}
              />
              <Select
                label="Currency"
                value={form.currency}
                onChange={(v) => setForm({ ...form, currency: v })}
                options={[
                  { value: "INR", label: "INR" },
                  { value: "USD", label: "USD" },
                  { value: "SGD", label: "SGD" },
                  { value: "GBP", label: "GBP" },
                ]}
              />
              <Input
                label="Annual package"
                type="number"
                value={form.annual_ctc}
                onChange={(v) => setForm({ ...form, annual_ctc: v })}
              />
              <button
                onClick={fillFromCtc}
                className="w-full h-8 rounded-md ring-1 ring-line text-[11px] font-medium cursor-pointer hover:bg-ink/5"
              >
                Split package into components
              </button>
              <Input
                label="Monthly basic"
                type="number"
                value={form.monthly_basic}
                onChange={(v) => setForm({ ...form, monthly_basic: v })}
              />
              <Input
                label="House rent allowance"
                type="number"
                value={form.monthly_hra}
                onChange={(v) => setForm({ ...form, monthly_hra: v })}
              />
              <Input
                label="Other allowances"
                type="number"
                value={form.monthly_allowances}
                onChange={(v) => setForm({ ...form, monthly_allowances: v })}
              />
              <Input
                label="Monthly deductions"
                type="number"
                value={form.monthly_deductions}
                onChange={(v) => setForm({ ...form, monthly_deductions: v })}
              />
              <Input
                label="Tax %"
                type="number"
                value={form.tax_percent}
                onChange={(v) => setForm({ ...form, tax_percent: v })}
              />
              <button
                onClick={() => save.mutate()}
                disabled={save.isPending}
                className="w-full h-9 rounded-md bg-brand text-paper text-[12px] font-semibold cursor-pointer hover:bg-brand-deep disabled:opacity-60"
              >
                {save.isPending ? "Saving…" : "Save salary"}
              </button>
            </div>
          </Panel>

          <Panel title="Monthly preview">
            <div className="p-4 space-y-2 text-[13px]">
              <Row label="Gross" value={money(preview.gross, form.currency)} />
              <Row label="Deductions" value={money(preview.deductions, form.currency)} />
              <Row label="Tax" value={money(preview.tax, form.currency)} />
              <Row label="Net pay" value={money(preview.net, form.currency)} />
              <p className="text-[11px] font-mono text-ink-soft pt-1">
                This is what the monthly payslip will show.
              </p>
            </div>
          </Panel>
        </aside>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-ink-soft">{label}</span>
      <span className="font-mono text-[12px] font-medium">{value}</span>
    </div>
  );
}
