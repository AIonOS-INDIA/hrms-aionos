import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchAll } from "@/lib/fetch-all";
import { supabase } from "@/integrations/supabase/client";

export type AppRole =
  | "master_hr"
  | "company_hr"
  | "employee"
  | "finance_expense"
  | "finance_payroll"
  | "it_asset";

export const ROLE_LABELS: Record<AppRole, string> = {
  master_hr: "Master HR",
  company_hr: "Company HR",
  employee: "Employee",
  finance_expense: "Expense approver",
  finance_payroll: "Payroll approver",
  it_asset: "IT asset manager",
};

export type Company = {
  id: string;
  code: string;
  name: string;
  email_domain: string;
  accent: string;
  is_parent: boolean;
};

export type Employee = {
  id: string;
  user_id: string | null;
  full_name: string;
  email: string;
  company_id: string;
  job_title: string;
  department: string;
  location: string;
  status: "onboarding" | "active" | "on_leave" | "offboarded";
  access_level: AppRole;
  joined_on: string;
  exit_on: string | null;
  manager_id: string | null;
  employee_code?: string | null;
  gender?: "male" | "female" | "undisclosed" | null;
  date_of_birth?: string | null;
  employment_type?: "full_time" | "part_time" | "consultant" | "intern" | null;
  band?: string | null;
  office_area?: string | null;
  office_city?: string | null;
  legal_entity?: string | null;
  business_unit?: string | null;
  phone?: string | null;
  home_address?: string | null;
  /** Where this person was hired from — referral, job board, agency, campus… */
  hired_from?: string | null;
};


/** Chain from the employee's manager up to the CEO (top-most manager). */
export function reportingChain(employees: Employee[], employeeId: string): Employee[] {
  const byId = new Map(employees.map((e) => [e.id, e]));
  const chain: Employee[] = [];
  const seen = new Set<string>([employeeId]);
  let current = byId.get(employeeId)?.manager_id ?? null;
  while (current && !seen.has(current)) {
    const next = byId.get(current);
    if (!next) break;
    chain.push(next);
    seen.add(next.id);
    current = next.manager_id;
  }
  return chain;
}

export function directReports(employees: Employee[], employeeId: string): Employee[] {
  return employees.filter((e) => e.manager_id === employeeId && e.status !== "offboarded");
}

export type LeaveType = {
  id: string;
  code: string;
  name: string;
  annual_days: number;
  carry_forward_days: number;
  description: string;
};

export type LeaveRequest = {
  id: string;
  employee_id: string;
  leave_type_id: string;
  start_date: string;
  end_date: string;
  days: number;
  reason: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  created_at: string;
};

export type Timesheet = {
  id: string;
  employee_id: string;
  week_start: string;
  status: "draft" | "submitted" | "approved" | "rejected";
  total_hours: number;
  note: string;
  finance_status: "pending" | "approved" | "rejected" | "cancelled";
  finance_note: string;
  finance_decided_at: string | null;
};

export type TimesheetEntry = {
  id: string;
  timesheet_id: string;
  work_date: string;
  hours: number;
  project: string;
  notes: string;
};

export type Me = {
  userId: string;
  email: string;
  employee: Employee | null;
  roles: { role: AppRole; company_id: string | null }[];
  isMaster: boolean;
  hrCompanyId: string | null;
  /** Every entity a company HR is allowed to manage. */
  hrCompanyIds: string[];
  /** Entities where this person approves expense claims (empty = none). */
  expenseCompanyIds: string[];
  /** Entities where this person approves payslips and payments. */
  payrollCompanyIds: string[];
  /** Entities where this person keeps the asset register. */
  assetCompanyIds: string[];
  isExpenseApprover: boolean;
  isPayrollApprover: boolean;
  isAssetManager: boolean;
};

export const accentClass: Record<string, string> = {
  aionos: "bg-ink",
  perp: "bg-perp",
  whilter: "bg-whilter",
  cloud: "bg-cloud",
  inetum: "bg-inetum",
};

