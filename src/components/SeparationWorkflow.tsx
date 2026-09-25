import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Circle, CircleDot, FileText, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fmtDate, type Employee, type Me, type SeparationRequest } from "@/lib/hrms";

export type SepTask = {
  id: string;
  separation_id: string;
  step_no: number;
  task_key: string;
  title: string;
  kind: "submission" | "approval" | "clearance" | "closure";
  owner_role: string;
  assignee_id: string | null;
  status: "waiting" | "pending" | "done" | "rejected" | "skipped";
  activated_at: string | null;
  due_date: string | null;
  form: Record<string, unknown>;
  note: string;
  completed_by: string | null;
  completed_at: string | null;
  escalation_level: number;
};

export const EXIT_REASONS = [
  "Better opportunity",
  "Compensation",
  "Career change",
  "Higher studies",
  "Personal / family",
  "Relocation",
  "Health",
  "Work environment",
  "Other",
];

type Field = {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "date" | "select" | "multi" | "check";
  options?: string[];
  required?: boolean;
  section?: string;
};

const OWNER_LABEL: Record<string, string> = {
  employee: "Employee",
  manager: "Reporting manager",
  hrbp: "HRBP",
  functional_head: "Functional head",
  payroll: "Payroll",
  it: "IT admin",
  finance: "Finance team",
  admin: "Admin team",
  hr_head: "HR Head",
  legal: "Legal team",
  initiator: "Initiated by",
};

export const TERMINATION_REASONS = ["Performance", "Misconduct", "Redundancy", "Policy Violation", "Absconding"];

