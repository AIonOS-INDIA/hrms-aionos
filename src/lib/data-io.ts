import { supabase } from "@/integrations/supabase/client";

export type RefKind = "company" | "employee" | "leave_type" | "job" | "course" | "plan";
export type FieldKind = "text" | "number" | "boolean" | "date" | "month" | "datetime";

export type Field = {
  header: string;
  column: string;
  kind?: FieldKind;
  ref?: RefKind;
  required?: boolean;
  /** default applied on import when the cell is empty */
  fallback?: string | number | boolean | null;
};

export type Spec = {
  key: string;
  label: string;
  table: string;
  hint: string;
  /** headers used to decide update vs insert */
  match: string[];
  fields: Field[];
  /** extra resolution after the plain field mapping (returns false to skip the row) */
  resolve?: (raw: Row, out: Record<string, unknown>, ctx: Ctx) => boolean;
  /** extra values written when exporting */
  decorate?: (dbRow: Record<string, unknown>, out: Row, ctx: Ctx) => void;
};

export type Row = Record<string, string | number | boolean | null>;

export type Ctx = {
  companies: { id: string; code: string; name: string }[];
  employees: { id: string; email: string; full_name: string; company_id: string; manager_id: string | null }[];
  leaveTypes: { id: string; code: string }[];
  jobs: { id: string; title: string }[];
  courses: { id: string; title: string }[];
  plans: { id: string; name: string }[];
  timesheets: { id: string; employee_id: string; week_start: string }[];
  assets: { employee_id: string; name: string; asset_type: string; serial_number: string; status: string }[];
};

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();

export async function loadCtx(): Promise<Ctx> {
  const pick = async (table: string, cols: string) => {
    const { data, error } = await supabase.from(table as never).select(cols).range(0, 9999);
    if (error) throw error;
    return (data ?? []) as unknown as Record<string, string>[];
  };
  const [companies, employees, leaveTypes, jobs, courses, plans, timesheets, assets] = await Promise.all([
    pick("companies", "id,code,name"),
    pick("employees", "id,email,full_name,company_id,manager_id"),
    pick("leave_types", "id,code"),
    pick("job_openings", "id,title"),
    pick("training_courses", "id,title"),
    pick("benefit_plans", "id,name"),
    pick("timesheets", "id,employee_id,week_start"),
    pick("employee_assets", "employee_id,name,asset_type,serial_number,status"),
  ]);
  return {
    companies: companies as Ctx["companies"],
    employees: employees as unknown as Ctx["employees"],
    leaveTypes: leaveTypes as Ctx["leaveTypes"],
    jobs: jobs as Ctx["jobs"],
    courses: courses as Ctx["courses"],
    plans: plans as Ctx["plans"],
    timesheets: timesheets as unknown as Ctx["timesheets"],
    assets: assets as unknown as Ctx["assets"],
  };
}

function refLabel(ctx: Ctx, ref: RefKind, id: unknown): string {
  if (!id) return "";
  switch (ref) {
    case "company":
      return ctx.companies.find((c) => c.id === id)?.code ?? "";
    case "employee":
      return ctx.employees.find((e) => e.id === id)?.email ?? "";
    case "leave_type":
      return ctx.leaveTypes.find((l) => l.id === id)?.code ?? "";
    case "job":
      return ctx.jobs.find((j) => j.id === id)?.title ?? "";
    case "course":
      return ctx.courses.find((c) => c.id === id)?.title ?? "";
    case "plan":
      return ctx.plans.find((p) => p.id === id)?.name ?? "";
  }
}

function refId(ctx: Ctx, ref: RefKind, label: unknown): string | null {
  const v = norm(label);
  if (!v) return null;
  switch (ref) {
    case "company":
      return (
        ctx.companies.find((c) => norm(c.code) === v || norm(c.name) === v)?.id ?? null
      );
    case "employee":
      return ctx.employees.find((e) => norm(e.email) === v)?.id ?? null;
    case "leave_type":
      return ctx.leaveTypes.find((l) => norm(l.code) === v)?.id ?? null;
    case "job":
      return ctx.jobs.find((j) => norm(j.title) === v)?.id ?? null;
    case "course":
      return ctx.courses.find((c) => norm(c.title) === v)?.id ?? null;
    case "plan":
      return ctx.plans.find((p) => norm(p.name) === v)?.id ?? null;
  }
}

