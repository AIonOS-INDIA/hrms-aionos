import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, FilterNote, EntityTag, Panel, StatCard, useScope } from "@/components/AppShell";
import { Input, Select } from "@/routes/_authenticated/employees";
import {
  fmtDate,
  useChecklistTemplateItems,
  useChecklistTemplates,
  useEmployeeChecklistItems,
  useEmployeeChecklists,
  useEmployees,
  useMe,
  type ChecklistKind,
} from "@/lib/hrms";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({
    meta: [
      { title: "Joining — AIONOS HR Control Tower" },
      {
        name: "description",
        content:
          "Run joining checklists: paperwork, equipment and access setup for every new employee.",
      },
      { property: "og:title", content: "Joining — AIONOS HR Control Tower" },
      { property: "og:description", content: "Joining checklists and paperwork." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OnboardingPage,
});

function OnboardingPage() {
  return (
    <AppShell title="Joining" subtitle="Checklists · paperwork · access setup">
      <OnboardingBody />
    </AppShell>
  );
}

const today = () => new Date().toISOString().slice(0, 10);

type Step = { title: string; description: string; owner: string };

const OWNER_ORDER = ["New joiner", "HR", "IT", "Finance", "Manager"];

const DEFAULT_STEPS: Record<ChecklistKind, Step[]> = {
  onboarding: [
    {
      title: "Accept and return the signed offer letter",
      description: "Sign every page and send the scanned copy back to HR.",
      owner: "New joiner",
    },
    {
      title: "Share identity and address proof",
      description: "Government photo ID plus one current address proof.",
      owner: "New joiner",
    },
    {
      title: "Share education and previous employment papers",
      description: "Highest degree certificate, last relieving letter and last payslip.",
      owner: "New joiner",
    },
    {
      title: "Submit bank and tax details",
      description: "Bank account for salary credit, tax number and nominee details.",
      owner: "New joiner",
    },
    {
      title: "Complete the joining form and emergency contact",
      description: "Personal details, address and who to call in an emergency.",
      owner: "New joiner",
    },
    {
      title: "Background and reference check cleared",
      description: "Identity, education and last employer verified.",
      owner: "HR",
    },
    {
      title: "Employment agreement and confidentiality signed",
      description: "Contract, confidentiality and code of conduct countersigned.",
      owner: "HR",
    },
    {
      title: "Employee record and ID number created",
      description: "Profile, entity, department and reporting manager set up.",
      owner: "HR",
    },
    {
      title: "Work email and system access created",
      description: "Email, HR portal, chat and directory accounts opened.",
      owner: "IT",
    },
    {
      title: "Laptop and equipment issued",
      description: "Machine handed over, asset tag recorded and encryption on.",
      owner: "IT",
    },
    {
      title: "Security and access card activated",
      description: "Office entry card and VPN access enabled for the work location.",
      owner: "IT",
    },
    {
      title: "Salary structure and payroll setup done",
      description: "Salary, allowances and deductions loaded for the first pay run.",
      owner: "Finance",
    },
    {
      title: "Benefits enrolment completed",
      description: "Health cover and other plans selected with dependants added.",
      owner: "New joiner",
    },
    {
      title: "Policy handbook read and acknowledged",
      description: "Leave, working hours, travel and conduct policies confirmed.",
      owner: "New joiner",
    },
    {
      title: "Mandatory training assigned and started",
      description: "Security awareness and workplace conduct courses.",
      owner: "New joiner",
    },
    {
      title: "Manager and team introduction done",
      description: "Welcome call, team walkthrough and buddy assigned.",
      owner: "Manager",
    },
    {
      title: "First 30-day goals agreed",
      description: "Role expectations and early milestones written down together.",
      owner: "Manager",
    },
    {
      title: "First-week check-in completed",
      description: "Confirm access works, questions answered and joining closed out.",
      owner: "HR",
    },
  ],
  offboarding: [
    {
      title: "Resignation acknowledged",
      description: "Notice received and last working day confirmed.",
      owner: "HR",
    },
    {
      title: "Handover plan agreed",
      description: "Work, contacts and pending items assigned to a colleague.",
      owner: "Manager",
    },
    {
      title: "Knowledge transfer completed",
      description: "Documents, credentials and walkthroughs handed over.",
      owner: "Manager",
    },
    {
      title: "Equipment returned",
      description: "Laptop, access card and other assets given back.",
      owner: "IT",
    },
    {
      title: "System access revoked",
      description: "Email, portals and building access closed on the last day.",
      owner: "IT",
    },
    {
      title: "Final settlement processed",
      description: "Dues, recoveries and last salary settled.",
      owner: "Finance",
    },
    {
      title: "Exit interview completed",
      description: "Feedback captured and recorded.",
      owner: "HR",
    },
    {
      title: "Experience letter issued",
      description: "Service and relieving letters shared.",
      owner: "HR",
    },
  ],
};

function OnboardingBody() {
  const { data: me } = useMe();
  const { companyId, companyById, canSeeAll } = useScope();
  const { data: employees = [] } = useEmployees();
  const { data: checklists = [] } = useEmployeeChecklists();
  const { data: items = [] } = useEmployeeChecklistItems();
  const { data: templates = [] } = useChecklistTemplates();
  const { data: templateItems = [] } = useChecklistTemplateItems();
  const queryClient = useQueryClient();

  const isHr = !!me?.isMaster || !!me?.hrCompanyId;
  const myId = me?.employee?.id;

  const scoped = useMemo(
    () => (companyId ? employees.filter((e) => e.company_id === companyId) : employees),
    [employees, companyId],
  );
  const scopedIds = useMemo(() => new Set(scoped.map((e) => e.id)), [scoped]);

  const visible = isHr
    ? checklists.filter((c) => scopedIds.has(c.employee_id))
    : checklists.filter((c) => c.employee_id === myId);

  const [openId, setOpenId] = useState<string>("");
  const [tile, setTile] = useState<string | null>(null);
  const activeId = openId || (visible[0]?.id ?? "");
  const active = visible.find((c) => c.id === activeId);
  const activeItems = items
    .filter((i) => i.checklist_id === activeId)
    .sort((a, b) => a.sort_order - b.sort_order);

  const [form, setForm] = useState({
    employee_id: "",
    kind: "onboarding" as ChecklistKind,
    template_id: "",
    due_date: today(),
  });
  const [newStep, setNewStep] = useState("");

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["employee_checklists"] });
    queryClient.invalidateQueries({ queryKey: ["employee_checklist_items"] });
    queryClient.invalidateQueries({ queryKey: ["checklist_templates"] });
    queryClient.invalidateQueries({ queryKey: ["checklist_template_items"] });
  };

  const progressOf = (checklistId: string) => {
    const list = items.filter((i) => i.checklist_id === checklistId);
    if (!list.length) return 0;
    return Math.round((list.filter((i) => i.done).length / list.length) * 100);
  };

  const startChecklist = useMutation({
    mutationFn: async () => {
      const employeeId = form.employee_id || scoped[0]?.id;
      if (!employeeId) throw new Error("Pick an employee first");
      const { data, error } = await supabase
        .from("employee_checklists")
        .insert({
          employee_id: employeeId,
          kind: form.kind,
          name: form.kind === "onboarding" ? "Onboarding" : "Exit clearance",
          due_date: form.due_date,
        })
        .select("id")
        .single();
      if (error) throw error;

      const fromTemplate = form.template_id
        ? templateItems
            .filter((t) => t.template_id === form.template_id)
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((t, idx) => ({
              checklist_id: data.id,
              title: t.title,
              description: t.description,
              owner_role: t.owner_role,
              sort_order: idx,
            }))
        : DEFAULT_STEPS[form.kind].map((s, idx) => ({
            checklist_id: data.id,
            title: s.title,
            description: s.description,
            owner_role: s.owner,
            sort_order: idx,
          }));

      const { error: itemsError } = await supabase
        .from("employee_checklist_items")
        .insert(fromTemplate);
      if (itemsError) throw itemsError;
      return data.id as string;
    },
    onSuccess: (id) => {
      toast.success("Checklist started");
      setOpenId(id);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleItem = useMutation({
    mutationFn: async ({ id, done }: { id: string; done: boolean }) => {
      const { error } = await supabase
        .from("employee_checklist_items")
        .update({ done, done_at: done ? new Date().toISOString() : null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => refresh(),
    onError: (e: Error) => toast.error(e.message),
  });

  const addStep = useMutation({
    mutationFn: async () => {
      if (!activeId) throw new Error("Open a checklist first");
      if (!newStep.trim()) throw new Error("Name the step");
      const { error } = await supabase.from("employee_checklist_items").insert({
        checklist_id: activeId,
        title: newStep.trim(),
        sort_order: activeItems.length,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setNewStep("");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeStep = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("employee_checklist_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => refresh(),
    onError: (e: Error) => toast.error(e.message),
  });

  const closeChecklist = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("employee_checklists")
        .update({ completed_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Checklist closed");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeChecklist = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("employee_checklists").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      setOpenId("");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const groupedItems = useMemo(() => {
    const map = new Map<string, typeof activeItems>();
    for (const i of activeItems) {
      const key = i.owner_role?.trim() || "HR";
      map.set(key, [...(map.get(key) ?? []), i]);
    }
    return [...map.entries()].sort(
      (a, b) =>
        (OWNER_ORDER.indexOf(a[0]) + 1 || 99) - (OWNER_ORDER.indexOf(b[0]) + 1 || 99) ||
        a[0].localeCompare(b[0]),
    );
  }, [activeItems]);

  const joiners = visible.filter((c) => c.kind === "onboarding" && !c.completed_at);
  const leavers = visible.filter((c) => c.kind === "offboarding" && !c.completed_at);
  const overdue = visible.filter(
    (c) => !c.completed_at && c.due_date && c.due_date < today() && progressOf(c.id) < 100,
  );

  const shown =
    tile === "joining"
      ? joiners
      : tile === "exits"
        ? leavers
        : tile === "overdue"
          ? overdue
          : tile === "completed"
            ? visible.filter((c) => c.completed_at)
            : visible;
  const toggle = (k: string) => setTile((prev) => (prev === k ? null : k));

  const templateOptions = [
    { value: "", label: "Standard steps" },
    ...templates
      .filter((t) => t.kind === form.kind)
      .map((t) => ({ value: t.id, label: t.name })),
  ];

  return (
    <>
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {isHr ? (
          <>
            <StatCard
              label="Joining in progress"
              value={joiners.length}
              hint="checklists open"
              onClick={() => toggle("joining")}
              active={tile === "joining"}
            />
            <StatCard
              label="Exits in progress"
              value={leavers.length}
              hint="clearances open"
              onClick={() => toggle("exits")}
              active={tile === "exits"}
            />
            <StatCard
              label="Past due"
              value={overdue.length}
              hintTone="warn"
              hint="need attention"
              onClick={() => toggle("overdue")}
              active={tile === "overdue"}
            />
            <StatCard
              label="Completed"
              value={visible.filter((c) => c.completed_at).length}
              hintTone="good"
              hint="closed out"
              onClick={() => toggle("completed")}
              active={tile === "completed"}
            />
          </>
        ) : (
          <>
            <StatCard
              label="My progress"
              value={`${active ? progressOf(active.id) : 0}%`}
              hint="steps complete"
            />
            <StatCard
              label="Steps done"
              value={`${activeItems.filter((i) => i.done).length}/${activeItems.length}`}
              hintTone="good"
              hint="overall"
            />
            <StatCard
              label="Waiting on me"
              value={
                activeItems.filter((i) => !i.done && (i.owner_role || "") === "New joiner").length
              }
              hintTone="warn"
              hint="my actions"
            />
            <StatCard
              label="Target date"
              value={active?.due_date ? fmtDate(active.due_date) : "—"}
              hint="to finish by"
            />
          </>
        )}
      </section>
      {isHr && tile && (
        <FilterNote label={tile} count={shown.length} onClear={() => setTile(null)} />
      )}

      <div className="mt-4 grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 space-y-4">
          <Panel title={`Checklists · ${shown.length}`}>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left label-mono border-b border-line">
                    <th className="px-4 py-2.5 font-medium">Person</th>
                    {canSeeAll && isHr && <th className="px-4 py-2.5 font-medium">Entity</th>}
                    <th className="px-4 py-2.5 font-medium">Type</th>
                    <th className="px-4 py-2.5 font-medium">Progress</th>
                    <th className="px-4 py-2.5 font-medium">Due</th>
                    <th className="px-4 py-2.5 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {shown.map((c) => {
                    const emp = employees.find((e) => e.id === c.employee_id);
                    const pct = progressOf(c.id);
                    return (
                      <tr
                        key={c.id}
                        className={`hover:bg-ink/[0.03] ${activeId === c.id ? "bg-ink/[0.04]" : ""}`}
                      >
                        <td className="px-4 py-3">
                          <p className="font-medium">{emp?.full_name ?? "—"}</p>
                          <p className="text-[11px] font-mono text-ink-soft">{emp?.job_title}</p>
                        </td>
                        {canSeeAll && isHr && (
                          <td className="px-4 py-3">
                            <EntityTag company={emp ? companyById(emp.company_id) : undefined} />
                          </td>
                        )}
                        <td className="px-4 py-3 font-mono text-[12px] text-ink-soft">
                          {c.kind === "onboarding" ? "Joining" : "Exit"}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-24 rounded-full bg-line overflow-hidden">
                              <div className="h-full bg-perp" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="font-mono text-[11px] text-ink-soft">{pct}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono text-[12px] text-ink-soft">
                          {c.completed_at ? "closed" : c.due_date ? fmtDate(c.due_date) : "—"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => setOpenId(c.id)}
                            className="h-7 px-2.5 rounded-md ring-1 ring-line text-[11px] font-medium cursor-pointer hover:bg-ink/5"
                          >
                            Open
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {!shown.length && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-ink-soft">
                        {isHr ? "No checklists started yet." : "You have no checklist right now."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>

          {active && (
            <Panel
              title={`Steps · ${employees.find((e) => e.id === active.employee_id)?.full_name ?? ""}`}
              meta={
                <span className="label-mono">
                  {activeItems.filter((i) => i.done).length}/{activeItems.length} done
                </span>
              }
            >
              <div className="divide-y divide-line">
                {groupedItems.map(([owner, list]) => (
                  <div key={owner}>
                    <div className="px-4 py-2 bg-ink/[0.03] flex items-center justify-between">
                      <span className="label-mono">{owner}</span>
                      <span className="label-mono">
                        {list.filter((i) => i.done).length}/{list.length}
                      </span>
                    </div>
                    <div className="divide-y divide-line">
                      {list.map((i) => (
                        <div key={i.id} className="px-4 py-3 flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={i.done}
                            onChange={(ev) =>
                              toggleItem.mutate({ id: i.id, done: ev.target.checked })
                            }
                            className="mt-1 size-4 accent-black cursor-pointer"
                          />
                          <div className="min-w-0 flex-1">
                            <p
                              className={`text-[13px] ${i.done ? "line-through text-ink-soft" : "font-medium"}`}
                            >
                              {i.title}
                              {!isHr && owner === "New joiner" && !i.done && (
                                <span className="ml-2 rounded-full px-2 py-0.5 text-[10px] font-mono ring-1 ring-line">
                                  your action
                                </span>
                              )}
                            </p>
                            {i.description && (
                              <p className="text-[11px] font-mono text-ink-soft">{i.description}</p>
                            )}
                            {i.done && i.done_at && (
                              <p className="text-[11px] font-mono text-ink-soft">
                                done {fmtDate(i.done_at)}
                              </p>
                            )}
                          </div>
                          {isHr && (
                            <button
                              onClick={() => removeStep.mutate(i.id)}
                              className="h-7 px-2.5 rounded-md ring-1 ring-line text-[11px] font-medium text-destructive cursor-pointer hover:bg-ink/5"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {!activeItems.length && (
                  <p className="px-4 py-8 text-center text-[13px] text-ink-soft">No steps yet.</p>
                )}
              </div>
              {isHr && (
                <div className="p-4 border-t border-line flex flex-wrap items-end gap-2">
                  <div className="flex-1 min-w-56">
                    <Input label="Add a step" value={newStep} onChange={setNewStep} />
                  </div>
                  <button
                    onClick={() => addStep.mutate()}
                    className="h-9 px-3 rounded-md bg-brand text-paper text-[12px] font-semibold cursor-pointer hover:bg-brand-deep"
                  >
                    Add
                  </button>
                  {!active.completed_at && (
                    <button
                      onClick={() => closeChecklist.mutate(active.id)}
                      className="h-9 px-3 rounded-md ring-1 ring-line text-[12px] font-medium cursor-pointer hover:bg-ink/5"
                    >
                      Mark complete
                    </button>
                  )}
                  <button
                    onClick={() => removeChecklist.mutate(active.id)}
                    className="h-9 px-3 rounded-md ring-1 ring-line text-[12px] font-medium text-destructive cursor-pointer hover:bg-ink/5"
                  >
                    Delete checklist
                  </button>
                </div>
              )}
            </Panel>
          )}
        </div>

        {isHr && (
          <aside className="space-y-4">
            <Panel title="Start a checklist">
              <div className="p-4 space-y-3">
                <Select
                  label="Employee"
                  value={form.employee_id || (scoped[0]?.id ?? "")}
                  onChange={(v) => setForm({ ...form, employee_id: v })}
                  options={scoped.map((e) => ({ value: e.id, label: e.full_name }))}
                />
                <Select
                  label="Type"
                  value={form.kind}
                  onChange={(v) => setForm({ ...form, kind: v as ChecklistKind, template_id: "" })}
                  options={[
                    { value: "onboarding", label: "Joining" },
                    { value: "offboarding", label: "Exit" },
                  ]}
                />
                <Select
                  label="Steps from"
                  value={form.template_id}
                  onChange={(v) => setForm({ ...form, template_id: v })}
                  options={templateOptions}
                />
                <Input
                  label="Target date"
                  type="date"
                  value={form.due_date}
                  onChange={(v) => setForm({ ...form, due_date: v })}
                />
                <button
                  onClick={() => startChecklist.mutate()}
                  disabled={startChecklist.isPending}
                  className="w-full h-9 rounded-md bg-brand text-paper text-[12px] font-semibold cursor-pointer hover:bg-brand-deep disabled:opacity-60"
                >
                  {startChecklist.isPending ? "Starting…" : "Start checklist"}
                </button>
              </div>
            </Panel>

            <Panel title="Saved step sets">
              <div className="divide-y divide-line">
                {templates.map((t) => (
                  <div key={t.id} className="px-4 py-2.5">
                    <p className="text-[13px] font-medium">{t.name}</p>
                    <p className="text-[11px] font-mono text-ink-soft">
                      {t.kind === "onboarding" ? "Joining" : "Exit"} ·{" "}
                      {templateItems.filter((i) => i.template_id === t.id).length} steps
                    </p>
                  </div>
                ))}
                {!templates.length && (
                  <p className="px-4 py-6 text-center text-[12px] text-ink-soft">
                    Standard steps are used when no set is saved.
                  </p>
                )}
              </div>
            </Panel>
          </aside>
        )}
      </div>
    </>
  );
}