/** Forms from the separation workbook, per step. */
export const TASK_FORMS: Record<string, Field[]> = {
  resignation: [
    { key: "reason", label: "Reason for leaving", type: "select", options: EXIT_REASONS, required: true },
    { key: "last_day", label: "Proposed last working day", type: "date", required: true },
    { key: "comments", label: "Comments", type: "textarea" },
  ],
  manager: [
    { key: "feedback", label: "Feedback", type: "textarea", required: true },
    { key: "np_waiver", label: "Notice period waiver", type: "select", options: ["No waiver", "Partial waiver", "Full waiver"], required: true },
    { key: "waiver_days", label: "Days waived", type: "number" },
    { key: "replacement_plan", label: "Replacement plan", type: "select", options: ["Backfill needed", "Internal redistribution", "No replacement"], required: true },
  ],
  hrbp: [
    { key: "notice_days", label: "Notice period (days)", type: "number", required: true },
    { key: "last_day", label: "Confirmed last working day", type: "date", required: true },
    { key: "eligibility", label: "Rehire eligibility", type: "select", options: ["Eligible", "Not eligible", "Review later"], required: true },
    { key: "comments", label: "Comments", type: "textarea" },
  ],
  functional_head: [{ key: "comments", label: "Comments", type: "textarea" }],
  payroll: [{ key: "comments", label: "Comments on notice recovery / pay", type: "textarea" }],
  it: [
    { key: "laptop", label: "Laptop returned", type: "check" },
    { key: "access_card", label: "Access card returned", type: "check" },
    { key: "licenses", label: "Software licences revoked", type: "check" },
    { key: "accounts", label: "Email and system access closed", type: "check" },
    { key: "comments", label: "Comments", type: "textarea" },
  ],
  finance: [
    { key: "advance", label: "Salary advance outstanding", type: "number" },
    { key: "loan", label: "Loan outstanding", type: "number" },
    { key: "reimbursement", label: "Reimbursement due to employee", type: "number" },
    { key: "expense_dues", label: "Expense dues to recover", type: "number" },
    { key: "comments", label: "Comments", type: "textarea" },
  ],
  admin: [
    { key: "furniture", label: "Furniture / pedestal keys", type: "check" },
    { key: "sim", label: "Company SIM", type: "check" },
    { key: "parking", label: "Parking card", type: "check" },
    { key: "id_card", label: "ID card", type: "check" },
    { key: "comments", label: "Comments", type: "textarea" },
  ],
  exit_interview: [
    { key: "reasons", label: "Exit reasons", type: "multi", options: EXIT_REASONS, required: true },
    { key: "feedback", label: "Feedback", type: "textarea", required: true },
    { key: "suggestions", label: "Suggestions", type: "textarea" },
  ],
  fnf: [
    { key: "last_day", label: "Last working day", type: "date", required: true, section: "Basic details" },
    { key: "pending_salary_days", label: "Pending salary (days)", type: "number", section: "Settlement details" },
    { key: "final_salary", label: "Final salary amount", type: "number", section: "Settlement details" },
    { key: "encash_days", label: "Leave encashment (days)", type: "number", section: "Settlement details" },
    { key: "encash_amount", label: "Leave encashment amount", type: "number", section: "Settlement details" },
    { key: "unpaid_days", label: "Unpaid leave (days)", type: "number", section: "Settlement details" },
    { key: "unpaid_amount", label: "Unpaid leave recovery", type: "number", section: "Settlement details" },
    { key: "expenses", label: "Approved expenses paid out", type: "number", section: "Settlement details" },
    { key: "reimbursement_pending", label: "Reimbursement pending", type: "select", options: ["Yes", "No"], section: "Settlement details" },
    { key: "total_payable", label: "Total payable amount", type: "number", required: true, section: "Settlement details" },
    { key: "total_recoverable", label: "Total recoverable amount", type: "number", required: true, section: "Settlement details" },
    { key: "net_payable", label: "Final payable (net)", type: "number", required: true, section: "Settlement details" },
    { key: "paid_on", label: "Paid on", type: "date", required: true, section: "Settlement details" },
    { key: "approved_by", label: "Approved by", type: "select", options: ["HR Ops", "Payroll", "Finance"], required: true, section: "Approval" },
  ],
  letters: [],
  // Involuntary separation (termination) forms
  inv_initiation: [
    { key: "reason", label: "Reason for termination", type: "select", options: TERMINATION_REASONS, required: true, section: "Separation details" },
    { key: "effective_date", label: "Termination effective date", type: "date", required: true, section: "Separation details" },
    { key: "supporting_docs", label: "Supporting documents attached", type: "check", section: "Separation details" },
    { key: "details", label: "Details", type: "textarea", section: "Separation details" },
  ],
  inv_manager: [{ key: "comments", label: "Comments", type: "textarea", required: true }],
  inv_hrbp: [
    { key: "last_day", label: "Confirmed last working day", type: "date", required: true },
    { key: "comments", label: "Comments", type: "textarea" },
  ],
  inv_hr_head: [
    { key: "docs_reviewed", label: "Case details and supporting documents reviewed", type: "check", section: "HR validation" },
    { key: "last_day", label: "Final last working day", type: "date", required: true, section: "HR validation" },
    { key: "approved_by", label: "Approved by", type: "select", options: ["HR Head", "CHRO"], required: true, section: "HR validation" },
    { key: "comments", label: "Comments", type: "textarea", section: "HR validation" },
  ],
  inv_legal: [
    { key: "compliance", label: "Compliance verified", type: "check" },
    { key: "show_cause", label: "Show cause notice", type: "select", options: ["Issued", "Not required"], required: true },
    { key: "documents", label: "Legal documentation", type: "select", options: ["Complete", "Not required"], required: true },
    { key: "comments", label: "Comments", type: "textarea" },
  ],
  inv_payroll: [
    { key: "notice_pay", label: "Notice period pay", type: "select", options: ["Pay in lieu of notice", "Not applicable", "Recover from employee"], required: true },
    { key: "comments", label: "Comments on dues and recovery", type: "textarea" },
  ],
  inv_it: [
    { key: "laptop", label: "Laptop retrieved", type: "check" },
    { key: "accounts", label: "System access disabled", type: "check" },
    { key: "licenses", label: "Software licences revoked", type: "check" },
    { key: "comments", label: "Comments", type: "textarea" },
  ],
  inv_admin: [
    { key: "id_card", label: "ID card collected", type: "check" },
    { key: "access_card", label: "Access card collected", type: "check" },
    { key: "sim", label: "Company SIM collected", type: "check" },
    { key: "comments", label: "Comments", type: "textarea" },
  ],
};