export const accentText: Record<string, string> = {
  aionos: "text-ink",
  perp: "text-perp",
  whilter: "text-whilter",
  cloud: "text-cloud",
  inetum: "text-inetum",
};

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    staleTime: 60_000,
    queryFn: async (): Promise<Me | null> => {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (!user) return null;

      await supabase.rpc("claim_my_employee_record");

      const [{ data: emp }, { data: roles }] = await Promise.all([
        supabase.from("employees").select("*").eq("user_id", user.id).maybeSingle(),
        supabase.from("user_roles").select("role, company_id").eq("user_id", user.id),
      ]);

      const roleRows = (roles ?? []) as { role: AppRole; company_id: string | null }[];
      return {
        userId: user.id,
        email: user.email ?? "",
        employee: (emp as Employee | null) ?? null,
        roles: roleRows,
        isMaster: roleRows.some((r) => r.role === "master_hr"),
        hrCompanyId: roleRows.find((r) => r.role === "company_hr")?.company_id ?? null,
        hrCompanyIds: roleRows
          .filter((r) => r.role === "company_hr" && r.company_id)
          .map((r) => r.company_id as string),
        expenseCompanyIds: roleRows
          .filter((r) => r.role === "finance_expense" && r.company_id)
          .map((r) => r.company_id as string),
        payrollCompanyIds: roleRows
          .filter((r) => r.role === "finance_payroll" && r.company_id)
          .map((r) => r.company_id as string),
        assetCompanyIds: roleRows
          .filter((r) => r.role === "it_asset" && r.company_id)
          .map((r) => r.company_id as string),
        isExpenseApprover: roleRows.some((r) => r.role === "finance_expense"),
        isPayrollApprover: roleRows.some((r) => r.role === "finance_payroll"),
        isAssetManager: roleRows.some((r) => r.role === "it_asset"),
      };
    },
  });
}

export function useCompanies() {
  return useQuery({
    queryKey: ["companies"],
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("*")
        .order("is_parent", { ascending: false })
        .order("name");
      if (error) throw error;
      return (data ?? []) as Company[];
    },
  });
}

export function useEmployees() {
  return useQuery({
    queryKey: ["employees"],
    staleTime: 120_000,
    queryFn: async () => {
      const all: Employee[] = [];
      const PAGE = 1000;
      for (let from = 0; from < 20000; from += PAGE) {
        const { data, error } = await supabase
          .from("employees")
          .select("*")
          .order("full_name")
          .order("id")
          .range(from, from + PAGE - 1);
        if (error) throw error;
        all.push(...((data ?? []) as Employee[]));
        if (!data || data.length < PAGE) break;
      }
      return all;
    },
  });
}

/** Fields whose values are picked from what already exists in the system. */
export const PICKLIST_FIELDS = [
  "job_title",
  "band",
  "department",
  "business_unit",
  "legal_entity",
  "location",
  "office_city",
  "office_area",
  "hired_from",
] as const;
export type PicklistField = (typeof PICKLIST_FIELDS)[number];

/**
 * Distinct, already-used values for each people field, so forms suggest what
 * exists instead of letting people re-type near-duplicates.
 */
export function usePicklists(companyId?: string | null) {
  const { data: employees = [] } = useEmployees();
  const { data: mastered = [] } = useEntityFieldValues();
  return useMemo(() => {
    const out = {} as Record<PicklistField, string[]>;
    for (const field of PICKLIST_FIELDS) {
      const seen = new Map<string, string>();
      for (const row of mastered) {
        if (row.field !== field || !row.active) continue;
        if (companyId && row.company_id !== companyId) continue;
        const raw = row.value.trim();
        if (raw && !seen.has(raw.toLowerCase())) seen.set(raw.toLowerCase(), raw);
      }
      for (const e of employees) {
        if (companyId && e.company_id !== companyId) continue;
        const raw = (e[field] ?? "").trim();
        if (!raw) continue;
        const key = raw.toLowerCase();
        if (!seen.has(key)) seen.set(key, raw);
      }
      out[field] = [...seen.values()].sort((a, b) => a.localeCompare(b));
    }
    return out;
  }, [employees, mastered, companyId]);
}

/** Master data values kept per legal entity in Entity setup. */
export type EntityFieldValue = {
  id: string;
  company_id: string;
  field: string;
  value: string;
  active: boolean;
  sort_order: number;
};

/** Fields mastered per entity, in the order they appear on the setup page. */
export const MASTER_FIELDS = [
  { key: "company", label: "Company" },
  { key: "legal_entity", label: "Legal entity" },
  { key: "country", label: "Country" },
  { key: "job_title", label: "Designation" },
  { key: "band", label: "Band" },
  { key: "department", label: "Department" },
  { key: "business_unit", label: "Business unit" },
  { key: "employment_type", label: "Employment type" },
  { key: "employment_status", label: "Employment status" },
  { key: "gender", label: "Gender" },
  { key: "location", label: "Office location" },
  { key: "office_city", label: "Office city" },
  { key: "office_area", label: "Current office area" },
] as const;
export type MasterField = (typeof MASTER_FIELDS)[number]["key"];

