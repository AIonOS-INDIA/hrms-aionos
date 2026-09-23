import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useId, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, EntityTag, Panel, StatCard, StatusPill, useScope } from "@/components/AppShell";
import { AssetPanel } from "@/components/AssetPanel";
import {
  directReports,
  fmtDate,
  initials,
  reportingChain,
  useEmployees,
  useMe,
  usePicklists,
  useEntityFieldValues,
  masteredOptions,
  type MasterField,
  type Employee,
} from "@/lib/hrms";

export const Route = createFileRoute("/_authenticated/employees")({
  head: () => ({
    meta: [
      { title: "Employees — AIONOS HR Control Tower" },
      {
        name: "description",
        content: "Onboard, manage and offboard employees across the AIONOS group entities.",
      },
      { property: "og:title", content: "Employees — AIONOS HR Control Tower" },
      {
        property: "og:description",
        content: "Company-scoped employee roster, onboarding and offboarding.",
      },
    ],
  }),
  component: EmployeesPage,
});

function EmployeesPage() {
  const [openForm, setOpenForm] = useState(false);
  return (
    <AppShell
      title="Employees"
      subtitle="Onboarding · roster · offboarding"
      actions={
        <button
          onClick={() => setOpenForm((v) => !v)}
          className="h-9 px-3 rounded-md text-[13px] font-semibold cursor-pointer bg-brand text-paper hover:bg-brand-deep"
        >
          {openForm ? "Close" : "+ Onboard"}
        </button>
      }
    >
      <EmployeesBody openForm={openForm} closeForm={() => setOpenForm(false)} />
    </AppShell>
  );
}