function toCell(value: unknown, kind: FieldKind = "text"): string | number | boolean | null {
  if (value === null || value === undefined) return "";
  if (kind === "number") return Number(value);
  if (kind === "boolean") return Boolean(value);
  if (kind === "month") return String(value).slice(0, 7);
  return String(value);
}

function parseDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function parseCell(value: unknown, kind: FieldKind = "text"): unknown {
  if (value === undefined || value === null || value === "") return null;
  switch (kind) {
    case "number": {
      const n = Number(String(value).replace(/[, ]/g, ""));
      return Number.isNaN(n) ? null : n;
    }
    case "boolean": {
      const s = norm(value);
      return ["true", "yes", "y", "1"].includes(s);
    }
    case "date":
    case "month":
      return parseDate(value);
    case "datetime": {
      const d = new Date(String(value));
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
    default:
      return String(value).trim();
  }
}

const f = (header: string, column: string, extra: Partial<Field> = {}): Field => ({
  header,
  column,
  ...extra,
});

export const SPECS: Spec[] = [
  {
    key: "entity_field_values",
    label: "Master data",
    table: "entity_field_values",
    hint: "Dropdown lists per entity. Field: legal_entity, country, job_title, band, department, business_unit, location, office_city, office_area. Entity is the company short code, for example AIONOS.",
    match: ["Entity", "Field", "Value"],
    fields: [
      f("Entity", "company_id", { ref: "company", required: true }),
      f("Field", "field", { required: true }),
      f("Value", "value", { required: true }),
      f("Active", "active", { kind: "boolean", fallback: true }),
      f("Sort order", "sort_order", { kind: "number", fallback: 0 }),
    ],
  },
  {
    key: "employees",
    label: "Employees",
    table: "employees",
    hint: "Import this first — everyone else links to people by email. Gender: Male / Female. Employee Type: Full Time, Part Time, Consultant, Intern. Employment Status: Active / Inactive. Manager Name must match another person's Full Name — run the same file twice so every manager is linked. Assigned Assets is a read-only summary — load assets from the Assets sheet.",
    match: ["Email Id"],
    fields: [
      f("Employee Id", "employee_code"),
      f("Full Name", "full_name", { required: true }),
      f("Gender", "gender"),
      f("Date Of Birth", "date_of_birth", { kind: "date" }),
      f("Employee Type", "employment_type", { fallback: "Full Time" }),
      f("Employment Status", "status", { fallback: "Active" }),
      f("Email Id", "email", { required: true }),
      f("Designation", "job_title", { fallback: "" }),
      f("Department", "department", { fallback: "" }),
      f("Band", "band", { fallback: "" }),
      f("Legal Entity", "legal_entity", { fallback: "" }),
      f("Office Area", "office_area", { fallback: "" }),
      f("Manager Name", "manager_id"),
      f("Date Of Joining", "joined_on", { kind: "date" }),
      f("Date Of Exit", "exit_on", { kind: "date" }),
      f("Office Location", "location", { fallback: "" }),
      f("Office City", "office_city", { fallback: "" }),
      f("Business Unit", "business_unit", { fallback: "" }),
      f("Phone Number", "phone", { fallback: "" }),
      f("Home Address", "home_address", { fallback: "" }),
      f("Hired From", "hired_from", { fallback: "" }),
    ],
    resolve: (raw, out, ctx) => {
      const g = norm(raw["Gender"]);
      out["gender"] = g.startsWith("m") ? "male" : g.startsWith("f") ? "female" : "undisclosed";

      const t = norm(raw["Employee Type"]).replace(/[\s_-]/g, "");
      out["employment_type"] = t.startsWith("part")
        ? "part_time"
        : t.startsWith("consult")
          ? "consultant"
          : t.startsWith("intern")
            ? "intern"
            : "full_time";

      const s = norm(raw["Employment Status"]).replace(/[\s-]/g, "_");
      out["status"] = ["onboarding", "active", "on_leave", "offboarded"].includes(s)
        ? s
        : s === "inactive"
          ? "offboarded"
          : "active";

      const entity = norm(raw["Legal Entity"]);
      const match =
        ctx.companies.find((c) => entity && (entity.includes(norm(c.name)) || norm(c.name).includes(entity))) ??
        ctx.companies.find((c) => norm(c.code) === entity) ??
        ctx.companies.find((c) => norm(c.code) === "aionos");
      if (!match) return false;
      out["company_id"] = match.id;

      const mgr = norm(raw["Manager Name"]);
      const found = mgr ? ctx.employees.find((e) => norm(e.full_name) === mgr) : null;
      if (found && norm(found.email) !== norm(raw["Email Id"])) out["manager_id"] = found.id;
      else delete out["manager_id"];

      if (!out["joined_on"]) out["joined_on"] = new Date().toISOString().slice(0, 10);
      if (!String(raw["Employee Id"] ?? "").trim()) delete out["employee_code"];
      return true;
    },
    decorate: (dbRow, out, ctx) => {
      const mgr = ctx.employees.find((e) => e.id === dbRow["manager_id"]);
      out["Manager Name"] = mgr?.full_name ?? "";
      out["Assigned Assets"] = ctx.assets
        .filter((a) => a.employee_id === dbRow["id"] && a.status === "assigned")
        .map((a) =>
          [a.asset_type, a.name, a.serial_number].filter(Boolean).join(" ").trim(),
        )
        .join("; ");
    },
  },

  {
    key: "salary_structures",
    label: "Salary structures",
    table: "salary_structures",
    hint: "One current salary row per person.",
    match: ["Employee email", "Effective from"],
    fields: [
      f("Employee email", "employee_id", { ref: "employee", required: true }),
      f("Effective from", "effective_from", { kind: "date" }),
      f("Currency", "currency", { fallback: "INR" }),
      f("Annual package", "annual_ctc", { kind: "number", fallback: 0 }),
      f("Monthly basic", "monthly_basic", { kind: "number", fallback: 0 }),
      f("Monthly house rent", "monthly_hra", { kind: "number", fallback: 0 }),
      f("Monthly allowances", "monthly_allowances", { kind: "number", fallback: 0 }),
      f("Monthly deductions", "monthly_deductions", { kind: "number", fallback: 0 }),
      f("Tax percent", "tax_percent", { kind: "number", fallback: 0 }),
    ],
  },
  {
    key: "employee_assets",
    label: "Assets",
    table: "employee_assets",
    hint: "Laptops, accessories, software licences and subscriptions issued to each person. Category: Hardware, Accessory, Software licence, Subscription, Other. Status: Assigned, Returned, Lost, Damaged, Retired.",
    match: ["Employee email", "Item", "Serial number"],
    fields: [
      f("Employee email", "employee_id", { ref: "employee", required: true }),
      f("Category", "category", { fallback: "hardware" }),
      f("Item type", "asset_type", { fallback: "" }),
      f("Item", "name", { required: true }),
      f("Make and model", "make_model", { fallback: "" }),
      f("Serial number", "serial_number", { fallback: "" }),
      f("Asset tag", "asset_tag", { fallback: "" }),
      f("Vendor", "vendor", { fallback: "" }),
      f("Licence key", "license_key", { fallback: "" }),
      f("Quantity", "quantity", { kind: "number", fallback: 1 }),
      f("Issued on", "assigned_on", { kind: "date" }),
      f("Return due", "return_due", { kind: "date" }),
      f("Returned on", "returned_on", { kind: "date" }),
      f("Status", "status", { fallback: "assigned" }),
      f("Cost", "cost", { kind: "number", fallback: 0 }),
      f("Currency", "currency", { fallback: "INR" }),
      f("Renewal date", "renewal_date", { kind: "date" }),
      f("Notes", "notes", { fallback: "" }),
    ],
    resolve: (raw, out, ctx) => {
      const emp = ctx.employees.find((e) => norm(e.email) === norm(raw["Employee email"]));
      if (!emp) return false;
      out["company_id"] = emp.company_id;

      const c = norm(raw["Category"]).replace(/[\s-]/g, "_");
      out["category"] = ["hardware", "accessory", "software_license", "subscription", "other"].includes(c)
        ? c
        : c.includes("licen")
          ? "software_license"
          : c.includes("subscri")
            ? "subscription"
            : c.includes("access")
              ? "accessory"
              : "hardware";

      const st = norm(raw["Status"]);
      out["status"] = ["assigned", "returned", "lost", "damaged", "retired"].includes(st)
        ? st
        : "assigned";

      if (!out["assigned_on"]) out["assigned_on"] = new Date().toISOString().slice(0, 10);
      return true;
    },
  },
  {
    key: "leave_balances",
    label: "Leave balances",
    table: "leave_balances",
    hint: "Entitled and used days per leave type, per year.",
    match: ["Employee email", "Leave code", "Year"],
    fields: [
      f("Employee email", "employee_id", { ref: "employee", required: true }),
      f("Leave code", "leave_type_id", { ref: "leave_type", required: true }),
      f("Year", "year", { kind: "number", fallback: new Date().getFullYear() }),
      f("Entitled days", "entitled_days", { kind: "number", fallback: 0 }),
      f("Used days", "used_days", { kind: "number", fallback: 0 }),
    ],
  },
  {
    key: "leave_requests",
    label: "Leave requests",
    table: "leave_requests",
    hint: "Historic and open leave applications.",
    match: ["Employee email", "Start date", "End date"],
    fields: [
      f("Employee email", "employee_id", { ref: "employee", required: true }),
      f("Leave code", "leave_type_id", { ref: "leave_type", required: true }),
      f("Start date", "start_date", { kind: "date" }),
      f("End date", "end_date", { kind: "date" }),
      f("Days", "days", { kind: "number", fallback: 1 }),
      f("Reason", "reason", { fallback: "" }),
      f("Status", "status", { fallback: "pending" }),
    ],
  },
  {
    key: "timesheets",
    label: "Timesheets",
    table: "timesheets",
    hint: "Weekly sheets. Import before timesheet lines.",
    match: ["Employee email", "Week start"],
    fields: [
      f("Employee email", "employee_id", { ref: "employee", required: true }),
      f("Week start", "week_start", { kind: "date" }),
      f("Status", "status", { fallback: "draft" }),
      f("Total hours", "total_hours", { kind: "number", fallback: 0 }),
      f("Note", "note", { fallback: "" }),
    ],
  },
  {
    key: "timesheet_entries",
    label: "Timesheet lines",
    table: "timesheet_entries",
    hint: "Daily hours. The matching weekly sheet must already exist.",
    match: ["Employee email", "Work date"],
    fields: [
      f("Work date", "work_date", { kind: "date" }),
      f("Hours", "hours", { kind: "number", fallback: 0 }),
      f("Project", "project", { fallback: "" }),
      f("Notes", "notes", { fallback: "" }),
    ],
    resolve: (raw, out, ctx) => {
      const empId = refId(ctx, "employee", raw["Employee email"]);
      const week = parseDate(raw["Week start"]);
      const sheet = ctx.timesheets.find(
        (t) => t.employee_id === empId && t.week_start === week,
      );
      if (!sheet) return false;
      out["timesheet_id"] = sheet.id;
      return true;
    },
    decorate: (dbRow, out, ctx) => {
      const sheet = ctx.timesheets.find((t) => t.id === dbRow["timesheet_id"]);
      out["Employee email"] = sheet
        ? (ctx.employees.find((e) => e.id === sheet.employee_id)?.email ?? "")
        : "";
      out["Week start"] = sheet?.week_start ?? "";
    },
  },
  {
    key: "payslips",
    label: "Payslips",
    table: "payslips",
    hint: "Monthly pay records per person.",
    match: ["Employee email", "Month"],
    fields: [
      f("Employee email", "employee_id", { ref: "employee", required: true }),
      f("Month", "period_month", { kind: "date" }),
      f("Currency", "currency", { fallback: "INR" }),
      f("Gross pay", "gross_pay", { kind: "number", fallback: 0 }),
      f("Deductions", "deductions", { kind: "number", fallback: 0 }),
      f("Tax", "tax", { kind: "number", fallback: 0 }),
      f("Net pay", "net_pay", { kind: "number", fallback: 0 }),
      f("Paid days", "paid_days", { kind: "number", fallback: 30 }),
      f("Loss of pay days", "loss_of_pay_days", { kind: "number", fallback: 0 }),
      f("Status", "status", { fallback: "processed" }),
    ],
  },
  {
    key: "job_openings",
    label: "Job openings",
    table: "job_openings",
    hint: "Open roles per company.",
    match: ["Title", "Company code"],
    fields: [
      f("Company code", "company_id", { ref: "company", required: true }),
      f("Title", "title", { required: true }),
      f("Department", "department", { fallback: "" }),
      f("Location", "location", { fallback: "" }),
      f("Employment type", "employment_type", { fallback: "full_time" }),
      f("Openings", "openings", { kind: "number", fallback: 1 }),
      f("Status", "status", { fallback: "open" }),
      f("Description", "description", { fallback: "" }),
      f("Posted on", "posted_on", { kind: "date" }),
    ],
  },
  {
    key: "candidates",
    label: "Candidates",
    table: "candidates",
    hint: "Applicants linked to a job opening title.",
    match: ["Email", "Job title"],
    fields: [
      f("Job title", "job_opening_id", { ref: "job", required: true }),
      f("Full name", "full_name", { required: true }),
      f("Email", "email", { required: true }),
      f("Phone", "phone", { fallback: "" }),
      f("Source", "source", { fallback: "" }),
      f("Stage", "stage", { fallback: "applied" }),
      f("Rating", "rating", { kind: "number", fallback: 0 }),
      f("Notes", "notes", { fallback: "" }),
      f("Applied on", "applied_on", { kind: "date" }),
    ],
  },
  {
    key: "training_courses",
    label: "Training courses",
    table: "training_courses",
    hint: "Course catalogue. Leave company code blank to share with everyone.",
    match: ["Title"],
    fields: [
      f("Company code", "company_id", { ref: "company" }),
      f("Title", "title", { required: true }),
      f("Provider", "provider", { fallback: "" }),
      f("Category", "category", { fallback: "" }),
      f("Hours", "hours", { kind: "number", fallback: 0 }),
      f("Mandatory", "mandatory", { kind: "boolean", fallback: false }),
      f("Description", "description", { fallback: "" }),
    ],
  },
  {
    key: "training_enrollments",
    label: "Training assignments",
    table: "training_enrollments",
    hint: "Who is doing which course.",
    match: ["Employee email", "Course title"],
    fields: [
      f("Employee email", "employee_id", { ref: "employee", required: true }),
      f("Course title", "course_id", { ref: "course", required: true }),
      f("Status", "status", { fallback: "enrolled" }),
      f("Progress", "progress", { kind: "number", fallback: 0 }),
      f("Due date", "due_date", { kind: "date" }),
      f("Completed on", "completed_on", { kind: "date" }),
    ],
  },
  {
    key: "benefit_plans",
    label: "Benefit plans",
    table: "benefit_plans",
    hint: "Insurance and wellbeing plans on offer.",
    match: ["Name"],
    fields: [
      f("Company code", "company_id", { ref: "company" }),
      f("Name", "name", { required: true }),
      f("Category", "category", { fallback: "" }),
      f("Provider", "provider", { fallback: "" }),
      f("Coverage", "coverage", { fallback: "" }),
      f("Employee cost", "employee_cost", { kind: "number", fallback: 0 }),
      f("Employer cost", "employer_cost", { kind: "number", fallback: 0 }),
      f("Currency", "currency", { fallback: "INR" }),
      f("Description", "description", { fallback: "" }),
    ],
  },
  {
    key: "benefit_enrollments",
    label: "Benefit enrolments",
    table: "benefit_enrollments",
    hint: "Who is covered by which plan.",
    match: ["Employee email", "Plan name"],
    fields: [
      f("Employee email", "employee_id", { ref: "employee", required: true }),
      f("Plan name", "plan_id", { ref: "plan", required: true }),
      f("Status", "status", { fallback: "active" }),
      f("Enrolled on", "enrolled_on", { kind: "date" }),
      f("Ended on", "ended_on", { kind: "date" }),
      f("Dependents", "dependents", { kind: "number", fallback: 0 }),
      f("Note", "note", { fallback: "" }),
    ],
  },
  {
    key: "compliance_documents",
    label: "Documents",
    table: "compliance_documents",
    hint: "Company and employee documents with expiry dates.",
    match: ["Name", "Reference"],
    fields: [
      f("Company code", "company_id", { ref: "company", required: true }),
      f("Employee email", "employee_id", { ref: "employee" }),
      f("Name", "name", { required: true }),
      f("Document type", "doc_type", { fallback: "" }),
      f("Reference", "reference", { fallback: "" }),
      f("Issued on", "issued_on", { kind: "date" }),
      f("Expires on", "expires_on", { kind: "date" }),
      f("Status", "status", { fallback: "valid" }),
      f("Notes", "notes", { fallback: "" }),
    ],
  },
  {
    key: "employee_goals",
    label: "Goals",
    table: "employee_goals",
    hint: "Individual goals and progress.",
    match: ["Employee email", "Title"],
    fields: [
      f("Employee email", "employee_id", { ref: "employee", required: true }),
      f("Title", "title", { required: true }),
      f("Details", "details", { fallback: "" }),
      f("Target date", "target_date", { kind: "date" }),
      f("Weight", "weight", { kind: "number", fallback: 1 }),
      f("Progress", "progress", { kind: "number", fallback: 0 }),
      f("Status", "status", { fallback: "active" }),
    ],
  },
  {
    key: "performance_reviews",
    label: "Performance reviews",
    table: "performance_reviews",
    hint: "Review outcomes per period.",
    match: ["Employee email", "Period"],
    fields: [
      f("Employee email", "employee_id", { ref: "employee", required: true }),
      f("Period", "period", { required: true }),
      f("Review date", "review_date", { kind: "date" }),
      f("Rating", "rating", { kind: "number", fallback: 0 }),
      f("Strengths", "strengths", { fallback: "" }),
      f("Improvements", "improvements", { fallback: "" }),
      f("Summary", "summary", { fallback: "" }),
      f("Status", "status", { fallback: "draft" }),
    ],
  },
  {
    key: "policies",
    label: "Policies",
    table: "policies",
    hint: "Shared handbook entries.",
    match: ["Title"],
    fields: [
      f("Title", "title", { required: true }),
      f("Category", "category", { fallback: "" }),
      f("Body", "body", { fallback: "" }),
      f("Effective from", "effective_from", { kind: "date" }),
    ],
  },
  {
    key: "holidays",
    label: "Holidays",
    table: "holidays",
    hint: "Holiday calendar by location.",
    match: ["Name", "Date"],
    fields: [
      f("Name", "name", { required: true }),
      f("Date", "holiday_date", { kind: "date" }),
      f("Location", "location", { fallback: "All" }),
    ],
  },
  {
    key: "leave_types",
    label: "Leave types",
    table: "leave_types",
    hint: "Leave codes and yearly entitlement.",
    match: ["Code"],
    fields: [
      f("Code", "code", { required: true }),
      f("Name", "name", { required: true }),
      f("Annual days", "annual_days", { kind: "number", fallback: 0 }),
      f("Carry forward days", "carry_forward_days", { kind: "number", fallback: 0 }),
      f("Description", "description", { fallback: "" }),
    ],
  },
];

export function specByKey(key: string) {
  return SPECS.find((s) => s.key === key);
}

export function templateRow(spec: Spec): Row {
  const row: Row = {};
  for (const field of spec.fields) row[field.header] = "";
  if (spec.key === "timesheet_entries") {
    return { "Employee email": "", "Week start": "", ...row };
  }
  return row;
}

export async function exportSpec(spec: Spec, ctx: Ctx): Promise<Row[]> {
  const { data, error } = await supabase.from(spec.table as never).select("*").range(0, 9999);
  if (error) throw error;
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((dbRow) => {
    const out: Row = {};
    if (spec.key === "timesheet_entries") {
      out["Employee email"] = "";
      out["Week start"] = "";
    }
    for (const field of spec.fields) {
      out[field.header] = field.ref
        ? refLabel(ctx, field.ref, dbRow[field.column])
        : toCell(dbRow[field.column], field.kind);
    }
    spec.decorate?.(dbRow, out, ctx);
    return out;
  });
}

export type ImportResult = {
  inserted: number;
  updated: number;
  skipped: { row: number; reason: string }[];
};

function keyOf(spec: Spec, row: Row) {
  return spec.match.map((h) => norm(row[h])).join("||");
}

export async function importSpec(spec: Spec, rows: Row[], ctx: Ctx): Promise<ImportResult> {
  const result: ImportResult = { inserted: 0, updated: 0, skipped: [] };
  if (!rows.length) return result;

  const { data: existingRaw, error: exErr } = await supabase
    .from(spec.table as never)
    .select("*")
    .range(0, 9999);
  if (exErr) throw exErr;
  const existing = (existingRaw ?? []) as unknown as Record<string, unknown>[];

  const existingByKey = new Map<string, string>();
  for (const dbRow of existing) {
    const mapped: Row = {};
    for (const field of spec.fields) {
      mapped[field.header] = field.ref
        ? refLabel(ctx, field.ref, dbRow[field.column])
        : toCell(dbRow[field.column], field.kind);
    }
    spec.decorate?.(dbRow, mapped, ctx);
    existingByKey.set(keyOf(spec, mapped), String(dbRow["id"]));
  }

  const managerFixes: { email: string; managerEmail: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i]!;
    const out: Record<string, unknown> = {};
    let failure = "";

    for (const field of spec.fields) {
      const cell = raw[field.header];
      if (field.ref) {
        if (spec.key === "employees" && field.column === "manager_id") continue;
        const id = refId(ctx, field.ref, cell);
        if (!id && field.required) {
          failure = `${field.header} "${String(cell ?? "")}" not found`;
          break;
        }
        out[field.column] = id;
        continue;
      }
      let value = parseCell(cell, field.kind);
      if (value === null && field.fallback !== undefined) value = field.fallback;
      if ((value === null || value === "") && field.required) {
        failure = `${field.header} is required`;
        break;
      }
      if (value !== null) out[field.column] = value;
    }

    if (!failure && spec.resolve && !spec.resolve(raw, out, ctx)) {
      failure = "no matching parent record found";
    }
    if (failure) {
      result.skipped.push({ row: i + 2, reason: failure });
      continue;
    }

    if (spec.key === "employees") {
      const managerEmail = String(raw["Manager email"] ?? "").trim();
      if (managerEmail) managerFixes.push({ email: String(raw["Email"]), managerEmail });
    }

    const id = existingByKey.get(keyOf(spec, raw));
    if (id) {
      const { error } = await supabase.from(spec.table as never).update(out as never).eq("id", id);
      if (error) result.skipped.push({ row: i + 2, reason: error.message });
      else result.updated++;
    } else {
      const { error } = await supabase.from(spec.table as never).insert(out as never);
      if (error) result.skipped.push({ row: i + 2, reason: error.message });
      else result.inserted++;
    }
  }

  if (spec.key === "employees" && managerFixes.length) {
    const { data } = await supabase.from("employees").select("id,email").range(0, 9999);
    const byEmail = new Map(
      ((data ?? []) as { id: string; email: string }[]).map((e) => [norm(e.email), e.id]),
    );
    for (const fix of managerFixes) {
      const empId = byEmail.get(norm(fix.email));
      const mgrId = byEmail.get(norm(fix.managerEmail));
      if (empId && mgrId && empId !== mgrId) {
        await supabase.from("employees").update({ manager_id: mgrId }).eq("id", empId);
      }
    }
  }

  return result;
}