export function useEntityFieldValues() {
  return useQuery({
    queryKey: ["entity_field_values"],
    staleTime: 300_000,
    queryFn: async () => {
      const data = await fetchAll<EntityFieldValue>(() =>
        supabase
          .from("entity_field_values")
          .select("id,company_id,field,value,active,sort_order")
          .order("sort_order")
          .order("value")
          .order("id"),
      );
      return (data ?? []) as EntityFieldValue[];
    },
  });
}

/** Active mastered values for one entity and field, ready for a dropdown. */
export function masteredOptions(
  rows: EntityFieldValue[],
  companyId: string | null | undefined,
  field: MasterField,
): string[] {
  return rows
    .filter((r) => r.field === field && r.active && (!companyId || r.company_id === companyId))
    .map((r) => r.value)
    .filter((v, i, all) => all.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i)
    .sort((a, b) => a.localeCompare(b));
}

/** Small payload used by the shell for the entity headcount badges. */
export function useHeadcounts() {
  return useQuery({
    queryKey: ["employee_headcounts"],
    staleTime: 300_000,
    queryFn: async () => {
      const data = await fetchAll<{ company_id: string }>(() =>
        supabase.from("employees").select("company_id,status").neq("status", "offboarded").order("id"),
      );
      const map: Record<string, number> = {};
      for (const row of (data ?? []) as { company_id: string }[]) {
        map[row.company_id] = (map[row.company_id] ?? 0) + 1;
      }
      return map;
    },
  });
}

export function useLeaveTypes() {
  return useQuery({
    queryKey: ["leave_types"],
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("leave_types").select("*").order("name");
      if (error) throw error;
      return (data ?? []) as LeaveType[];
    },
  });
}

export function useLeaveRequests() {
  return useQuery({
    queryKey: ["leave_requests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leave_requests")
        .select("*")
        .order("start_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as LeaveRequest[];
    },
  });
}

export function useTimesheets() {
  return useQuery({
    queryKey: ["timesheets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("timesheets")
        .select("*")
        .order("week_start", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Timesheet[];
    },
  });
}

export function useTimesheetEntries(timesheetId: string | undefined) {
  return useQuery({
    queryKey: ["timesheet_entries", timesheetId],
    enabled: !!timesheetId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("timesheet_entries")
        .select("*")
        .eq("timesheet_id", timesheetId!)
        .order("work_date");
      if (error) throw error;
      return (data ?? []) as TimesheetEntry[];
    },
  });
}

export function useLeaveBalances(employeeId: string | undefined) {
  return useQuery({
    queryKey: ["leave_balances", employeeId],
    enabled: !!employeeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leave_balances")
        .select("*")
        .eq("employee_id", employeeId!);
      if (error) throw error;
      return (data ?? []) as {
        id: string;
        employee_id: string;
        leave_type_id: string;
        year: number;
        entitled_days: number;
        used_days: number;
      }[];
    },
  });
}

export function usePolicies() {
  return useQuery({
    queryKey: ["policies"],
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("policies").select("*").order("category");
      if (error) throw error;
      return (data ?? []) as {
        id: string;
        title: string;
        category: string;
        body: string;
        effective_from: string;
        company_id: string | null;
      }[];
    },
  });
}

export function useHolidays() {
  return useQuery({
    queryKey: ["holidays"],
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("holidays")
        .select("*")
        .order("holiday_date");
      if (error) throw error;
      return (data ?? []) as {
        id: string;
        name: string;
        holiday_date: string;
        location: string;
        company_id: string | null;
      }[];
    },
  });
}

export type EmployeeGoal = {
  id: string;
  employee_id: string;
  title: string;
  details: string;
  target_date: string;
  weight: number;
  progress: number;
  status: "draft" | "active" | "achieved" | "missed";
  created_at: string;
};

export type PerformanceReview = {
  id: string;
  employee_id: string;
  period: string;
  review_date: string;
  rating: number;
  strengths: string;
  improvements: string;
  summary: string;
  status: "draft" | "shared";
  created_at: string;
};

export function useEmployeeGoals() {
  return useQuery({
    queryKey: ["employee_goals"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_goals")
        .select("*")
        .order("target_date");
      if (error) throw error;
      return (data ?? []) as EmployeeGoal[];
    },
  });
}

export function usePerformanceReviews() {
  return useQuery({
    queryKey: ["performance_reviews"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("performance_reviews")
        .select("*")
        .order("review_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PerformanceReview[];
    },
  });
}

export type ManagerLink = {
  id: string;
  full_name: string;
  job_title: string;
  department: string;
  email: string;
  depth: number;
};

/** The signed-in employee's manager ladder, from direct manager up to the CEO. */
export function useMyReportingChain(enabled = true) {
  return useQuery({
    queryKey: ["my_reporting_chain"],
    enabled,
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("my_reporting_chain");
      if (error) throw error;
      return (data ?? []) as ManagerLink[];
    },
  });
}



