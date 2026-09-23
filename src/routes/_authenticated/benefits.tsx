import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, FilterNote, Panel, StatCard, StatusPill, useScope } from "@/components/AppShell";
import { Input, Select } from "@/routes/_authenticated/employees";
import {
  money,
  useBenefitEnrollments,
  useBenefitPlans,
  useEmployees,
  useMe,
} from "@/lib/hrms";

export const Route = createFileRoute("/_authenticated/benefits")({
  head: () => ({
    meta: [
      { title: "Benefits — AIONOS HR Control Tower" },
      {
        name: "description",
        content:
          "Health cover, insurance and wellbeing plans: browse what you get, enrol dependents and track approvals.",
      },
      { property: "og:title", content: "Benefits — AIONOS HR Control Tower" },
      { property: "og:description", content: "Plans, enrolments and costs." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BenefitsPage,
});

function BenefitsPage() {
  return (
    <AppShell title="Benefits" subtitle="Plans · enrolments · cover">
      <BenefitsBody />
    </AppShell>
  );
}

function BenefitsBody() {
  const { data: me } = useMe();
  const { companyId } = useScope();
  const { data: employees = [] } = useEmployees();
  const { data: plans = [] } = useBenefitPlans();
  const { data: enrollments = [] } = useBenefitEnrollments();
  const queryClient = useQueryClient();

  const isHr = !!me?.isMaster || !!me?.hrCompanyId;
  const isMaster = !!me?.isMaster;
  const myId = me?.employee?.id;

  const scoped = useMemo(
    () => (companyId ? employees.filter((e) => e.company_id === companyId) : employees),
    [employees, companyId],
  );
  const scopedIds = new Set(scoped.map((e) => e.id));

  const visiblePlans = plans.filter(
    (p) => !p.company_id || !companyId || p.company_id === companyId,
  );
  const visibleEnrollments = isHr
    ? enrollments.filter((e) => scopedIds.has(e.employee_id))
    : enrollments.filter((e) => e.employee_id === myId);
  const myEnrollments = enrollments.filter((e) => e.employee_id === myId);

  const [planForm, setPlanForm] = useState({
    name: "",
    category: "Health",
    provider: "",
    coverage: "",
    employee_cost: "0",
    employer_cost: "0",
    scope: "group",
  });
  const [tile, setTile] = useState<string | null>(null);
  const [enrolForm, setEnrolForm] = useState({ plan_id: "", employee_id: "", dependents: "0" });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["benefit_plans"] });
    queryClient.invalidateQueries({ queryKey: ["benefit_enrollments"] });
  };

  const addPlan = useMutation({
    mutationFn: async () => {
      if (!planForm.name.trim()) throw new Error("Name the plan");
      const { error } = await supabase.from("benefit_plans").insert({
        company_id: planForm.scope === "group" ? null : (companyId ?? me?.hrCompanyId ?? null),
        name: planForm.name.trim(),
        category: planForm.category,
        provider: planForm.provider,
        coverage: planForm.coverage,
        employee_cost: Number(planForm.employee_cost) || 0,
        employer_cost: Number(planForm.employer_cost) || 0,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Plan added");
      setPlanForm({ ...planForm, name: "", coverage: "" });
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removePlan = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("benefit_plans").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => refresh(),
    onError: (e: Error) => toast.error(e.message),
  });

  const enrol = useMutation({
    mutationFn: async (planId: string) => {
      const employeeId = isHr ? enrolForm.employee_id || scoped[0]?.id : myId;
      if (!employeeId) throw new Error("No employee record found");
      const { error } = await supabase.from("benefit_enrollments").upsert(
        {
          plan_id: planId,
          employee_id: employeeId,
          dependents: Number(enrolForm.dependents) || 0,
          status: isHr ? "active" : "pending",
        },
        { onConflict: "plan_id,employee_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(isHr ? "Enrolment saved" : "Request sent to HR");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "active" | "ended" }) => {
      const { error } = await supabase
        .from("benefit_enrollments")
        .update({
          status,
          ended_on: status === "ended" ? new Date().toISOString().slice(0, 10) : null,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => refresh(),
    onError: (e: Error) => toast.error(e.message),
  });

  const activeCount = visibleEnrollments.filter((e) => e.status === "active").length;
  const monthlyCost = visibleEnrollments
    .filter((e) => e.status === "active")
    .reduce((sum, e) => {
      const plan = plans.find((p) => p.id === e.plan_id);
      return sum + Number(plan?.employer_cost ?? 0);
    }, 0);

  const shownEnrollments = tile
    ? visibleEnrollments.filter((e) => e.status === tile)
    : visibleEnrollments;
  const toggle = (k: string) => setTile((prev) => (prev === k ? null : k));

  return (
    <>
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Plans"
          value={visiblePlans.length}
          hint="available"
          onClick={() => setTile(null)}
          active={tile === null}
        />
        <StatCard
          label={isHr ? "Active enrolments" : "My plans"}
          value={activeCount}
          hintTone="good"
          onClick={() => toggle("active")}
          active={tile === "active"}
        />
        <StatCard
          label="Awaiting approval"
          value={visibleEnrollments.filter((e) => e.status === "pending").length}
          hintTone="warn"
          onClick={() => toggle("pending")}
          active={tile === "pending"}
        />
        <StatCard label={isHr ? "Company cost / month" : "My cost / month"} value={money(isHr ? monthlyCost : myEnrollments.filter((e) => e.status === "active").reduce((s, e) => s + Number(plans.find((p) => p.id === e.plan_id)?.employee_cost ?? 0), 0))} />
      </section>
      {tile && (
        <FilterNote label={tile} count={shownEnrollments.length} onClear={() => setTile(null)} />
      )}

      <div className="mt-4 grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 space-y-4">
          <Panel title="Plans">
            <div className="divide-y divide-line">
              {visiblePlans.map((p) => {
                const mine = myEnrollments.find((e) => e.plan_id === p.id);
                return (
                  <div key={p.id} className="px-4 py-3 flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium">{p.name}</p>
                      <p className="text-[11px] font-mono text-ink-soft">
                        {p.category}
                        {p.provider ? ` · ${p.provider}` : ""}
                        {p.coverage ? ` · ${p.coverage}` : ""}
                      </p>
                      <p className="text-[11px] font-mono text-ink-soft mt-0.5">
                        You pay {money(Number(p.employee_cost), p.currency)} / month
                      </p>
                    </div>
                    {mine ? (
                      <StatusPill status={mine.status === "active" ? "active" : mine.status} />
                    ) : (
                      <button
                        onClick={() => enrol.mutate(p.id)}
                        className="h-7 px-2.5 rounded-md ring-1 ring-line text-[11px] font-medium cursor-pointer hover:bg-ink/5"
                      >
                        {isHr ? "Enrol selected" : "Request"}
                      </button>
                    )}
                    {isHr && (isMaster || p.company_id) && (
                      <button
                        onClick={() => removePlan.mutate(p.id)}
                        className="h-7 px-2.5 rounded-md ring-1 ring-line text-[11px] font-medium text-destructive cursor-pointer hover:bg-ink/5"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                );
              })}
              {!visiblePlans.length && (
                <p className="px-4 py-8 text-center text-[13px] text-ink-soft">No plans yet.</p>
              )}
            </div>
          </Panel>

          <Panel
            title={isHr ? "Enrolments" : "My enrolments"}
            meta={<span className="label-mono">{shownEnrollments.length} records</span>}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left label-mono border-b border-line">
                    {isHr && <th className="px-4 py-2.5 font-medium">Employee</th>}
                    <th className="px-4 py-2.5 font-medium">Plan</th>
                    <th className="px-4 py-2.5 font-medium">Dependents</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    {isHr && <th className="px-4 py-2.5 font-medium text-right">Action</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {shownEnrollments.map((en) => (
                    <tr key={en.id} className="hover:bg-ink/[0.03]">
                      {isHr && (
                        <td className="px-4 py-3 font-medium">
                          {employees.find((e) => e.id === en.employee_id)?.full_name ?? "—"}
                        </td>
                      )}
                      <td className="px-4 py-3">
                        {plans.find((p) => p.id === en.plan_id)?.name ?? "—"}
                      </td>
                      <td className="px-4 py-3 font-mono text-[12px] text-ink-soft">
                        {en.dependents}
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill status={en.status === "active" ? "active" : en.status} />
                      </td>
                      {isHr && (
                        <td className="px-4 py-3 text-right space-x-2">
                          {en.status !== "active" && (
                            <button
                              onClick={() => setStatus.mutate({ id: en.id, status: "active" })}
                              className="h-7 px-2.5 rounded-md bg-brand text-paper text-[11px] font-medium cursor-pointer hover:bg-brand-deep"
                            >
                              Approve
                            </button>
                          )}
                          {en.status !== "ended" && (
                            <button
                              onClick={() => setStatus.mutate({ id: en.id, status: "ended" })}
                              className="h-7 px-2.5 rounded-md ring-1 ring-line text-[11px] font-medium cursor-pointer hover:bg-ink/5"
                            >
                              End
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                  {!shownEnrollments.length && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-ink-soft">
                        No enrolments yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>

        <aside className="space-y-4">
          {isHr && (
            <>
              <Panel title="Add a plan">
                <div className="p-4 space-y-3">
                  <Input
                    label="Plan name"
                    value={planForm.name}
                    onChange={(v) => setPlanForm({ ...planForm, name: v })}
                  />
                  <Select
                    label="Category"
                    value={planForm.category}
                    onChange={(v) => setPlanForm({ ...planForm, category: v })}
                    options={["Health", "Life", "Accident", "Wellbeing", "Retirement", "Other"].map(
                      (s) => ({ value: s, label: s }),
                    )}
                  />
                  <Input
                    label="Provider"
                    value={planForm.provider}
                    onChange={(v) => setPlanForm({ ...planForm, provider: v })}
                  />
                  <Input
                    label="Cover"
                    value={planForm.coverage}
                    onChange={(v) => setPlanForm({ ...planForm, coverage: v })}
                  />
                  <Input
                    label="Employee pays / month"
                    type="number"
                    value={planForm.employee_cost}
                    onChange={(v) => setPlanForm({ ...planForm, employee_cost: v })}
                  />
                  <Input
                    label="Company pays / month"
                    type="number"
                    value={planForm.employer_cost}
                    onChange={(v) => setPlanForm({ ...planForm, employer_cost: v })}
                  />
                  {isMaster && (
                    <Select
                      label="Available to"
                      value={planForm.scope}
                      onChange={(v) => setPlanForm({ ...planForm, scope: v })}
                      options={[
                        { value: "group", label: "All companies" },
                        { value: "company", label: "Selected company only" },
                      ]}
                    />
                  )}
                  <button
                    onClick={() => addPlan.mutate()}
                    className="w-full h-9 rounded-md bg-brand text-paper text-[12px] font-semibold cursor-pointer hover:bg-brand-deep"
                  >
                    Add plan
                  </button>
                </div>
              </Panel>

              <Panel title="Enrol someone">
                <div className="p-4 space-y-3">
                  <Select
                    label="Employee"
                    value={enrolForm.employee_id || (scoped[0]?.id ?? "")}
                    onChange={(v) => setEnrolForm({ ...enrolForm, employee_id: v })}
                    options={scoped.map((e) => ({ value: e.id, label: e.full_name }))}
                  />
                  <Select
                    label="Plan"
                    value={enrolForm.plan_id || (visiblePlans[0]?.id ?? "")}
                    onChange={(v) => setEnrolForm({ ...enrolForm, plan_id: v })}
                    options={visiblePlans.map((p) => ({ value: p.id, label: p.name }))}
                  />
                  <Input
                    label="Dependents"
                    type="number"
                    value={enrolForm.dependents}
                    onChange={(v) => setEnrolForm({ ...enrolForm, dependents: v })}
                  />
                  <button
                    onClick={() => enrol.mutate(enrolForm.plan_id || (visiblePlans[0]?.id ?? ""))}
                    className="w-full h-9 rounded-md bg-brand text-paper text-[12px] font-semibold cursor-pointer hover:bg-brand-deep"
                  >
                    Enrol
                  </button>
                </div>
              </Panel>
            </>
          )}
          {!isHr && (
            <Panel title="Dependents">
              <div className="p-4 space-y-3">
                <Input
                  label="People covered with you"
                  type="number"
                  value={enrolForm.dependents}
                  onChange={(v) => setEnrolForm({ ...enrolForm, dependents: v })}
                />
                <p className="text-[11px] font-mono text-ink-soft">
                  Set this before requesting a plan.
                </p>
              </div>
            </Panel>
          )}
        </aside>
      </div>
    </>
  );
}