export function formFor(task: SepTask, involuntary: boolean): Field[] {
  return (involuntary && TASK_FORMS[`inv_${task.task_key}`]) || TASK_FORMS[task.task_key] || [];
}

export function useSeparationTasks(separationId?: string) {
  return useQuery({
    queryKey: ["separation_tasks", separationId],
    enabled: !!separationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("separation_tasks" as never)
        .select("*")
        .eq("separation_id", separationId!)
        .order("step_no");
      if (error) throw error;
      return (data ?? []) as unknown as SepTask[];
    },
  });
}

function hasDuty(me: Me | null | undefined, role: string, companyId: string) {
  return !!me?.roles.some((r) => r.role === role && (!r.company_id || r.company_id === companyId));
}

function canAct(task: SepTask, me: Me | null | undefined, emp: Employee) {
  const myId = me?.employee?.id;
  if (!me || !myId || task.status !== "pending") return false;
  if (task.owner_role === "employee") return emp.id === myId;
  if (emp.id === myId) return false;
  if (me.isMaster) return true;
  if (task.escalation_level >= 2 && hasDuty(me, "hr_head", emp.company_id)) return true;
  switch (task.owner_role) {
    case "manager":
      return task.assignee_id === myId || emp.manager_id === myId;
    case "functional_head":
      return task.assignee_id === myId;
    case "hrbp":
      return me.hrCompanyIds.includes(emp.company_id);
    case "payroll":
      return hasDuty(me, "finance_payroll", emp.company_id);
    case "it":
      return hasDuty(me, "it_asset", emp.company_id) || me.hrCompanyIds.includes(emp.company_id);
    case "finance":
      return hasDuty(me, "finance_expense", emp.company_id);
    case "admin":
      return hasDuty(me, "admin_facilities", emp.company_id);
    case "hr_head":
      return hasDuty(me, "hr_head", emp.company_id);
    case "legal":
      return hasDuty(me, "legal", emp.company_id);
  }
  return false;
}

function dueState(task: SepTask) {
  if (task.status !== "pending" || !task.due_date) return "";
  const today = new Date().toISOString().slice(0, 10);
  if (task.due_date < today) return "overdue";
  return "";
}