export function mondayOf(date: Date) {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
}

export function fmtDate(value: string) {
  return new Date(value + "T00:00:00").toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function daysBetween(start: string, end: string) {
  const a = new Date(start + "T00:00:00").getTime();
  const b = new Date(end + "T00:00:00").getTime();
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

export type SubsidiaryRequest = {
  id: string;
  full_name: string;
  email: string;
  company_name: string;
  company_code: string;
  email_domain: string;
  note: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  decision_note: string | null;
  decided_at: string | null;
  created_at: string;
};

export function useSubsidiaryRequests(enabled: boolean) {
  return useQuery({
    queryKey: ["subsidiary_requests"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subsidiary_requests")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as SubsidiaryRequest[];
    },
  });
}

export type RequestAlert = {
  id: string;
  kind: "submitted" | "approved" | "rejected";
  title: string;
  detail: string;
  at: string;
};

export function useSubsidiaryRequestAlerts(enabled: boolean) {
  const queryClient = useQueryClient();
  const [alerts, setAlerts] = useState<RequestAlert[]>([]);
  const seen = useRef<Map<string, string> | null>(null);

  const { data } = useQuery({
    queryKey: ["subsidiary_requests", "alerts"],
    enabled,
    refetchInterval: 20000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subsidiary_requests")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as SubsidiaryRequest[];
    },
  });

  useEffect(() => {
    if (!enabled || !data) return;
    const next = new Map(data.map((r) => [r.id, r.status]));
    const prev = seen.current;
    seen.current = next;
    if (!prev) return;

    const fresh: RequestAlert[] = [];
    for (const row of data) {
      const before = prev.get(row.id);
      if (before === row.status) continue;
      const kind: RequestAlert["kind"] =
        before === undefined
          ? "submitted"
          : row.status === "approved"
            ? "approved"
            : row.status === "rejected"
              ? "rejected"
              : "submitted";
      const title =
        kind === "submitted"
          ? `New request · ${row.company_name}`
          : kind === "approved"
            ? `Approved · ${row.company_name}`
            : `Denied · ${row.company_name}`;
      const alert: RequestAlert = {
        id: `${row.id}-${kind}-${Date.now()}`,
        kind,
        title,
        detail: `${row.full_name} · ${row.email}`,
        at: new Date().toISOString(),
      };
      fresh.push(alert);
      if (kind === "submitted") toast(title, { description: alert.detail });
      else if (kind === "approved") toast.success(title, { description: alert.detail });
      else toast.error(title, { description: alert.detail });
    }
    if (fresh.length) {
      setAlerts((p) => [...fresh, ...p].slice(0, 8));
      queryClient.invalidateQueries({ queryKey: ["subsidiary_requests"] });
    }
  }, [enabled, data, queryClient]);

  return { alerts, dismiss: (id: string) => setAlerts((p) => p.filter((a) => a.id !== id)) };
}

// ===================== Extended HR modules =====================

export type ChecklistKind = "onboarding" | "offboarding";

export type ChecklistTemplate = {
  id: string;
  company_id: string | null;
  kind: ChecklistKind;
  name: string;
  description: string;
};

export type ChecklistTemplateItem = {
  id: string;
  template_id: string;
  title: string;
  description: string;
  owner_role: string;
  sort_order: number;
};

export type EmployeeChecklist = {
  id: string;
  employee_id: string;
  kind: ChecklistKind;
  name: string;
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
};

export type EmployeeChecklistItem = {
  id: string;
  checklist_id: string;
  title: string;
  description: string;
  owner_role: string;
  sort_order: number;
  done: boolean;
  done_at: string | null;
  notes: string;
};

export type SalaryStructure = {
  id: string;
  employee_id: string;
  effective_from: string;
  currency: string;
  annual_ctc: number;
  monthly_basic: number;
  monthly_hra: number;
  monthly_allowances: number;
  monthly_deductions: number;
  tax_percent: number;
};

export type PayrollRun = {
  id: string;
  company_id: string;
  period_month: string;
  status: "draft" | "processed" | "paid";
  note: string;
  processed_at: string | null;
};

export type Payslip = {
  id: string;
  payroll_run_id: string | null;
  employee_id: string;
  period_month: string;
  currency: string;
  gross_pay: number;
  deductions: number;
  tax: number;
  net_pay: number;
  paid_days: number;
  loss_of_pay_days: number;
  status: "draft" | "processed" | "paid";
  hr_status: "pending" | "approved" | "rejected" | "cancelled";
  hr_note: string;
  hr_decided_at: string | null;
  finance_status: "pending" | "approved" | "rejected" | "cancelled";
  finance_note: string;
  finance_decided_at: string | null;
  paid_on: string | null;
  paid_amount: number;
  payment_reference: string;
};

export type JobOpening = {
  id: string;
  company_id: string;
  title: string;
  department: string;
  location: string;
  employment_type: string;
  openings: number;
  status: "open" | "on_hold" | "closed";
  description: string;
  hiring_manager_id: string | null;
  posted_on: string;
};

export type Candidate = {
  id: string;
  job_opening_id: string;
  full_name: string;
  email: string;
  phone: string;
  source: string;
  stage: "applied" | "screening" | "interview" | "offer" | "hired" | "rejected";
  rating: number;
  notes: string;
  applied_on: string;
};

export type Interview = {
  id: string;
  candidate_id: string;
  scheduled_at: string;
  round_name: string;
  interviewer: string;
  mode: string;
  outcome: string;
  feedback: string;
};

export type TrainingCourse = {
  id: string;
  company_id: string | null;
  title: string;
  provider: string;
  category: string;
  hours: number;
  mandatory: boolean;
  description: string;
};

export type TrainingEnrollment = {
  id: string;
  course_id: string;
  employee_id: string;
  status: "enrolled" | "in_progress" | "completed" | "dropped";
  progress: number;
  due_date: string | null;
  completed_on: string | null;
};

export type BenefitPlan = {
  id: string;
  company_id: string | null;
  name: string;
  category: string;
  provider: string;
  coverage: string;
  employee_cost: number;
  employer_cost: number;
  currency: string;
  description: string;
};

export type BenefitEnrollment = {
  id: string;
  plan_id: string;
  employee_id: string;
  status: "pending" | "active" | "ended";
  enrolled_on: string;
  ended_on: string | null;
  dependents: number;
  note: string;
};

export type ComplianceDocument = {
  id: string;
  company_id: string;
  employee_id: string | null;
  name: string;
  doc_type: string;
  reference: string;
  issued_on: string | null;
  expires_on: string | null;
  status: "valid" | "expiring" | "expired" | "missing";
  notes: string;
};

function useTable<T>(table: string, orderBy?: string, ascending = true) {
  return useQuery({
    queryKey: [table],
    queryFn: async () => {
      return fetchAll<T>(() => {
        let q = supabase.from(table as never).select("*");
        if (orderBy) q = q.order(orderBy as never, { ascending });
        return q.order("id" as never);
      });
    },
  });
}

export const useChecklistTemplates = () => useTable<ChecklistTemplate>("checklist_templates", "name");
export const useChecklistTemplateItems = () =>
  useTable<ChecklistTemplateItem>("checklist_template_items", "sort_order");
export const useEmployeeChecklists = () =>
  useTable<EmployeeChecklist>("employee_checklists", "created_at", false);
export const useEmployeeChecklistItems = () =>
  useTable<EmployeeChecklistItem>("employee_checklist_items", "sort_order");
export const useSalaryStructures = () =>
  useTable<SalaryStructure>("salary_structures", "effective_from", false);
export const usePayrollRuns = () => useTable<PayrollRun>("payroll_runs", "period_month", false);
export const usePayslips = () => useTable<Payslip>("payslips", "period_month", false);
export const useJobOpenings = () => useTable<JobOpening>("job_openings", "posted_on", false);
export const useCandidates = () => useTable<Candidate>("candidates", "applied_on", false);
export const useInterviews = () => useTable<Interview>("interviews", "scheduled_at", false);
export const useTrainingCourses = () => useTable<TrainingCourse>("training_courses", "title");
export const useTrainingEnrollments = () => useTable<TrainingEnrollment>("training_enrollments");
export const useBenefitPlans = () => useTable<BenefitPlan>("benefit_plans", "name");
export const useBenefitEnrollments = () => useTable<BenefitEnrollment>("benefit_enrollments");
export const useComplianceDocuments = () =>
  useTable<ComplianceDocument>("compliance_documents", "expires_on");

export type ExpenseStatus = "draft" | "submitted" | "approved" | "rejected" | "reimbursed";

export type ExpenseClaim = {
  id: string;
  employee_id: string;
  company_id: string;
  title: string;
  purpose: string;
  destination: string;
  trip_start: string | null;
  trip_end: string | null;
  currency: string;
  total_amount: number;
  status: ExpenseStatus;
  submitted_at: string | null;
  finance_note: string;
  finance_decided_at: string | null;
  reimbursed_on: string | null;
  reimbursed_amount: number;
  payment_reference: string;
  source: string;
  notified_at: string | null;
  created_at: string;
};

export type ExpenseReceipt = {
  id: string;
  claim_id: string;
  category: string;
  merchant: string;
  spent_on: string | null;
  amount: number;
  note: string;
  file_path: string;
  file_name: string;
  file_type: string;
  created_at: string;
};

export const EXPENSE_CATEGORIES = [
  "Airfare",
  "Train / bus",
  "Local travel",
  "Hotel",
  "Meals",
  "Client entertainment",
  "Visa / permits",
  "Other",
] as const;

export const useExpenseClaims = () => useTable<ExpenseClaim>("expense_claims", "created_at", false);
export const useExpenseReceipts = () =>
  useTable<ExpenseReceipt>("expense_receipts", "created_at", false);

/** Short-lived link to a receipt in the private receipts store. */
export async function receiptUrl(path: string) {
  const { data, error } = await supabase.storage
    .from("expense-receipts")
    .createSignedUrl(path, 60 * 30);
  if (error) throw error;
  return data.signedUrl;
}

export type SeparationStage =
  | "submitted"
  | "manager_review"
  | "hr_review"
  | "it_clearance"
  | "finance_settlement"
  | "completed"
  | "withdrawn"
  | "rejected";

export type SeparationRequest = {
  id: string;
  employee_id: string;
  reason: string;
  resignation_type: string;
  notice_date: string;
  requested_last_day: string;
  approved_last_day: string | null;
  notice_days: number;
  stage: SeparationStage;
  hr_status: "pending" | "approved" | "rejected" | "cancelled";
  hr_note: string;
  hr_decided_at: string | null;
  exit_interview_done: boolean;
  manager_status: "pending" | "approved" | "rejected" | "cancelled";
  manager_note: string;
  manager_decided_at: string | null;
  handover_to: string | null;
  it_status: "pending" | "approved" | "rejected" | "cancelled";
  it_note: string;
  it_assets: string;
  it_decided_at: string | null;
  finance_status: "pending" | "approved" | "rejected" | "cancelled";
  finance_note: string;
  settlement_amount: number;
  settlement_paid_on: string | null;
  finance_decided_at: string | null;
  final_salary_amount: number;
  leave_encashment_days: number;
  leave_encashment_amount: number;
  unpaid_leave_days: number;
  unpaid_leave_amount: number;
  expense_reimbursement_amount: number;
  finance_routed_at: string | null;
  created_at: string;
};

export const useSeparationRequests = () =>
  useTable<SeparationRequest>("separation_requests", "created_at", false);

export const SEPARATION_STAGE_LABEL: Record<SeparationStage, string> = {
  submitted: "With the manager",
  manager_review: "With the manager",
  hr_review: "Awaiting HR",
  it_clearance: "With IT",
  finance_settlement: "With Finance",
  completed: "Settled",
  withdrawn: "Withdrawn",
  rejected: "Declined",
};

export function money(value: number, currency = "INR") {

  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

export function monthLabel(value: string) {
  return new Date(value + (value.length === 7 ? "-01" : "") + "T00:00:00").toLocaleDateString(
    undefined,
    { month: "short", year: "numeric" },
  );
}

export function firstOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

/** Gross / deductions / tax / net for one month from a salary structure. */
export function computePay(s: SalaryStructure, lopDays = 0, monthDays = 30) {
  const gross = Number(s.monthly_basic) + Number(s.monthly_hra) + Number(s.monthly_allowances);
  const factor = Math.max(0, (monthDays - lopDays) / monthDays);
  const grossPaid = gross * factor;
  const deductions = Number(s.monthly_deductions) * factor;
  const tax = ((grossPaid - deductions) * Number(s.tax_percent)) / 100;
  return {
    gross: Math.round(grossPaid),
    deductions: Math.round(deductions),
    tax: Math.round(tax),
    net: Math.round(grossPaid - deductions - tax),
  };
}

/** Pay rules a legal entity applies to its own people. */
export type EntityPaySettings = {
  id: string;
  company_id: string;
  currency: string;
  basic_percent: number;
  hra_percent: number;
  allowance_percent: number;
  pf_percent: number;
  professional_tax: number;
  insurance_monthly: number;
  other_deduction: number;
  tax_percent: number;
  working_days_per_month: number;
  notice_period_days: number;
  encash_leave_on_exit: boolean;
  notes: string;
};

export const useEntityPaySettings = () =>
  useTable<EntityPaySettings>("entity_pay_settings", "company_id");

export const DEFAULT_PAY_SETTINGS: Omit<EntityPaySettings, "id" | "company_id"> = {
  currency: "INR",
  basic_percent: 50,
  hra_percent: 20,
  allowance_percent: 30,
  pf_percent: 12,
  professional_tax: 200,
  insurance_monthly: 0,
  other_deduction: 0,
  tax_percent: 10,
  working_days_per_month: 22,
  notice_period_days: 60,
  encash_leave_on_exit: true,
  notes: "",
};

/** Monthly salary split and deductions an entity's rules produce from an annual package. */
export function applyPaySettings(annualCtc: number, s: Omit<EntityPaySettings, "id" | "company_id">) {
  const monthly = (Number(annualCtc) || 0) / 12;
  const basic = Math.round((monthly * Number(s.basic_percent)) / 100);
  const hra = Math.round((monthly * Number(s.hra_percent)) / 100);
  const allowances = Math.round((monthly * Number(s.allowance_percent)) / 100);
  const pf = Math.round((basic * Number(s.pf_percent)) / 100);
  const deductions =
    pf + Number(s.professional_tax) + Number(s.insurance_monthly) + Number(s.other_deduction);
  const gross = basic + hra + allowances;
  const tax = Math.round(((gross - deductions) * Number(s.tax_percent)) / 100);
  return {
    monthlyBasic: basic,
    monthlyHra: hra,
    monthlyAllowances: allowances,
    pf,
    monthlyDeductions: Math.round(deductions),
    gross,
    tax,
    net: gross - Math.round(deductions) - tax,
  };
}

export type ExitSettlement = {
  monthlyGross: number;
  dailyRate: number;
  finalSalary: number;
  unpaidDays: number;
  unpaidAmount: number;
  encashDays: number;
  encashAmount: number;
  expenses: number;
  net: number;
};

/**
 * What finance owes (or recovers) when someone leaves: pro-rata last-month pay,
 * unused leave encashed, unpaid leave recovered and approved expenses still due.
 */
export function computeExitSettlement(args: {
  salary: SalaryStructure | undefined;
  settings: Omit<EntityPaySettings, "id" | "company_id">;
  balances: { entitled_days: number; used_days: number }[];
  expenses: number;
  lastDay: string;
}): ExitSettlement {
  const { salary, settings, balances, expenses, lastDay } = args;
  const monthlyGross = salary
    ? Number(salary.monthly_basic) + Number(salary.monthly_hra) + Number(salary.monthly_allowances)
    : 0;
  const workDays = Math.max(1, Number(settings.working_days_per_month) || 22);
  const dailyRate = Math.round(monthlyGross / workDays);

  const d = new Date(lastDay + "T00:00:00");
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const finalSalary = Math.round((monthlyGross * d.getDate()) / (daysInMonth || 30));

  let unpaidDays = 0;
  let unusedDays = 0;
  for (const b of balances) {
    const diff = Number(b.entitled_days) - Number(b.used_days);
    if (diff < 0) unpaidDays += -diff;
    else unusedDays += diff;
  }
  const encashDays = settings.encash_leave_on_exit ? unusedDays : 0;
  const unpaidAmount = Math.round(unpaidDays * dailyRate);
  const encashAmount = Math.round(encashDays * dailyRate);

  return {
    monthlyGross,
    dailyRate,
    finalSalary,
    unpaidDays,
    unpaidAmount,
    encashDays,
    encashAmount,
    expenses: Math.round(expenses),
    net: Math.round(finalSalary + encashAmount + expenses - unpaidAmount),
  };
}

// ===================== Assets issued to people =====================

export type AssetCategory =
  | "hardware"
  | "accessory"
  | "software_license"
  | "subscription"
  | "other";

export type AssetState = "assigned" | "returned" | "lost" | "damaged" | "retired";

export type EmployeeAsset = {
  id: string;
  employee_id: string;
  company_id: string;
  category: AssetCategory;
  asset_type: string;
  name: string;
  make_model: string;
  serial_number: string;
  asset_tag: string;
  vendor: string;
  license_key: string;
  quantity: number;
  assigned_on: string;
  return_due: string | null;
  returned_on: string | null;
  status: AssetState;
  cost: number;
  currency: string;
  renewal_date: string | null;
  notes: string;
  created_at: string;
};

export const ASSET_CATEGORY_LABEL: Record<AssetCategory, string> = {
  hardware: "Hardware",
  accessory: "Accessory",
  software_license: "Software licence",
  subscription: "Subscription",
  other: "Other",
};

export const ASSET_STATE_LABEL: Record<AssetState, string> = {
  assigned: "With the employee",
  returned: "Returned",
  lost: "Lost",
  damaged: "Damaged",
  retired: "Retired",
};

export const ASSET_TYPE_SUGGESTIONS = [
  "Laptop",
  "Desktop",
  "Monitor",
  "Mouse",
  "Keyboard",
  "Headset",
  "Docking station",
  "Mobile phone",
  "SIM card",
  "Access card",
  "Printer",
  "Software licence",
  "Cloud subscription",
];

export const useEmployeeAssets = () => useTable<EmployeeAsset>("employee_assets", "created_at", false);

/** HR for the entity, Master HR, or anyone holding an asset / finance duty there. */
export function canManageAssets(me: Me | null | undefined, companyId: string) {
  if (!me) return false;
  if (me.isMaster) return true;
  return (
    me.hrCompanyIds.includes(companyId) ||
    me.hrCompanyId === companyId ||
    me.assetCompanyIds.includes(companyId) ||
    me.expenseCompanyIds.includes(companyId) ||
    me.payrollCompanyIds.includes(companyId)
  );
}

/* ---------------------------------------------------------------- Managers */

/** The people who report directly to the signed-in person. */
export function useMyDirectReports() {
  const { data: me } = useMe();
  const managerId = me?.employee?.id;
  return useQuery({
    queryKey: ["my_direct_reports", managerId],
    enabled: !!managerId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("*")
        .eq("manager_id", managerId!)
        .neq("status", "offboarded")
        .order("full_name");
      if (error) throw error;
      return (data ?? []) as Employee[];
    },
  });
}

/** True when the signed-in person has at least one direct report. */
export function useAmIManager() {
  const { data: org } = useMyOrg();
  return (org?.reports.length ?? 0) > 0;
}

/* ------------------------------------------------- Org chart (skip / exec) */

export type OrgNode = {
  person: Employee;
  depth: number;
  children: OrgNode[];
  /** Everyone below this person, at any depth. */
  total: number;
};

export type LeadershipLevel = "executive" | "skip" | "manager" | "individual";

export const LEVEL_LABEL: Record<LeadershipLevel, string> = {
  executive: "Executive",
  skip: "Skip-level manager",
  manager: "Manager",
  individual: "Team member",
};

/**
 * Everyone the signed-in person can see in their own reporting line.
 * Managers see their reports, skip-level managers see the layer below that,
 * executives (nobody above them) see their whole branch.
 */
export function useMyOrg() {
  const { data: me } = useMe();
  const rootId = me?.employee?.id;
  return useQuery({
    queryKey: ["my_org", rootId],
    enabled: !!rootId,
    staleTime: 60_000,
    queryFn: async () => {
      const all: Employee[] = [];
      for (let from = 0; from < 20000; from += 1000) {
        const { data, error } = await supabase
          .from("employees")
          .select("*")
          .neq("status", "offboarded")
          .order("full_name")
          .order("id")
          .range(from, from + 999);
        if (error) throw error;
        all.push(...((data ?? []) as Employee[]));
        if (!data || data.length < 1000) break;
      }
      const byManager = new Map<string, Employee[]>();
      for (const e of all) {
        if (!e.manager_id) continue;
        const list = byManager.get(e.manager_id) ?? [];
        list.push(e);
        byManager.set(e.manager_id, list);
      }
      const self = all.find((e) => e.id === rootId) ?? null;
      const seen = new Set<string>([rootId!]);
      const build = (id: string, depth: number): OrgNode[] =>
        (byManager.get(id) ?? [])
          .filter((c) => !seen.has(c.id) && (seen.add(c.id), true))
          .map((c) => {
            const children = depth < 10 ? build(c.id, depth + 1) : [];
            return {
              person: c,
              depth,
              children,
              total: children.reduce((n, k) => n + k.total + 1, 0),
            };
          });
      const tree = build(rootId!, 1);
      const flat: OrgNode[] = [];
      const walk = (nodes: OrgNode[]) => {
        for (const n of nodes) {
          flat.push(n);
          walk(n.children);
        }
      };
      walk(tree);
      const reports = tree.map((n) => n.person);
      const hasGrandChildren = tree.some((n) => n.children.length > 0);
      const level: LeadershipLevel = !self
        ? "individual"
        : reports.length === 0
          ? "individual"
          : !self.manager_id
            ? "executive"
            : hasGrandChildren
              ? "skip"
              : "manager";
      return {
        self,
        tree,
        flat,
        reports,
        everyone: flat.map((n) => n.person),
        level,
      };
    },
  });
}