function EmployeesBody({ openForm, closeForm }: { openForm: boolean; closeForm: () => void }) {
  const { data: me } = useMe();
  const { companyId, companies, companyById, canSeeAll } = useScope();
  const { data: employees = [] } = useEmployees();
  const [selected, setSelected] = useState<Employee | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<Employee["status"] | "headcount" | null>(null);
  const [editing, setEditing] = useState(false);
  const queryClient = useQueryClient();

  const isHr = !!me?.isMaster || !!me?.hrCompanyId;

  const rows = useMemo(() => {
    let base = companyId ? employees.filter((e) => e.company_id === companyId) : employees;
    if (statusFilter === "headcount") base = base.filter((e) => e.status !== "offboarded");
    else if (statusFilter) base = base.filter((e) => e.status === statusFilter);
    const q = search.trim().toLowerCase();
    return q
      ? base.filter(
          (e) =>
            e.full_name.toLowerCase().includes(q) ||
            e.email.toLowerCase().includes(q) ||
            e.job_title.toLowerCase().includes(q),
        )
      : base;
  }, [employees, companyId, search, statusFilter]);

  const PAGE_SIZE = 100;
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pagedRows = useMemo(
    () => rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [rows, currentPage],
  );
  useEffect(() => {
    setPage(1);
  }, [search, companyId, statusFilter]);

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: Employee["status"] }) => {
      const { error } = await supabase
        .from("employees")
        .update({
          status,
          exit_on: status === "offboarded" ? new Date().toISOString().slice(0, 10) : null,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Employee record updated");
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      setSelected(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const managerMutation = useMutation({
    mutationFn: async ({ id, managerId }: { id: string; managerId: string | null }) => {
      const { error } = await supabase
        .from("employees")
        .update({ manager_id: managerId })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      toast.success("Reporting line updated");
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      setSelected((prev) => (prev && prev.id === vars.id ? { ...prev, manager_id: vars.managerId } : prev));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!isHr) {
    return <p className="text-sm text-ink-soft">You do not have access to the employee roster.</p>;
  }

  const scopeRows = companyId ? employees.filter((e) => e.company_id === companyId) : employees;
  const count = (s: Employee["status"]) => scopeRows.filter((e) => e.status === s).length;
  const toggle = (k: Employee["status"] | "headcount") =>
    setStatusFilter((prev) => (prev === k ? null : k));

  return (
    <>
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Headcount"
          value={scopeRows.filter((e) => e.status !== "offboarded").length}
          hint={statusFilter === "headcount" ? "Filtering roster" : "Click to filter"}
          onClick={() => toggle("headcount")}
          active={statusFilter === "headcount"}
        />
        <StatCard
          label="Onboarding"
          value={count("onboarding")}
          hint={statusFilter === "onboarding" ? "Filtering roster" : "Not yet started"}
          onClick={() => toggle("onboarding")}
          active={statusFilter === "onboarding"}
        />
        <StatCard
          label="On leave"
          value={count("on_leave")}
          hint={statusFilter === "on_leave" ? "Filtering roster" : "Click to filter"}
          onClick={() => toggle("on_leave")}
          active={statusFilter === "on_leave"}
        />
        <StatCard
          label="Offboarded"
          value={count("offboarded")}
          hint={statusFilter === "offboarded" ? "Filtering roster" : "Historic records"}
          onClick={() => toggle("offboarded")}
          active={statusFilter === "offboarded"}
        />
      </section>

      {statusFilter && (
        <div className="mt-3 flex items-center gap-2">
          <span className="text-[12px] text-ink-soft">
            Showing{" "}
            <b className="text-ink">
              {statusFilter === "headcount" ? "current headcount" : statusFilter.replace("_", " ")}
            </b>{" "}
            · {rows.length} records
          </span>
          <button
            type="button"
            onClick={() => setStatusFilter(null)}
            className="h-7 px-3 rounded-full ring-1 ring-line text-[12px] cursor-pointer hover:bg-ink/5"
          >
            Clear filter ✕
          </button>
        </div>
      )}

      {openForm && <OnboardForm onDone={closeForm} />}

      <div className="mt-4 grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2">
          <Panel
            title={`Roster · ${rows.length} records`}
            meta={
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, email, role"
                className="h-7 w-52 px-2 rounded-md bg-paper ring-1 ring-line text-[12px] font-mono outline-none focus:ring-ink"
              />
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left label-mono border-b border-line">
                    <th className="px-4 py-2.5 font-medium">Employee</th>
                    {canSeeAll && <th className="px-4 py-2.5 font-medium">Entity</th>}
                    <th className="px-4 py-2.5 font-medium">Role</th>
                    <th className="px-4 py-2.5 font-medium">Reports to</th>
                    <th className="px-4 py-2.5 font-medium">Joined</th>
                    <th className="px-4 py-2.5 font-medium text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {pagedRows.map((e) => (
                    <tr
                      key={e.id}
                      onClick={() => {
                        setSelected(e);
                        setEditing(false);
                      }}
                      className="hover:bg-ink/[0.03] cursor-pointer"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="size-8 rounded-md bg-line grid place-items-center text-[10px] font-mono font-medium text-ink-soft shrink-0">
                            {initials(e.full_name)}
                          </div>
                          <div>
                            <p className="font-medium leading-tight">{e.full_name}</p>
                            <p className="text-[11px] font-mono text-ink-soft">{e.email}</p>
                          </div>
                        </div>
                      </td>
                      {canSeeAll && (
                        <td className="px-4 py-3">
                          <EntityTag company={companyById(e.company_id)} />
                        </td>
                      )}
                      <td className="px-4 py-3 text-ink-soft">{e.job_title}</td>
                      <td className="px-4 py-3 text-ink-soft text-[12px]">
                        {employees.find((m) => m.id === e.manager_id)?.full_name ?? "—"}
                      </td>
                      <td className="px-4 py-3 font-mono text-ink-soft text-[12px]">
                        {fmtDate(e.joined_on)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <StatusPill status={e.status} />
                      </td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-ink-soft text-center">
                        No employees match this scope.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {rows.length > PAGE_SIZE && (
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-line">
                <p className="text-[11px] font-mono text-ink-soft">
                  {(currentPage - 1) * PAGE_SIZE + 1}–
                  {Math.min(currentPage * PAGE_SIZE, rows.length)} of {rows.length}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={currentPage <= 1}
                    onClick={() => setPage(currentPage - 1)}
                    className="h-7 px-3 rounded-md ring-1 ring-line text-[12px] font-mono disabled:opacity-40 hover:bg-ink/[0.04]"
                  >
                    Prev
                  </button>
                  <span className="text-[11px] font-mono text-ink-soft">
                    Page {currentPage} / {pageCount}
                  </span>
                  <button
                    type="button"
                    disabled={currentPage >= pageCount}
                    onClick={() => setPage(currentPage + 1)}
                    className="h-7 px-3 rounded-md ring-1 ring-line text-[12px] font-mono disabled:opacity-40 hover:bg-ink/[0.04]"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </Panel>
        </div>

        <aside className="panelin">
          <Panel
            title="Employee detail"
            meta={
              selected ? (
                <div className="flex items-center gap-2">
                  {!editing && (
                    <button
                      onClick={() => setEditing(true)}
                      className="h-7 px-3 rounded-md bg-brand text-paper text-[12px] font-semibold cursor-pointer hover:bg-brand-deep"
                    >
                      Edit
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setSelected(null);
                      setEditing(false);
                    }}
                    className="text-[11px] font-mono text-ink-soft hover:text-ink cursor-pointer"
                  >
                    Close ✕
                  </button>
                </div>
              ) : undefined
            }
          >
            {!selected ? (
              <p className="p-4 text-[13px] text-ink-soft">
                Select a row to view and manage a record.
              </p>
            ) : editing ? (
              <EditEmployee
                employee={selected}
                employees={employees}
                canSeeAll={canSeeAll}
                companies={companies}
                onCancel={() => setEditing(false)}
                onSaved={(updated) => {
                  setSelected(updated);
                  setEditing(false);
                }}
              />
            ) : (
              <div className="p-4">
                <div className="flex items-center gap-3">
                  <div className="size-12 rounded-lg bg-brand grid place-items-center text-paper text-[12px] font-mono font-semibold shrink-0">
                    {initials(selected.full_name)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold leading-tight">{selected.full_name}</p>
                    <p className="text-[11px] font-mono text-ink-soft truncate">
                      {selected.email}
                    </p>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <Field label="Employee ID" value={selected.employee_code ?? "—"} />
                  <Field label="Gender" value={selected.gender ?? "—"} />
                  <Field label="Date of birth" value={selected.date_of_birth ? fmtDate(selected.date_of_birth) : "—"} />
                  <Field
                    label="Employment type"
                    value={(selected.employment_type ?? "full_time").replace("_", " ")}
                  />
                  <Field label="Designation" value={selected.job_title || "—"} />
                  <Field label="Band" value={selected.band || "—"} />
                  <Field
                    label="Legal entity"
                    value={selected.legal_entity || companyById(selected.company_id)?.name || "—"}
                  />
                  <Field label="Department" value={selected.department || "—"} />
                  <Field label="Business unit" value={selected.business_unit || "—"} />
                  <Field label="Office location" value={selected.location || "—"} />
                  <Field label="Office city" value={selected.office_city || "—"} />
                  <Field label="Current office area" value={selected.office_area || "—"} />
                  <Field label="Hired from" value={selected.hired_from || "—"} />
                  <Field label="Date of joining" value={fmtDate(selected.joined_on)} />
                  <Field label="Date of exit" value={selected.exit_on ? fmtDate(selected.exit_on) : "—"} />
                  <Field label="Phone number" value={selected.phone || "—"} />
                  <Field label="Home address" value={selected.home_address || "—"} />
                  <Field label="Access level" value={selected.access_level.replace("_", " ")} />
                  <Field label="Account" value={selected.user_id ? "Linked" : "Not signed up"} />
                </div>

                <div className="mt-4">
                  <Select
                    label="Reports to"
                    value={selected.manager_id ?? ""}
                    onChange={(v) =>
                      managerMutation.mutate({ id: selected.id, managerId: v || null })
                    }
                    options={[
                      { value: "", label: "No manager (top of chain)" },
                      ...employees
                        .filter(
                          (m) =>
                            m.id !== selected.id &&
                            m.company_id === selected.company_id &&
                            m.status !== "offboarded",
                        )
                        .map((m) => ({ value: m.id, label: `${m.full_name} · ${m.job_title}` })),
                    ]}
                  />
                </div>

                <HierarchyTrail employees={employees} employee={selected} />

                <div className="mt-4 space-y-2">
                  <p className="label-mono">Lifecycle</p>
                  <div className="flex flex-wrap gap-2">
                    {(["onboarding", "active", "on_leave", "offboarded"] as const).map((s) => (
                      <button
                        key={s}
                        disabled={statusMutation.isPending || selected.status === s}
                        onClick={() => statusMutation.mutate({ id: selected.id, status: s })}
                        className={`h-8 px-3 rounded-md text-[12px] font-medium cursor-pointer ring-1 ring-line disabled:opacity-40 ${
                          selected.status === s ? "bg-brand text-paper" : "hover:bg-ink/5"
                        }`}
                      >
                        {s.replace("_", " ")}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </Panel>

          {selected && (
            <div className="mt-4">
              <AssetPanel employee={selected} compact />
            </div>
          )}



          <div className="mt-4 rounded-[14px] bg-brand text-paper p-4">
            <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-paper/50">
              Scope in force
            </p>
            <p className="text-[13px] mt-2">
              {canSeeAll
                ? companyId
                  ? `Filtered to ${companyById(companyId)?.name}. As Master HR you can switch entities in the left rail.`
                  : "All four entities. Only Master HR sees this combined view."
                : `You can only manage ${companies.find((c) => c.id === companyId)?.name ?? "your company"}.`}
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}

function HierarchyTrail({
  employees,
  employee,
}: {
  employees: Employee[];
  employee: Employee;
}) {
  const chain = reportingChain(employees, employee.id);
  const reports = directReports(employees, employee.id);
  const line = [employee, ...chain];

  return (
    <div className="mt-4">
      <p className="label-mono">Management hierarchy</p>
      <div className="mt-2 rounded-md bg-paper ring-1 ring-black/5 p-3 space-y-2">
        {line.map((p, i) => (
          <div key={p.id} className="flex items-start gap-2.5" style={{ paddingLeft: i * 10 }}>
            <span className="mt-1 text-[11px] font-mono text-ink-soft w-8 shrink-0">
              {i === 0 ? "L0" : `L${i}`}
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-medium leading-tight truncate">
                {p.full_name}
                {i === 0 ? " (this employee)" : ""}
              </p>
              <p className="text-[11px] font-mono text-ink-soft truncate">{p.job_title}</p>
            </div>
          </div>
        ))}
        {chain.length === 0 && (
          <p className="text-[11px] font-mono text-ink-soft">
            Top of the chain — no manager assigned.
          </p>
        )}
      </div>
      {reports.length > 0 && (
        <p className="text-[11px] font-mono text-ink-soft mt-2">
          Direct reports: {reports.map((r) => r.full_name).join(", ")}
        </p>
      )}
    </div>
  );
}

function EditEmployee({
  employee,
  employees,
  companies,
  canSeeAll,
  onCancel,
  onSaved,
}: {
  employee: Employee;
  employees: Employee[];
  companies: { id: string; name: string }[];
  canSeeAll: boolean;
  onCancel: () => void;
  onSaved: (e: Employee) => void;
}) {
  const queryClient = useQueryClient();
  const { data: masterRows = [] } = useEntityFieldValues();
  const [form, setForm] = useState({
    employee_code: employee.employee_code ?? "",
    full_name: employee.full_name,
    email: employee.email,
    gender: employee.gender ?? "",
    date_of_birth: employee.date_of_birth ?? "",
    employment_type: employee.employment_type ?? "full_time",
    status: employee.status,
    company_id: employee.company_id,
    job_title: employee.job_title ?? "",
    band: employee.band ?? "",
    department: employee.department ?? "",
    legal_entity: employee.legal_entity ?? "",
    business_unit: employee.business_unit ?? "",
    location: employee.location ?? "",
    office_city: employee.office_city ?? "",
    office_area: employee.office_area ?? "",
    hired_from: employee.hired_from ?? "",
    joined_on: employee.joined_on ?? "",
    exit_on: employee.exit_on ?? "",
    access_level: employee.access_level,
    manager_id: employee.manager_id ?? "",
    phone: employee.phone ?? "",
    home_address: employee.home_address ?? "",
  });
  const picklists = usePicklists(form.company_id);
  const enumOpts = (
    field: MasterField,
    all: { value: string; label: string }[],
  ): { value: string; label: string }[] => {
    const allowed = new Set(
      masteredOptions(masterRows, form.company_id, field).map((v) => v.toLowerCase()),
    );
    const kept = all.filter((o) => !o.value || allowed.has(o.value.toLowerCase()));
    return kept.length ? kept : all;
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!form.full_name.trim() || !form.email.trim())
        throw new Error("Name and email are required");
      const payload = {
        employee_code: form.employee_code.trim() || null,
        full_name: form.full_name.trim(),
        email: form.email.trim().toLowerCase(),
        gender: (form.gender || null) as "male" | "female" | "undisclosed" | null,
        date_of_birth: form.date_of_birth || null,
        employment_type: form.employment_type as "full_time" | "part_time" | "consultant" | "intern",
        status: form.status as Employee["status"],
        company_id: form.company_id,
        job_title: form.job_title.trim(),
        band: form.band.trim(),
        department: form.department.trim(),
        legal_entity: form.legal_entity.trim(),
        business_unit: form.business_unit.trim(),
        location: form.location.trim(),
        office_city: form.office_city.trim(),
        office_area: form.office_area.trim(),
        hired_from: form.hired_from.trim(),
        joined_on: form.joined_on || employee.joined_on,
        exit_on: form.exit_on || null,
        access_level: form.access_level as "employee" | "company_hr" | "master_hr",
        manager_id: form.manager_id || null,
        phone: form.phone.trim(),
        home_address: form.home_address.trim(),
      };
      const { data, error } = await supabase
        .from("employees")
        .update(payload)
        .eq("id", employee.id)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as Employee;
    },
    onSuccess: (updated) => {
      toast.success("Employee details saved");
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      onSaved(updated);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-4">
      <p className="label-mono">Edit employee record</p>
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input
          label="Employee ID"
          value={form.employee_code}
          onChange={(v) => setForm({ ...form, employee_code: v })}
        />
        <Input
          label="Full name"
          value={form.full_name}
          onChange={(v) => setForm({ ...form, full_name: v })}
        />
        <Input label="Email ID" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
        <Input
          label="Phone number"
          value={form.phone}
          onChange={(v) => setForm({ ...form, phone: v })}
        />
        <Input
          label="Home address"
          value={form.home_address}
          onChange={(v) => setForm({ ...form, home_address: v })}
        />
        <Select
          label="Gender"
          value={form.gender}
          onChange={(v) => setForm({ ...form, gender: v })}
          options={enumOpts("gender", [
            { value: "", label: "Not specified" },
            { value: "male", label: "Male" },
            { value: "female", label: "Female" },
            { value: "undisclosed", label: "Undisclosed" },
          ])}
        />
        <Input
          label="Date of birth"
          type="date"
          value={form.date_of_birth}
          onChange={(v) => setForm({ ...form, date_of_birth: v })}
        />
        <Select
          label="Employment type"
          value={form.employment_type}
          onChange={(v) =>
            setForm({ ...form, employment_type: v as "full_time" | "part_time" | "consultant" | "intern" })
          }
          options={enumOpts("employment_type", [
            { value: "full_time", label: "Full Time" },
            { value: "part_time", label: "Part Time" },
            { value: "consultant", label: "Consultant" },
            { value: "intern", label: "Intern" },
          ])}
        />
        <Select
          label="Employment status"
          value={form.status}
          onChange={(v) => setForm({ ...form, status: v as Employee["status"] })}
          options={enumOpts("employment_status", [
            { value: "onboarding", label: "Onboarding" },
            { value: "active", label: "Active" },
            { value: "on_leave", label: "On leave" },
            { value: "offboarded", label: "Offboarded" },
          ])}
        />
        <Select
          label="Legal company entity"
          value={form.company_id}
          disabled={!canSeeAll}
          onChange={(v) => setForm({ ...form, company_id: v })}
          options={companies.map((c) => ({ value: c.id, label: c.name }))}
        />
        <Combo
          label="Designation"
          value={form.job_title}
          onChange={(v) => setForm({ ...form, job_title: v })}
          options={picklists.job_title}
        />
        <Combo
          label="Band"
          value={form.band}
          onChange={(v) => setForm({ ...form, band: v })}
          options={picklists.band}
        />
        <Combo
          label="Department"
          value={form.department}
          onChange={(v) => setForm({ ...form, department: v })}
          options={picklists.department}
        />
        <Combo
          label="Business unit"
          value={form.business_unit}
          onChange={(v) => setForm({ ...form, business_unit: v })}
          options={picklists.business_unit}
        />
        <Combo
          label="Legal entity"
          value={form.legal_entity}
          onChange={(v) => setForm({ ...form, legal_entity: v })}
          options={picklists.legal_entity}
        />
        <Combo
          label="Office location"
          value={form.location}
          onChange={(v) => setForm({ ...form, location: v })}
          options={picklists.location}
        />
        <Combo
          label="Office city"
          value={form.office_city}
          onChange={(v) => setForm({ ...form, office_city: v })}
          options={picklists.office_city}
        />
        <Combo
          label="Current office area"
          value={form.office_area}
          onChange={(v) => setForm({ ...form, office_area: v })}
          options={picklists.office_area}
        />
        <Combo
          label="Hired from"
          value={form.hired_from}
          onChange={(v) => setForm({ ...form, hired_from: v })}
          options={picklists.hired_from}
          placeholder="Referral, job board, agency, campus…"
        />
        <Input
          label="Date of joining"
          type="date"
          value={form.joined_on}
          onChange={(v) => setForm({ ...form, joined_on: v })}
        />
        <Input
          label="Date of exit"
          type="date"
          value={form.exit_on}
          onChange={(v) => setForm({ ...form, exit_on: v })}
        />
        <Select
          label="Access level"
          value={form.access_level}
          onChange={(v) =>
            setForm({ ...form, access_level: v as "employee" | "company_hr" | "master_hr" })
          }
          options={[
            { value: "employee", label: "Employee" },
            { value: "company_hr", label: "Company HR" },
            { value: "master_hr", label: "Master HR" },
          ]}
        />
        <Select
          label="Reports to"
          value={form.manager_id}
          onChange={(v) => setForm({ ...form, manager_id: v })}
          options={[
            { value: "", label: "No manager (top of chain)" },
            ...employees
              .filter(
                (m) =>
                  m.id !== employee.id &&
                  m.company_id === form.company_id &&
                  m.status !== "offboarded",
              )
              .map((m) => ({ value: m.id, label: `${m.full_name} · ${m.job_title}` })),
          ]}
        />
      </div>
      <div className="mt-4 flex gap-2">
        <button
          disabled={save.isPending}
          onClick={() => save.mutate()}
          className="h-9 px-4 rounded-md bg-brand text-paper text-[13px] font-semibold cursor-pointer hover:bg-brand-deep disabled:opacity-50"
        >
          {save.isPending ? "Saving…" : "Save changes"}
        </button>
        <button
          onClick={onCancel}
          className="h-9 px-4 rounded-md ring-1 ring-line text-[13px] font-medium cursor-pointer hover:bg-ink/5"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-paper ring-1 ring-black/5 p-3">
      <p className="label-mono">{label}</p>
      <p className="text-[13px] font-medium mt-1 capitalize">{value}</p>
    </div>
  );
}

function OnboardForm({ onDone }: { onDone: () => void }) {
  const { companies, companyId, canSeeAll } = useScope();
  const queryClient = useQueryClient();
  const { data: masterRows = [] } = useEntityFieldValues();
  const [form, setForm] = useState({
    employee_code: "",
    full_name: "",
    localPart: "",
    gender: "",
    date_of_birth: "",
    employment_type: "full_time",
    company_id: companyId ?? companies[0]?.id ?? "",
    job_title: "",
    band: "",
    department: "",
    location: "",
    office_city: "",
    office_area: "",
    hired_from: "",
    legal_entity: "",
    business_unit: "",
    joined_on: new Date().toISOString().slice(0, 10),
    access_level: "employee",
    manager_id: "",
    phone: "",
    home_address: "",
  });

  const { data: employees = [] } = useEmployees();
  const company = companies.find((c) => c.id === form.company_id);
  const picklists = usePicklists(form.company_id);
  const enumOpts = (
    field: MasterField,
    all: { value: string; label: string }[],
  ): { value: string; label: string }[] => {
    const allowed = new Set(
      masteredOptions(masterRows, form.company_id, field).map((v) => v.toLowerCase()),
    );
    const kept = all.filter((o) => !o.value || allowed.has(o.value.toLowerCase()));
    return kept.length ? kept : all;
  };

  const create = useMutation({
    mutationFn: async () => {
      if (!form.full_name.trim() || !form.localPart.trim() || !company)
        throw new Error("Name, email and company are required");
      const { error } = await supabase.from("employees").insert({
        employee_code: form.employee_code.trim() || null,
        full_name: form.full_name.trim(),
        email: `${form.localPart.trim().toLowerCase()}@${company.email_domain}`,
        gender: (form.gender || null) as "male" | "female" | "undisclosed" | null,
        date_of_birth: form.date_of_birth || null,
        employment_type: form.employment_type as
          | "full_time"
          | "part_time"
          | "consultant"
          | "intern",
        company_id: form.company_id,
        job_title: form.job_title.trim() || "Associate",
        band: form.band.trim(),
        department: form.department,
        location: form.location,
        office_city: form.office_city.trim(),
        office_area: form.office_area.trim(),
        hired_from: form.hired_from.trim(),
        legal_entity: form.legal_entity.trim(),
        business_unit: form.business_unit.trim(),
        joined_on: form.joined_on,
        access_level: form.access_level as "employee" | "company_hr" | "master_hr",
        manager_id: form.manager_id || null,
        phone: form.phone.trim(),
        home_address: form.home_address.trim(),
        status: "onboarding",
      });
      if (error) throw error;
    },

    onSuccess: () => {
      toast.success("Employee onboarded");
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mt-4 bg-panel ring-1 ring-black/5 rounded-[14px] p-4">
      <p className="label-mono">Onboard a new employee</p>
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <Input
          label="Employee ID"
          value={form.employee_code}
          onChange={(v) => setForm({ ...form, employee_code: v })}
        />
        <Input
          label="Name"
          value={form.full_name}
          onChange={(v) => setForm({ ...form, full_name: v })}
        />
        <div>
          <p className="label-mono mb-1">Email ID</p>
          <div className="flex items-center h-9 rounded-md bg-paper ring-1 ring-line overflow-hidden">
            <input
              value={form.localPart}
              onChange={(e) => setForm({ ...form, localPart: e.target.value })}
              placeholder="first.last"
              className="flex-1 min-w-0 px-2 h-full bg-transparent text-[13px] font-mono outline-none"
            />
            <span className="px-2 text-[12px] font-mono text-ink-soft border-l border-line h-full grid place-items-center">
              @{company?.email_domain}
            </span>
          </div>
        </div>
        <Input
          label="Phone number"
          value={form.phone}
          onChange={(v) => setForm({ ...form, phone: v })}
        />
        <Input
          label="Home address"
          value={form.home_address}
          onChange={(v) => setForm({ ...form, home_address: v })}
        />
        <Select
          label="Gender"
          value={form.gender}
          onChange={(v) => setForm({ ...form, gender: v })}
          options={enumOpts("gender", [
            { value: "", label: "Not specified" },
            { value: "male", label: "Male" },
            { value: "female", label: "Female" },
            { value: "undisclosed", label: "Undisclosed" },
          ])}
        />
        <Input
          label="Date of birth"
          type="date"
          value={form.date_of_birth}
          onChange={(v) => setForm({ ...form, date_of_birth: v })}
        />
        <Select
          label="Employment type"
          value={form.employment_type}
          onChange={(v) => setForm({ ...form, employment_type: v })}
          options={enumOpts("employment_type", [
            { value: "full_time", label: "Full Time" },
            { value: "part_time", label: "Part Time" },
            { value: "consultant", label: "Consultant" },
            { value: "intern", label: "Intern" },
          ])}
        />
        <Select
          label="Legal company entity"
          value={form.company_id}
          disabled={!canSeeAll}
          onChange={(v) => setForm({ ...form, company_id: v })}
          options={companies.map((c) => ({ value: c.id, label: c.name }))}
        />
        <Combo
          label="Designation"
          value={form.job_title}
          onChange={(v) => setForm({ ...form, job_title: v })}
          options={picklists.job_title}
        />
        <Combo
          label="Band"
          value={form.band}
          onChange={(v) => setForm({ ...form, band: v })}
          options={picklists.band}
        />
        <Combo
          label="Department"
          value={form.department}
          onChange={(v) => setForm({ ...form, department: v })}
          options={picklists.department}
        />
        <Combo
          label="Business unit"
          value={form.business_unit}
          onChange={(v) => setForm({ ...form, business_unit: v })}
          options={picklists.business_unit}
        />
        <Combo
          label="Legal entity"
          value={form.legal_entity}
          onChange={(v) => setForm({ ...form, legal_entity: v })}
          options={picklists.legal_entity}
        />
        <Combo
          label="Office location"
          value={form.location}
          onChange={(v) => setForm({ ...form, location: v })}
          options={picklists.location}
        />
        <Combo
          label="Office city"
          value={form.office_city}
          onChange={(v) => setForm({ ...form, office_city: v })}
          options={picklists.office_city}
        />
        <Combo
          label="Current office area"
          value={form.office_area}
          onChange={(v) => setForm({ ...form, office_area: v })}
          options={picklists.office_area}
        />
        <Combo
          label="Hired from"
          value={form.hired_from}
          onChange={(v) => setForm({ ...form, hired_from: v })}
          options={picklists.hired_from}
          placeholder="Referral, job board, agency, campus…"
        />
        <Input
          label="Date of joining"
          type="date"
          value={form.joined_on}
          onChange={(v) => setForm({ ...form, joined_on: v })}
        />

        <Select
          label="Access level"
          value={form.access_level}
          onChange={(v) => setForm({ ...form, access_level: v })}
          options={[
            { value: "employee", label: "Employee" },
            { value: "company_hr", label: "Company HR" },
          ]}
        />
        <Select
          label="Reports to"
          value={form.manager_id}
          onChange={(v) => setForm({ ...form, manager_id: v })}
          options={[
            { value: "", label: "No manager (top of chain)" },
            ...employees
              .filter((m) => m.company_id === form.company_id && m.status !== "offboarded")
              .map((m) => ({ value: m.id, label: `${m.full_name} · ${m.job_title}` })),
          ]}
        />
      </div>
      <div className="mt-4 flex gap-2">
        <button
          disabled={create.isPending}
          onClick={() => create.mutate()}
          className="h-10 px-4 rounded-md bg-brand text-paper text-[13px] font-semibold cursor-pointer hover:bg-brand-deep disabled:opacity-50"
        >
          {create.isPending ? "Saving…" : "Create record"}
        </button>
        <button
          onClick={onDone}
          className="h-10 px-4 rounded-md ring-1 ring-line text-[13px] font-medium cursor-pointer hover:bg-ink/5"
        >
          Cancel
        </button>
      </div>
      <p className="text-[11px] font-mono text-ink-soft mt-3">
        The person signs up with this work email and is linked to this record automatically.
      </p>
    </div>
  );
}

export function Input({
  label,
  value,
  onChange,
  type = "text",
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  disabled?: boolean | undefined;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="label-mono mb-1 block">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        disabled={disabled ?? false}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-9 px-2 rounded-md bg-paper ring-1 ring-line text-[13px] outline-none focus:ring-ink disabled:opacity-60"
      />
    </div>
  );
}

/**
 * Type-ahead over values already used in the system. A new value is allowed,
 * but anything matching an existing entry snaps to it so we never end up with
 * "Bengaluru" and "bengaluru " as two departments/cities/bands.
 */
export function Combo({
  label,
  value,
  onChange,
  options,
  disabled,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  disabled?: boolean | undefined;
  placeholder?: string | undefined;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const normalise = (raw: string) => {
    const trimmed = raw.trim().replace(/\s+/g, " ");
    if (!trimmed) return "";
    const match = options.find((o) => o.toLowerCase() === trimmed.toLowerCase());
    return match ?? trimmed;
  };
  return (
    <div>
      <label htmlFor={id} className="label-mono mb-1 block">
        {label}
      </label>
      <input
        id={id}
        list={listId}
        value={value}
        disabled={disabled ?? false}
        placeholder={placeholder ?? "Pick or type a new one"}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onChange(normalise(e.target.value))}
        className="w-full h-9 px-2 rounded-md bg-paper ring-1 ring-line text-[13px] outline-none focus:ring-ink disabled:opacity-60"
      />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </div>
  );
}

export function Select({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean | undefined;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="label-mono mb-1 block">
        {label}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled ?? false}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-9 px-2 rounded-md bg-paper ring-1 ring-line text-[13px] outline-none focus:ring-ink disabled:opacity-60"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
