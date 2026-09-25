import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AppShell, EntityTag, Panel, StatCard } from "@/components/AppShell";
import { Combo, Input, Select } from "@/routes/_authenticated/employees";
import {
  approveSubsidiaryRequest,
  createCompanyHrAccount,
  deleteCompanyHrAccount,
  getEmployeeHrEntities,
  getEmployeeFinanceDuties,
  setEmployeeFinanceDuty,
  rejectSubsidiaryRequest,
  resetEmployeePassword,
  setEmployeeAccess,
  updateCompanyHrAccount,
} from "@/lib/hr-accounts.functions";
import { supabase } from "@/integrations/supabase/client";
import {
  fmtDate,
  useCompanies,
  useEmployees,
  useMe,
  usePicklists,
  useSubsidiaryRequests,
  type Company,
} from "@/lib/hrms";

export const Route = createFileRoute("/_authenticated/hr-accounts")({
  head: () => ({
    meta: [
      { title: "Admin — AIONOS HR Control Tower" },
      {
        name: "description",
        content:
          "Master HR administers subsidiary entities, their email domains and every company HR login across the AIONOS group.",
      },
      { property: "og:title", content: "Admin — AIONOS HR Control Tower" },
      {
        property: "og:description",
        content: "Add, edit and remove subsidiaries and company HR accounts for the AIONOS group.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: HrAccountsPage,
});

const ACCENTS = [
  { value: "aionos", label: "AIONOS ink" },
  { value: "perp", label: "Perpetuuiti" },
  { value: "whilter", label: "Whilter" },
  { value: "cloud", label: "Cloud Analogy" },
  { value: "inetum", label: "Inetum" },
];

const ROLE_OPTIONS = [
  { value: "employee", label: "Employee" },
  { value: "company_hr", label: "Company HR" },
  { value: "master_hr", label: "Master HR" },
];

const roleLabel = (r: string) =>
  r === "master_hr" ? "Master HR" : r === "company_hr" ? "Company HR" : "Employee";

function suggestPassword() {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789-_!@#";
  const bytes = new Uint32Array(20);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}


const cleanDomain = (v: string) =>
  v
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^@/, "")
    .replace(/\s+/g, "");

function HrAccountsPage() {
  const { data: me } = useMe();
  const { data: companies = [] } = useCompanies();
  const { data: employees = [] } = useEmployees();
  const queryClient = useQueryClient();
  const provision = useServerFn(createCompanyHrAccount);
  const updateHr = useServerFn(updateCompanyHrAccount);
  const removeHr = useServerFn(deleteCompanyHrAccount);
  const setAccess = useServerFn(setEmployeeAccess);
  const resetPwd = useServerFn(resetEmployeePassword);

  const picklists = usePicklists();
  const [tab, setTab] = useState<"entities" | "accounts" | "people" | "requests">("entities");

  // ---- people & access state
  const [peopleSearch, setPeopleSearch] = useState("");
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [personRole, setPersonRole] = useState<"master_hr" | "company_hr" | "employee">("employee");
  const [personPassword, setPersonPassword] = useState(suggestPassword);
  const [personSetPassword, setPersonSetPassword] = useState(false);
  const [personEntities, setPersonEntities] = useState<string[]>([]);
  const getHrEntities = useServerFn(getEmployeeHrEntities);
  const getDuties = useServerFn(getEmployeeFinanceDuties);
  const saveDuty = useServerFn(setEmployeeFinanceDuty);
  const [expenseEntities, setExpenseEntities] = useState<string[]>([]);
  const [payrollEntities, setPayrollEntities] = useState<string[]>([]);
  const [assetEntities, setAssetEntities] = useState<string[]>([]);
  const [hrHeadEntities, setHrHeadEntities] = useState<string[]>([]);
  const [adminEntities, setAdminEntities] = useState<string[]>([]);
  const [legalEntities, setLegalEntities] = useState<string[]>([]);
  const approveReq = useServerFn(approveSubsidiaryRequest);
  const rejectReq = useServerFn(rejectSubsidiaryRequest);
  const { data: requests = [] } = useSubsidiaryRequests(Boolean(me?.isMaster));
  const pendingRequests = requests.filter((r) => r.status === "pending");
  const [reqAccent, setReqAccent] = useState<Record<string, string>>({});

  const approve = useMutation({
    mutationFn: async (requestId: string) =>
      approveReq({
        data: {
          requestId,
          password: suggestPassword(),
          accent: reqAccent[requestId] ?? "perp",
        },
      }),
    onSuccess: (res) => {
      toast.success(`${res.company} approved`, {
        description: `${res.email} can now sign in — reset their password from the HR accounts tab.`,
      });
      queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reject = useMutation({
    mutationFn: async (requestId: string) => rejectReq({ data: { requestId, reason: "" } }),
    onSuccess: () => {
      toast.success("Request rejected");
      queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ---- subsidiary form state
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [cName, setCName] = useState("");
  const [cCode, setCCode] = useState("");
  const [cDomain, setCDomain] = useState("");
  const [cAccent, setCAccent] = useState("perp");

  const resetCompanyForm = () => {
    setEditingCompany(null);
    setCName("");
    setCCode("");
    setCDomain("");
    setCAccent("perp");
  };

  const startEditCompany = (c: Company) => {
    setEditingCompany(c);
    setCName(c.name);
    setCCode(c.code);
    setCDomain(c.email_domain);
    setCAccent(c.accent);
    setTab("entities");
  };

  const saveCompany = useMutation({
    mutationFn: async () => {
      const payload = {
        name: cName.trim(),
        code: cCode.trim().toUpperCase(),
        email_domain: cleanDomain(cDomain),
        accent: cAccent,
      };
      if (!payload.name || !payload.code || !payload.email_domain)
        throw new Error("Name, code and email domain are required");
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(payload.email_domain))
        throw new Error("Enter a valid email domain, e.g. whilter.dev");
      const q = editingCompany
        ? supabase.from("companies").update(payload).eq("id", editingCompany.id)
        : supabase.from("companies").insert(payload);
      const { error } = await q;
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success(editingCompany ? "Subsidiary updated" : "Subsidiary added");
      resetCompanyForm();
      queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteCompany = useMutation({
    mutationFn: async (c: Company) => {
      if (c.is_parent) throw new Error("The AIONOS parent entity cannot be deleted");
      const staff = employees.filter((e) => e.company_id === c.id);
      if (staff.length)
        throw new Error(`${c.name} still has ${staff.length} people — move or remove them first`);
      const { error } = await supabase.from("companies").delete().eq("id", c.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Subsidiary removed");
      resetCompanyForm();
      queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ---- HR account form state
  const [editingHrId, setEditingHrId] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [localPart, setLocalPart] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [jobTitle, setJobTitle] = useState("HR Manager");
  const [department, setDepartment] = useState("People Operations");
  const [location, setLocation] = useState("Bengaluru");
  const [password, setPassword] = useState(suggestPassword);
  const [resetPassword, setResetPassword] = useState(false);

  const company = companies.find((c) => c.id === companyId);
  const email = localPart && company ? `${localPart}@${company.email_domain}` : "";

  const hrAccounts = useMemo(
    () => employees.filter((e) => e.access_level === "company_hr" || e.access_level === "master_hr"),
    [employees],
  );
  const editingHr = hrAccounts.find((e) => e.id === editingHrId) ?? null;

  const covered = new Set(
    hrAccounts.filter((e) => e.access_level === "company_hr").map((e) => e.company_id),
  );

  const resetHrForm = () => {
    setEditingHrId(null);
    setFullName("");
    setLocalPart("");
    setCompanyId("");
    setJobTitle("HR Manager");
    setDepartment("People Operations");
    setLocation("Bengaluru");
    setPassword(suggestPassword());
    setResetPassword(false);
  };

  const startEditHr = (id: string) => {
    const e = hrAccounts.find((x) => x.id === id);
    if (!e) return;
    setEditingHrId(id);
    setFullName(e.full_name);
    setLocalPart(e.email.split("@")[0] ?? "");
    setCompanyId(e.company_id);
    setJobTitle(e.job_title);
    setDepartment(e.department);
    setLocation(e.location);
    setPassword(suggestPassword());
    setResetPassword(false);
    setTab("accounts");
  };

  const saveHr = useMutation({
    mutationFn: async () => {
      if (!companyId) throw new Error("Pick a company");
      if (editingHrId) {
        return updateHr({
          data: {
            employeeId: editingHrId,
            fullName,
            companyId,
            jobTitle,
            department,
            location,
            ...(resetPassword ? { newPassword: password } : {}),
          },
        });
      }
      return provision({
        data: { fullName, email, password, companyId, jobTitle, department, location },
      });
    },
    onSuccess: () => {
      toast.success(editingHrId ? "HR account updated" : "HR account created");
      resetHrForm();
      queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteHr = useMutation({
    mutationFn: async (employeeId: string) => removeHr({ data: { employeeId } }),
    onSuccess: (res) => {
      toast.success(`Removed ${res.email}`);
      resetHrForm();
      queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ---- people & access
  const peopleResults = useMemo(() => {
    const q = peopleSearch.trim().toLowerCase();
    if (!q) return [];
    return employees
      .filter(
        (e) =>
          e.full_name.toLowerCase().includes(q) ||
          e.email.toLowerCase().includes(q) ||
          (e.employee_code ?? "").toLowerCase().includes(q),
      )
      .slice(0, 25);
  }, [employees, peopleSearch]);

  const selectedPerson = employees.find((e) => e.id === selectedPersonId) ?? null;

  const pickPerson = async (id: string) => {
    const e = employees.find((x) => x.id === id);
    if (!e) return;
    setSelectedPersonId(id);
    setPersonRole(
      e.access_level === "master_hr" || e.access_level === "company_hr"
        ? e.access_level
        : "employee",
    );
    setPersonPassword(suggestPassword());
    setPersonSetPassword(!e.user_id);
    setPersonEntities(e.access_level === "company_hr" ? [e.company_id] : []);
    setExpenseEntities([]);
    setPayrollEntities([]);
    try {
      const duties = await getDuties({ data: { employeeId: id } });
      setExpenseEntities(duties.expenseCompanyIds);
      setPayrollEntities(duties.payrollCompanyIds);
      setAssetEntities(duties.assetCompanyIds ?? []);
      setHrHeadEntities(duties.hrHeadCompanyIds ?? []);
      setAdminEntities(duties.adminCompanyIds ?? []);
      setLegalEntities(duties.legalCompanyIds ?? []);
    } catch {
      /* duties stay empty when they cannot be read */
    }
    try {
      const res = await getHrEntities({ data: { employeeId: id } });
      if (res.companyIds.length) setPersonEntities(res.companyIds);
    } catch {
      /* keep the default entity when the mapping cannot be read */
    }
  };

  const toggleEntity = (id: string) =>
    setPersonEntities((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const saveDuties = useMutation({
    mutationFn: async () => {
      if (!selectedPerson) throw new Error("Pick a person first");
      await saveDuty({
        data: {
          employeeId: selectedPerson.id,
          role: "finance_expense",
          companyIds: expenseEntities,
        },
      });
      await saveDuty({
        data: {
          employeeId: selectedPerson.id,
          role: "finance_payroll",
          companyIds: payrollEntities,
        },
      });
      await saveDuty({
        data: {
          employeeId: selectedPerson.id,
          role: "it_asset",
          companyIds: assetEntities,
        },
      });
      await saveDuty({
        data: { employeeId: selectedPerson.id, role: "hr_head", companyIds: hrHeadEntities },
      });
      await saveDuty({
        data: { employeeId: selectedPerson.id, role: "admin_facilities", companyIds: adminEntities },
      });
      await saveDuty({
        data: { employeeId: selectedPerson.id, role: "legal", companyIds: legalEntities },
      });
    },
    onSuccess: () => {
      toast.success("Extra duties updated");
      queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const savePerson = useMutation({
    mutationFn: async () => {
      if (!selectedPerson) throw new Error("Pick a person first");
      if (personRole === "company_hr" && personEntities.length === 0)
        throw new Error("Pick at least one entity this HR can manage");
      return setAccess({
        data: {
          employeeId: selectedPerson.id,
          role: personRole,
          companyIds: personRole === "company_hr" ? personEntities : [],
          ...(personSetPassword ? { password: personPassword } : {}),
        },
      });
    },
    onSuccess: (res) => {
      toast.success(`${res.email} is now ${roleLabel(res.role)}`, {
        description: res.createdLogin ? "A login was created with the password shown." : undefined,
      });
      queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetPersonPassword = useMutation({
    mutationFn: async () => {
      if (!selectedPerson) throw new Error("Pick a person first");
      return resetPwd({ data: { employeeId: selectedPerson.id, password: personPassword } });
    },
    onSuccess: (res) => {
      toast.success(`Password set for ${res.email}`, {
        description: "Share it with them — they should change it after signing in.",
      });
      queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });



  if (!me?.isMaster) {
    return (
      <AppShell title="Admin" subtitle="Restricted area">
        <Panel title="Restricted">
          <p className="p-4 text-[13px] text-ink-soft">
            This area is available to group HR administrators only.
          </p>
        </Panel>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Admin"
      subtitle="Manage subsidiary entities, their email domains and company HR logins"
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Entities"
          value={String(companies.length)}
          active={tab === "entities"}
          onClick={() => setTab("entities")}
        />
        <StatCard
          label="Company HR accounts"
          value={String(covered.size)}
          active={tab === "accounts"}
          onClick={() => setTab("accounts")}
        />
        <StatCard
          label="Entities without HR"
          value={String(companies.filter((c) => !covered.has(c.id)).length)}
          active={tab === "accounts"}
          onClick={() => setTab("accounts")}
        />
      </div>

      <div className="mt-4 flex gap-2">
        {(
          [
            ["entities", "Subsidiaries & domains"],
            ["accounts", "Company HR accounts"],
            ["people", "People & access"],
            [
              "requests",
              pendingRequests.length
                ? `Access requests (${pendingRequests.length})`
                : "Access requests",
            ],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`h-8 px-3 rounded-md text-[12px] ring-1 ring-line cursor-pointer ${
              tab === key ? "bg-brand text-paper" : "hover:bg-ink/5"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "people" ? (
        <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr] mt-4">
          <Panel title="Find a person" meta={<span className="label-mono">{employees.length}</span>}>
            <div className="p-4 space-y-3">
              <Input
                label="Search by name, work email or employee ID"
                value={peopleSearch}
                onChange={setPeopleSearch}
              />
              {peopleSearch.trim() === "" ? (
                <p className="text-[12px] text-ink-soft">
                  Start typing to find anyone across all entities.
                </p>
              ) : peopleResults.length === 0 ? (
                <p className="text-[12px] text-ink-soft">No match for “{peopleSearch}”.</p>
              ) : (
                <div className="divide-y divide-line rounded-md ring-1 ring-line">
                  {peopleResults.map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => pickPerson(e.id)}
                      className={`w-full text-left px-3 py-2 cursor-pointer ${
                        selectedPersonId === e.id ? "bg-brand/10" : "hover:bg-ink/5"
                      }`}
                    >
                      <p className="text-[13px] font-medium truncate">{e.full_name}</p>
                      <p className="label-mono truncate">
                        {e.email} · {roleLabel(e.access_level)} ·{" "}
                        {companies.find((c) => c.id === e.company_id)?.name ?? "—"}
                        {e.user_id ? "" : " · no login"}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Panel>

          <Panel title={selectedPerson ? selectedPerson.full_name : "Access & password"}>
            {!selectedPerson ? (
              <p className="p-4 text-[13px] text-ink-soft">
                Pick someone on the left to change what they can do or to set a new password.
              </p>
            ) : (
              <div className="p-4 space-y-3">
                <p className="label-mono">
                  {selectedPerson.email} ·{" "}
                  {companies.find((c) => c.id === selectedPerson.company_id)?.name ?? "—"}
                </p>
                <Select
                  label="Persona"
                  value={personRole}
                  onChange={(v) => setPersonRole(v as typeof personRole)}
                  options={ROLE_OPTIONS}
                />
                <p className="text-[12px] text-ink-soft">
                  {personRole === "master_hr"
                    ? "Full access across every entity, including policies and administration."
                    : personRole === "company_hr"
                      ? "HR access is limited to the legal entities ticked below."
                      : "Personal workspace only: leave, timesheets, goals, payslips and documents."}
                </p>

                {personRole === "company_hr" && (
                  <div className="rounded-md ring-1 ring-line p-3">
                    <p className="label-mono mb-2">Legal entities this HR can manage</p>
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {companies.map((c) => (
                        <label
                          key={c.id}
                          className="flex items-center gap-2 text-[13px] cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={personEntities.includes(c.id)}
                            onChange={() => toggleEntity(c.id)}
                          />
                          <span className="truncate">{c.name}</span>
                        </label>
                      ))}
                    </div>
                    <p className="text-[12px] text-ink-soft mt-2">
                      {personEntities.length === 0
                        ? "Pick at least one entity."
                        : `${personEntities.length} selected — they will only see people and requests from these entities.`}
                    </p>
                  </div>
                )}

                <div className="rounded-md ring-1 ring-line p-3 space-y-3">
                  <div>
                    <p className="label-mono">Finance &amp; IT duties</p>
                    <p className="text-[12px] text-ink-soft">
                      Extra duties on top of the persona above. Pick the entities this person signs
                      off for.
                    </p>
                  </div>
                  {(
                    [
                      ["Approve expense claims", expenseEntities, setExpenseEntities],
                      ["Approve payslips and payments", payrollEntities, setPayrollEntities],
                      ["Manage IT assets and licences", assetEntities, setAssetEntities],
                      ["HR Head (final escalation for exits)", hrHeadEntities, setHrHeadEntities],
                      ["Admin / Facilities clearance", adminEntities, setAdminEntities],
                      ["Legal review (terminations)", legalEntities, setLegalEntities],
                    ] as [string, string[], (fn: (prev: string[]) => string[]) => void][]
                  ).map(([label, picked, setPicked]) => (
                    <div key={label}>
                      <p className="text-[12.5px] font-medium mb-1">{label}</p>
                      <div className="grid gap-1.5 sm:grid-cols-2">
                        {companies.map((c) => (
                          <label
                            key={c.id}
                            className="flex items-center gap-2 text-[13px] cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={picked.includes(c.id)}
                              onChange={() =>
                                setPicked((prev) =>
                                  prev.includes(c.id)
                                    ? prev.filter((x) => x !== c.id)
                                    : [...prev, c.id],
                                )
                              }
                            />
                            <span className="truncate">{c.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    disabled={saveDuties.isPending || !selectedPerson?.user_id}
                    onClick={() => saveDuties.mutate()}
                    className="h-9 px-4 rounded-md text-[13px] ring-1 ring-line hover:bg-ink/5 disabled:opacity-40 cursor-pointer"
                  >
                    {saveDuties.isPending ? "Saving…" : "Save duties"}
                  </button>
                  {!selectedPerson?.user_id && (
                    <p className="text-[12px] text-ink-soft">
                      Create a login for this person first, then assign these duties.
                    </p>
                  )}
                </div>

                <label className="flex items-center gap-2 text-[12px] text-ink-soft cursor-pointer">
                  <input
                    type="checkbox"
                    checked={personSetPassword}
                    onChange={(ev) => setPersonSetPassword(ev.target.checked)}
                  />
                  {selectedPerson.user_id
                    ? "Also set a new password"
                    : "Create a login with this password"}
                </label>

                {personSetPassword && (
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <Input
                        label="Temporary password"
                        value={personPassword}
                        onChange={setPersonPassword}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setPersonPassword(suggestPassword())}
                      className="h-9 px-3 rounded-md text-[12px] ring-1 ring-line hover:bg-ink/5 cursor-pointer"
                    >
                      Regenerate
                    </button>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={savePerson.isPending}
                    onClick={() => savePerson.mutate()}
                    className="h-9 px-4 rounded-md bg-brand text-paper text-[13px] font-medium disabled:opacity-40 cursor-pointer"
                  >
                    {savePerson.isPending ? "Saving…" : "Save access"}
                  </button>
                  <button
                    type="button"
                    disabled={resetPersonPassword.isPending}
                    onClick={() => {
                      setPersonSetPassword(true);
                      resetPersonPassword.mutate();
                    }}
                    className="h-9 px-4 rounded-md text-[13px] ring-1 ring-line hover:bg-ink/5 disabled:opacity-40 cursor-pointer"
                  >
                    {resetPersonPassword.isPending ? "Working…" : "Reset password only"}
                  </button>
                </div>
                <p className="text-[12px] text-ink-soft">
                  Share the temporary password directly with the person; ask them to change it after
                  signing in.
                </p>
              </div>
            )}
          </Panel>
        </div>
      ) : tab === "requests" ? (
        <div className="mt-4">
          <Panel
            title="Subsidiary access requests"
            meta={<span className="label-mono">{pendingRequests.length} pending</span>}
          >
            {requests.length === 0 ? (
              <p className="p-4 text-[13px] text-ink-soft">
                No requests yet. New subsidiary HR can apply from the sign-in page.
              </p>
            ) : (
              <div className="divide-y divide-line">
                {requests.map((r) => (
                  <div key={r.id} className="px-4 py-3 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium truncate">
                          {r.company_name}{" "}
                          <span className="text-ink-soft">· {r.company_code}</span>
                        </p>
                        <p className="label-mono truncate">
                          {r.full_name} · {r.email} · @{r.email_domain}
                        </p>
                        <p className="label-mono">Requested {fmtDate(r.created_at.slice(0, 10))}</p>
                        {r.note && <p className="text-[12px] text-ink-soft mt-1">{r.note}</p>}
                      </div>
                      <span className="label-mono shrink-0">{r.status}</span>
                    </div>
                    {r.status === "pending" && (
                      <div className="flex flex-wrap items-end gap-2">
                        <div className="w-44">
                          <Select
                            label="Accent"
                            value={reqAccent[r.id] ?? "perp"}
                            onChange={(v) => setReqAccent((s) => ({ ...s, [r.id]: v }))}
                            options={ACCENTS}
                          />
                        </div>
                        <button
                          type="button"
                          disabled={approve.isPending}
                          onClick={() => approve.mutate(r.id)}
                          className="h-9 px-3 rounded-md bg-brand text-paper text-[12px] font-medium disabled:opacity-40 cursor-pointer"
                        >
                          Approve &amp; create
                        </button>
                        <button
                          type="button"
                          disabled={reject.isPending}
                          onClick={() => reject.mutate(r.id)}
                          className="h-9 px-3 rounded-md text-[12px] ring-1 ring-line text-destructive hover:bg-destructive/10 disabled:opacity-40 cursor-pointer"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      ) : tab === "entities" ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr] mt-4">
          <Panel title={editingCompany ? `Edit ${editingCompany.name}` : "Add subsidiary"}>
            <form
              className="p-4 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                saveCompany.mutate();
              }}
            >
              <Input label="Entity name" value={cName} onChange={setCName} />
              <Input
                label="Short code"
                value={cCode}
                onChange={(v) => setCCode(v.toUpperCase().replace(/\s+/g, ""))}
              />
              <Input label="Email domain" value={cDomain} onChange={setCDomain} />
              {cDomain && <p className="label-mono">name@{cleanDomain(cDomain)}</p>}
              <Select label="Accent" value={cAccent} onChange={setCAccent} options={ACCENTS} />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={saveCompany.isPending}
                  className="flex-1 h-9 rounded-md bg-brand text-paper text-[13px] font-medium disabled:opacity-40 cursor-pointer"
                >
                  {saveCompany.isPending
                    ? "Saving…"
                    : editingCompany
                      ? "Save changes"
                      : "Add subsidiary"}
                </button>
                {editingCompany && (
                  <button
                    type="button"
                    onClick={resetCompanyForm}
                    className="h-9 px-3 rounded-md text-[12px] ring-1 ring-line hover:bg-ink/5 cursor-pointer"
                  >
                    Cancel
                  </button>
                )}
              </div>
              <p className="text-[12px] text-ink-soft">
                People joining this entity must use an email on its domain. Group policies, leave
                rules and holidays still come from AIONOS.
              </p>
            </form>
          </Panel>

          <Panel title="Subsidiaries" meta={<span className="label-mono">{companies.length}</span>}>
            <div className="divide-y divide-line">
              {companies.map((c) => {
                const staff = employees.filter((e) => e.company_id === c.id).length;
                return (
                  <div key={c.id} className="px-4 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <EntityTag company={c} />
                      <p className="label-mono truncate">
                        @{c.email_domain} · {staff} people ·{" "}
                        {covered.has(c.id) ? "HR assigned" : "no HR yet"}
                      </p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => startEditCompany(c)}
                        className="h-8 px-3 rounded-md text-[12px] ring-1 ring-line hover:bg-ink/5 cursor-pointer"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={c.is_parent || deleteCompany.isPending}
                        onClick={() => deleteCompany.mutate(c)}
                        className="h-8 px-3 rounded-md text-[12px] ring-1 ring-line text-destructive hover:bg-destructive/10 disabled:opacity-30 cursor-pointer"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr] mt-4">
          <Panel title={editingHr ? `Edit ${editingHr.full_name}` : "Create company HR account"}>
            <form
              className="p-4 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                saveHr.mutate();
              }}
            >
              <Input label="Full name" value={fullName} onChange={setFullName} />
              <Select
                label="Company"
                value={companyId}
                onChange={setCompanyId}
                options={[
                  { value: "", label: "Select entity" },
                  ...companies.map((c) => ({ value: c.id, label: c.name })),
                ]}
              />
              <Input
                label={`Work email${company ? ` (@${company.email_domain})` : ""}`}
                value={localPart}
                onChange={(v) => setLocalPart(v.replace(/\s+/g, "").toLowerCase())}
                {...(editingHr ? { disabled: true } : {})}
              />
              {(editingHr?.email || email) && (
                <p className="label-mono">{editingHr?.email ?? email}</p>
              )}
              <Combo
                label="Job title"
                value={jobTitle}
                onChange={setJobTitle}
                options={picklists.job_title}
              />
              <Combo
                label="Department"
                value={department}
                onChange={setDepartment}
                options={picklists.department}
              />
              <Combo
                label="Location"
                value={location}
                onChange={setLocation}
                options={picklists.location}
              />

              {editingHr && (
                <label className="flex items-center gap-2 text-[12px] text-ink-soft cursor-pointer">
                  <input
                    type="checkbox"
                    checked={resetPassword}
                    onChange={(e) => setResetPassword(e.target.checked)}
                  />
                  Reset this HR&apos;s password
                </label>
              )}

              {(!editingHr || resetPassword) && (
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <Input label="Temporary password" value={password} onChange={setPassword} />
                  </div>
                  <button
                    type="button"
                    onClick={() => setPassword(suggestPassword())}
                    className="h-9 px-3 rounded-md text-[12px] ring-1 ring-line hover:bg-ink/5 cursor-pointer"
                  >
                    Regenerate
                  </button>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={saveHr.isPending || !fullName || (!editingHr && !email)}
                  className="flex-1 h-9 rounded-md bg-brand text-paper text-[13px] font-medium disabled:opacity-40 cursor-pointer"
                >
                  {saveHr.isPending ? "Saving…" : editingHr ? "Save changes" : "Create HR account"}
                </button>
                {editingHr && (
                  <button
                    type="button"
                    onClick={resetHrForm}
                    className="h-9 px-3 rounded-md text-[12px] ring-1 ring-line hover:bg-ink/5 cursor-pointer"
                  >
                    Cancel
                  </button>
                )}
              </div>
              <p className="text-[12px] text-ink-soft">
                Each HR signs in with their own company email and can manage only their own company.
              </p>
            </form>
          </Panel>

          <Panel title="HR accounts" meta={<span className="label-mono">{hrAccounts.length}</span>}>
            <div className="divide-y divide-line">
              {hrAccounts.map((e) => (
                <div key={e.id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium truncate">{e.full_name}</p>
                    <p className="label-mono truncate">{e.email}</p>
                    <p className="label-mono">
                      {e.access_level === "master_hr" ? "Master HR" : "Company HR"} ·{" "}
                      {fmtDate(e.joined_on)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <EntityTag company={companies.find((c) => c.id === e.company_id)} />
                    {e.access_level === "company_hr" && (
                      <>
                        <button
                          type="button"
                          onClick={() => startEditHr(e.id)}
                          className="h-8 px-3 rounded-md text-[12px] ring-1 ring-line hover:bg-ink/5 cursor-pointer"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={deleteHr.isPending}
                          onClick={() => deleteHr.mutate(e.id)}
                          className="h-8 px-3 rounded-md text-[12px] ring-1 ring-line text-destructive hover:bg-destructive/10 disabled:opacity-30 cursor-pointer"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}
    </AppShell>
  );
}