export function SeparationWorkflow({
  separation,
  employee,
  me,
  openAssetCount,
  employeesById,
  fnfDefaults,
  companyName,
  onFnfDone,
}: {
  separation: SeparationRequest;
  employee: Employee;
  me: Me | null | undefined;
  openAssetCount: number;
  employeesById: (id: string | null) => Employee | undefined;
  fnfDefaults: Record<string, string>;
  companyName: string;
  onFnfDone: () => Promise<void> | void;
}) {
  const queryClient = useQueryClient();
  const { data: tasks = [] } = useSeparationTasks(separation.id);
  const [openKey, setOpenKey] = useState("");
  const involuntary = separation.separation_kind === "involuntary";
  const myActionable = tasks.find((t) => canAct(t, me, employee));

  useEffect(() => {
    setOpenKey(myActionable?.task_key ?? "");
  }, [separation.id, myActionable?.task_key]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["separation_tasks"] });
    queryClient.invalidateQueries({ queryKey: ["separation_requests"] });
    queryClient.invalidateQueries({ queryKey: ["employees"] });
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
  };

  const decide = useMutation({
    mutationFn: async (v: { task: SepTask; decision: "done" | "rejected"; form: Record<string, unknown>; note: string }) => {
      const { error } = await supabase.rpc("complete_separation_task" as never, {
        _task_id: v.task.id,
        _decision: v.decision,
        _form: v.form,
        _note: v.note,
      } as never);
      if (error) throw error;
      if (v.task.task_key === "fnf" && v.decision === "done") await onFnfDone();
    },
    onSuccess: (_d, v) => {
      toast.success(v.decision === "rejected" ? (involuntary ? "Termination declined" : "Resignation declined") : `${v.task.title} completed`);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!tasks.length) {
    return (
      <p className="text-[12.5px] text-ink-soft">
        This exit was raised before the step-by-step workflow existed, so it follows the older steps below.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {tasks.map((t) => {
        const actionable = canAct(t, me, employee);
        const expanded = openKey === t.task_key;
        const overdue = dueState(t) === "overdue";
        const assignee = employeesById(t.assignee_id);
        const doneBy = employeesById(t.completed_by);
        const Icon =
          t.status === "done" ? CheckCircle2 : t.status === "rejected" ? XCircle : t.status === "pending" ? CircleDot : Circle;
        return (
          <div
            key={t.id}
            className={`rounded-md ring-1 ${t.status === "pending" ? "ring-brand/40 bg-brand/[0.03]" : "ring-line"} ${t.status === "skipped" ? "opacity-50" : ""}`}
          >
            <button
              onClick={() => setOpenKey(expanded ? "" : t.task_key)}
              className="w-full text-left px-3 py-2.5 flex items-start gap-2.5 cursor-pointer"
            >
              <Icon
                className={`size-4 mt-0.5 shrink-0 ${t.status === "done" ? "text-brand" : t.status === "rejected" ? "text-destructive" : t.status === "pending" ? "text-brand" : "text-ink-soft"}`}
              />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium">
                  {t.step_no}. {t.title}
                  {actionable && (
                    <span className="ml-2 inline-flex h-5 items-center px-1.5 rounded bg-brand text-paper text-[10px] font-semibold">
                      Your action
                    </span>
                  )}
                </p>
                <p className="text-[11.5px] text-ink-soft">
                  {OWNER_LABEL[t.owner_role] ?? t.owner_role}
                  {assignee ? ` · ${assignee.full_name}` : ""}
                  {" · "}
                  {t.status === "skipped"
                    ? "not needed"
                    : t.status === "done"
                      ? `done ${t.completed_at ? fmtDate(t.completed_at.slice(0, 10)) : ""}${doneBy ? ` by ${doneBy.full_name}` : ""}`
                      : t.status === "rejected"
                        ? "declined"
                        : t.status === "pending"
                          ? `waiting${t.due_date ? ` · due ${fmtDate(t.due_date)}` : ""}`
                          : `starts later${t.due_date ? ` · due ${fmtDate(t.due_date)}` : ""}`}
                </p>
                {(overdue || t.escalation_level > 0) && t.status === "pending" && (
                  <p className="text-[11.5px] text-destructive inline-flex items-center gap-1 mt-0.5">
                    <AlertTriangle className="size-3" />
                    {t.escalation_level >= 2
                      ? "Escalated to HR Head"
                      : t.escalation_level === 1
                        ? "Escalated to functional head"
                        : "Past due"}
                  </p>
                )}
              </div>
            </button>
            {expanded && (
              <div className="px-3 pb-3">
                {actionable ? (
                  <TaskForm
                    task={t}
                    fields={formFor(t, involuntary)}
                    busy={decide.isPending}
                    defaults={
                      t.task_key === "fnf"
                        ? fnfDefaults
                        : t.task_key === "hrbp" || t.task_key === "hr_head"
                          ? {
                              notice_days: String(separation.notice_days),
                              last_day: separation.approved_last_day ?? separation.requested_last_day,
                            }
                          : {}
                    }
                    blocker={
                      t.task_key === "it" && openAssetCount > 0
                        ? `${openAssetCount} item${openAssetCount === 1 ? "" : "s"} still with this person — mark each one returned in the asset list below first.`
                        : ""
                    }
                    onLetters={
                      t.task_key === "letters"
                        ? () => openLetters(employee, separation, companyName)
                        : undefined
                    }
                    onSubmit={(decision, form, note) => decide.mutate({ task: t, decision, form, note })}
                  />
                ) : (
                  <FormSummary task={t} fields={formFor(t, involuntary)} />
                )}
                {t.task_key === "letters" && t.status === "done" && (
                  <button
                    onClick={() => openLetters(employee, separation, companyName)}
                    className="mt-2 h-8 px-3 rounded-md ring-1 ring-line text-[12px] font-medium cursor-pointer hover:bg-ink/5 inline-flex items-center gap-1.5"
                  >
                    <FileText className="size-3.5" /> View letters
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function FormSummary({ task, fields }: { task: SepTask; fields: Field[] }) {
  const entries = fields
    .map((f) => [f.label, task.form?.[f.key]] as const)
    .filter(([, v]) => v !== undefined && v !== "" && v !== null && !(Array.isArray(v) && !v.length));
  if (!entries.length && !task.note)
    return <p className="text-[12px] text-ink-soft">No details recorded yet.</p>;
  return (
    <dl className="grid sm:grid-cols-2 gap-x-4 gap-y-1 text-[12.5px]">
      {entries.map(([label, v]) => (
        <div key={label} className="flex justify-between gap-2">
          <dt className="text-ink-soft">{label}</dt>
          <dd className="text-right">
            {Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v)}
          </dd>
        </div>
      ))}
      {task.note && (
        <div className="sm:col-span-2 text-ink-soft">Note: {task.note}</div>
      )}
    </dl>
  );
}

function TaskForm({
  task,
  fields,
  defaults,
  busy,
  blocker,
  onLetters,
  onSubmit,
}: {
  task: SepTask;
  fields: Field[];
  defaults: Record<string, string>;
  busy: boolean;
  blocker: string;
  onLetters?: (() => void) | undefined;
  onSubmit: (decision: "done" | "rejected", form: Record<string, unknown>, note: string) => void;
}) {
  const [values, setValues] = useState<Record<string, unknown>>(() => ({ ...defaults }));
  const [note, setNote] = useState("");
  const set = (k: string, v: unknown) => setValues((p) => ({ ...p, [k]: v }));

  const sections = useMemo(() => {
    const out: { name: string; fields: Field[] }[] = [];
    for (const f of fields) {
      const name = f.section ?? "";
      const last = out[out.length - 1];
      if (last && last.name === name) last.fields.push(f);
      else out.push({ name, fields: [f] });
    }
    return out;
  }, [fields]);

  const submit = (decision: "done" | "rejected") => {
    if (decision === "done") {
      const missing = fields.filter((f) => {
        const v = values[f.key];
        return f.required && (v === undefined || v === "" || (Array.isArray(v) && !v.length));
      });
      if (missing.length) {
        toast.error(`Please fill: ${missing.map((m) => m.label).join(", ")}`);
        return;
      }
    } else if (!note.trim()) {
      toast.error("Add a note explaining why");
      return;
    }
    onSubmit(decision, values, note);
  };

  const inputCls =
    "w-full h-9 px-2.5 rounded-md ring-1 ring-line bg-paper text-[13px] focus:outline-none focus:ring-brand";

  return (
    <div className="space-y-3">
      {sections.map((s) => (
        <div key={s.name || "main"} className="space-y-2">
          {s.name && <p className="label-mono">{s.name}</p>}
          <div className="grid sm:grid-cols-2 gap-3">
            {s.fields.map((f) => (
              <label
                key={f.key}
                className={`block ${f.type === "textarea" || f.type === "multi" ? "sm:col-span-2" : ""} ${f.type === "check" ? "flex items-center gap-2" : ""}`}
              >
                {f.type === "check" ? (
                  <>
                    <input
                      type="checkbox"
                      checked={!!values[f.key]}
                      onChange={(e) => set(f.key, e.target.checked)}
                      className="size-4 accent-[var(--color-brand)]"
                    />
                    <span className="text-[12.5px]">{f.label}</span>
                  </>
                ) : (
                  <>
                    <span className="block text-[11.5px] text-ink-soft mb-1">
                      {f.label}
                      {f.required ? " *" : ""}
                    </span>
                    {f.type === "textarea" ? (
                      <textarea
                        value={String(values[f.key] ?? "")}
                        onChange={(e) => set(f.key, e.target.value)}
                        rows={2}
                        className={`${inputCls} h-auto py-2`}
                      />
                    ) : f.type === "select" ? (
                      <select
                        value={String(values[f.key] ?? "")}
                        onChange={(e) => set(f.key, e.target.value)}
                        className={inputCls}
                      >
                        <option value="">Choose…</option>
                        {f.options!.map((o) => (
                          <option key={o}>{o}</option>
                        ))}
                      </select>
                    ) : f.type === "multi" ? (
                      <div className="flex flex-wrap gap-1.5">
                        {f.options!.map((o) => {
                          const list = (values[f.key] as string[] | undefined) ?? [];
                          const on = list.includes(o);
                          return (
                            <button
                              type="button"
                              key={o}
                              onClick={() => set(f.key, on ? list.filter((x) => x !== o) : [...list, o])}
                              className={`h-7 px-2.5 rounded-full text-[11.5px] cursor-pointer ${on ? "bg-brand text-paper" : "ring-1 ring-line hover:bg-brand/5"}`}
                            >
                              {o}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <input
                        type={f.type}
                        value={String(values[f.key] ?? "")}
                        onChange={(e) => set(f.key, e.target.value)}
                        className={inputCls}
                      />
                    )}
                  </>
                )}
              </label>
            ))}
          </div>
        </div>
      ))}
      <label className="block">
        <span className="block text-[11.5px] text-ink-soft mb-1">
          Note{task.kind === "approval" ? " (required to decline)" : ""}
        </span>
        <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} />
      </label>
      {blocker && <p className="text-[12px] text-destructive">{blocker}</p>}
      <div className="flex flex-wrap gap-2">
        {onLetters && (
          <button
            onClick={onLetters}
            className="h-9 px-3 rounded-md ring-1 ring-line text-[12px] font-medium cursor-pointer hover:bg-ink/5 inline-flex items-center gap-1.5"
          >
            <FileText className="size-3.5" /> Preview letters
          </button>
        )}
        <button
          onClick={() => submit("done")}
          disabled={busy || !!blocker}
          className="h-9 px-3 rounded-md bg-brand text-paper text-[12px] font-semibold cursor-pointer hover:bg-brand-deep disabled:opacity-50"
        >
          {task.kind === "approval"
            ? "Approve"
            : task.task_key === "letters"
              ? "Issue letters & close"
              : task.task_key === "fnf"
                ? "Settle full & final"
                : "Mark cleared"}
        </button>
        {task.kind === "approval" && (
          <button
            onClick={() => submit("rejected")}
            disabled={busy}
            className="h-9 px-3 rounded-md ring-1 ring-line text-[12px] font-medium cursor-pointer hover:bg-ink/5 disabled:opacity-50"
          >
            Decline
          </button>
        )}
      </div>
    </div>
  );
}

function openLetters(emp: Employee, sep: SeparationRequest, company: string) {
  const lwd = fmtDate(sep.approved_last_day ?? sep.requested_last_day);
  const joined = fmtDate(emp.joined_on);
  const today = fmtDate(new Date().toISOString().slice(0, 10));
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const name = esc(emp.full_name);
  const title = esc(emp.job_title || "");
  const co = esc(company);
  const html = `<!doctype html><html><head><title>Letters · ${name}</title>
<style>body{font-family:Georgia,serif;max-width:720px;margin:40px auto;line-height:1.6;color:#1f2a2e}
h2{margin-top:0}section{page-break-after:always;padding-bottom:40px}.m{color:#5b6b70;font-size:14px}</style></head><body>
<section><p class="m">${today}</p><h2>Relieving letter</h2>
<p>Dear ${name}${emp.employee_code ? ` (${esc(emp.employee_code)})` : ""},</p>
<p>This is to confirm that ${sep.separation_kind === "involuntary" ? "your employment has ended and" : "your resignation has been accepted and"} you are relieved from your duties as <b>${title}</b> at <b>${co}</b> with effect from the close of business on <b>${lwd}</b>.</p>
<p>Your full and final settlement has been completed. We thank you for your contributions and wish you the very best.</p>
<p>Regards,<br/>HR Team, ${co}</p></section>
${sep.separation_kind === "involuntary" ? "" : `<section><p class="m">${today}</p><h2>Experience letter</h2><p><b>To whom it may concern</b></p>
<p>This is to certify that <b>${name}</b> was employed with <b>${co}</b> from <b>${joined}</b> to <b>${lwd}</b>, last holding the position of <b>${title}</b>${emp.department ? ` in the ${esc(emp.department)} department` : ""}.</p>
<p>We wish them success in all future endeavours.</p>
<p>Regards,<br/>HR Team, ${co}</p></section>`}
<script>window.print()</script></body></html>`;
  const w = window.open("", "_blank");
  if (!w) {
    toast.error("Allow pop-ups to see the letters");
    return;
  }
  w.document.write(html);
  w.document.close();
}
