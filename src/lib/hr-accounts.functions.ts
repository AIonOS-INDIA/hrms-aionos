import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const schema = z.object({
  fullName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(10),
  companyId: z.string().uuid(),
  jobTitle: z.string().min(2).default("HR Manager"),
  department: z.string().min(2).default("People Operations"),
  location: z.string().min(2).default("Bengaluru"),
});

export const createCompanyHrAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => schema.parse(data))
  .handler(async ({ data, context }) => {
    // Only Master HR may provision subsidiary HR accounts.
    const { data: roles, error: roleError } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (roleError) throw new Error(roleError.message);
    if (!roles?.some((r) => r.role === "master_hr")) throw new Error("Master HR access required");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const email = data.email.trim().toLowerCase();

    const { data: company, error: companyError } = await supabaseAdmin
      .from("companies")
      .select("id, name, email_domain")
      .eq("id", data.companyId)
      .maybeSingle();
    if (companyError) throw new Error(companyError.message);
    if (!company) throw new Error("Company not found");
    if (!email.endsWith(`@${company.email_domain}`))
      throw new Error(`Email must use the @${company.email_domain} domain`);

    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.fullName },
    });
    if (createError || !created?.user) throw new Error(createError?.message ?? "Could not create login");
    const userId = created.user.id;

    const { data: existing } = await supabaseAdmin
      .from("employees")
      .select("id")
      .ilike("email", email)
      .maybeSingle();

    let employeeId = existing?.id ?? null;
    if (employeeId) {
      const { error } = await supabaseAdmin
        .from("employees")
        .update({
          user_id: userId,
          full_name: data.fullName,
          company_id: data.companyId,
          access_level: "company_hr",
          job_title: data.jobTitle,
          department: data.department,
          location: data.location,
          status: "active",
        })
        .eq("id", employeeId);
      if (error) throw new Error(error.message);
    } else {
      const { data: inserted, error } = await supabaseAdmin
        .from("employees")
        .insert({
          user_id: userId,
          full_name: data.fullName,
          email,
          company_id: data.companyId,
          access_level: "company_hr",
          job_title: data.jobTitle,
          department: data.department,
          location: data.location,
          status: "active",
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      employeeId = inserted.id;
    }

    await supabaseAdmin.from("user_roles").delete().eq("user_id", userId);
    const { error: rolesError } = await supabaseAdmin.from("user_roles").insert([
      { user_id: userId, role: "company_hr", company_id: data.companyId },
      { user_id: userId, role: "employee", company_id: data.companyId },
    ]);
    if (rolesError) throw new Error(rolesError.message);

    return { employeeId, email, company: company.name };
  });

const guardMaster = async (context: { supabase: any; userId: string }) => {
  const { data: roles, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId);
  if (error) throw new Error(error.message);
  if (!roles?.some((r: { role: string }) => r.role === "master_hr"))
    throw new Error("Master HR access required");
};

const updateSchema = z.object({
  employeeId: z.string().uuid(),
  fullName: z.string().min(2),
  companyId: z.string().uuid(),
  jobTitle: z.string().min(2),
  department: z.string().min(2),
  location: z.string().min(2),
  newPassword: z.string().min(10).optional(),
});

export const updateCompanyHrAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => updateSchema.parse(data))
  .handler(async ({ data, context }) => {
    await guardMaster(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: emp, error: empError } = await supabaseAdmin
      .from("employees")
      .select("id, user_id, email, access_level")
      .eq("id", data.employeeId)
      .maybeSingle();
    if (empError) throw new Error(empError.message);
    if (!emp) throw new Error("HR record not found");
    if (emp.access_level === "master_hr") throw new Error("The Master HR account cannot be edited here");

    const { data: company, error: companyError } = await supabaseAdmin
      .from("companies")
      .select("id, name, email_domain")
      .eq("id", data.companyId)
      .maybeSingle();
    if (companyError) throw new Error(companyError.message);
    if (!company) throw new Error("Company not found");
    if (!emp.email.toLowerCase().endsWith(`@${company.email_domain}`))
      throw new Error(`${emp.email} does not use the @${company.email_domain} domain`);

    const { error } = await supabaseAdmin
      .from("employees")
      .update({
        full_name: data.fullName,
        company_id: data.companyId,
        job_title: data.jobTitle,
        department: data.department,
        location: data.location,
      })
      .eq("id", emp.id);
    if (error) throw new Error(error.message);

    if (emp.user_id) {
      await supabaseAdmin.from("user_roles").delete().eq("user_id", emp.user_id);
      const { error: rolesError } = await supabaseAdmin.from("user_roles").insert([
        { user_id: emp.user_id, role: "company_hr", company_id: data.companyId },
        { user_id: emp.user_id, role: "employee", company_id: data.companyId },
      ]);
      if (rolesError) throw new Error(rolesError.message);

      if (data.newPassword) {
        const { error: pwError } = await supabaseAdmin.auth.admin.updateUserById(emp.user_id, {
          password: data.newPassword,
        });
        if (pwError) throw new Error(pwError.message);
      }
    }

    return { employeeId: emp.id, company: company.name };
  });

export const deleteCompanyHrAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ employeeId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await guardMaster(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: emp, error: empError } = await supabaseAdmin
      .from("employees")
      .select("id, user_id, access_level, email")
      .eq("id", data.employeeId)
      .maybeSingle();
    if (empError) throw new Error(empError.message);
    if (!emp) throw new Error("HR record not found");
    if (emp.access_level === "master_hr") throw new Error("The Master HR account cannot be deleted");

    if (emp.user_id) {
      await supabaseAdmin.from("user_roles").delete().eq("user_id", emp.user_id);
    }
    await supabaseAdmin.from("leave_requests").delete().eq("employee_id", emp.id);
    await supabaseAdmin.from("leave_balances").delete().eq("employee_id", emp.id);
    const { data: sheets } = await supabaseAdmin
      .from("timesheets")
      .select("id")
      .eq("employee_id", emp.id);
    for (const s of sheets ?? []) {
      await supabaseAdmin.from("timesheet_entries").delete().eq("timesheet_id", s.id);
    }
    await supabaseAdmin.from("timesheets").delete().eq("employee_id", emp.id);

    const { error } = await supabaseAdmin.from("employees").delete().eq("id", emp.id);
    if (error) throw new Error(error.message);
    if (emp.user_id) await supabaseAdmin.auth.admin.deleteUser(emp.user_id);

    return { email: emp.email };
  });

const approveSchema = z.object({
  requestId: z.string().uuid(),
  password: z.string().min(10),
  accent: z.string().min(2).default("perp"),
});

export const approveSubsidiaryRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => approveSchema.parse(data))
  .handler(async ({ data, context }) => {
    await guardMaster(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: req, error: reqError } = await supabaseAdmin
      .from("subsidiary_requests")
      .select("*")
      .eq("id", data.requestId)
      .maybeSingle();
    if (reqError) throw new Error(reqError.message);
    if (!req) throw new Error("Request not found");
    if (req.status !== "pending") throw new Error("This request was already handled");

    const email = req.email.trim().toLowerCase();
    const domain = req.email_domain.trim().toLowerCase();
    if (!email.endsWith(`@${domain}`)) throw new Error("Email does not match the requested domain");

    // Reuse the entity when the domain already exists, otherwise create it.
    const { data: existingCompany, error: companyLookupError } = await supabaseAdmin
      .from("companies")
      .select("id, name, email_domain")
      .ilike("email_domain", domain)
      .maybeSingle();
    if (companyLookupError) throw new Error(companyLookupError.message);

    let companyId = existingCompany?.id ?? null;
    let companyName = existingCompany?.name ?? req.company_name;
    if (!companyId) {
      const { data: createdCompany, error: companyError } = await supabaseAdmin
        .from("companies")
        .insert({
          name: req.company_name,
          code: req.company_code.toUpperCase(),
          email_domain: domain,
          accent: data.accent,
          is_parent: false,
        })
        .select("id, name")
        .single();
      if (companyError) throw new Error(companyError.message);
      companyId = createdCompany.id;
      companyName = createdCompany.name;
    }

    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: req.full_name },
    });
    if (createError || !created?.user) throw new Error(createError?.message ?? "Could not create login");
    const userId = created.user.id;

    const { data: existingEmp } = await supabaseAdmin
      .from("employees")
      .select("id")
      .ilike("email", email)
      .maybeSingle();

    const empPayload = {
      user_id: userId,
      full_name: req.full_name,
      company_id: companyId,
      access_level: "company_hr" as const,
      job_title: "HR Manager",
      department: "People Operations",
      location: "Bengaluru",
      status: "active" as const,
    };

    if (existingEmp?.id) {
      const { error } = await supabaseAdmin
        .from("employees")
        .update(empPayload)
        .eq("id", existingEmp.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin.from("employees").insert({ ...empPayload, email });
      if (error) throw new Error(error.message);
    }

    await supabaseAdmin.from("user_roles").delete().eq("user_id", userId);
    const { error: rolesError } = await supabaseAdmin.from("user_roles").insert([
      { user_id: userId, role: "company_hr", company_id: companyId },
      { user_id: userId, role: "employee", company_id: companyId },
    ]);
    if (rolesError) throw new Error(rolesError.message);

    const { error: statusError } = await supabaseAdmin
      .from("subsidiary_requests")
      .update({ status: "approved", decided_at: new Date().toISOString(), decision_note: "" })
      .eq("id", req.id);
    if (statusError) throw new Error(statusError.message);

    return { email, company: companyName, createdCompany: !existingCompany };
  });

export const rejectSubsidiaryRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ requestId: z.string().uuid(), reason: z.string().default("") }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await guardMaster(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("subsidiary_requests")
      .update({
        status: "rejected",
        decision_note: data.reason,
        decided_at: new Date().toISOString(),
      })
      .eq("id", data.requestId)
      .eq("status", "pending");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Person access management: change a person's persona and reset any password.
// ---------------------------------------------------------------------------

const accessSchema = z.object({
  employeeId: z.string().uuid(),
  role: z.enum(["master_hr", "company_hr", "employee"]),
  password: z.string().min(10).optional(),
  /** Entities a company HR may manage. Defaults to their own entity. */
  companyIds: z.array(z.string().uuid()).default([]),
});

/** Entities a person is currently allowed to manage as company HR. */
export const getEmployeeHrEntities = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ employeeId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await guardMaster(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: emp, error } = await supabaseAdmin
      .from("employees")
      .select("id, user_id")
      .eq("id", data.employeeId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!emp?.user_id) return { companyIds: [] as string[] };

    const { data: roles, error: rolesError } = await supabaseAdmin
      .from("user_roles")
      .select("company_id")
      .eq("user_id", emp.user_id)
      .eq("role", "company_hr");
    if (rolesError) throw new Error(rolesError.message);

    return {
      companyIds: (roles ?? []).map((r) => r.company_id).filter((id): id is string => !!id),
    };
  });

export const setEmployeeAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => accessSchema.parse(data))
  .handler(async ({ data, context }) => {
    await guardMaster(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: emp, error: empError } = await supabaseAdmin
      .from("employees")
      .select("id, user_id, email, full_name, company_id, access_level")
      .eq("id", data.employeeId)
      .maybeSingle();
    if (empError) throw new Error(empError.message);
    if (!emp) throw new Error("Employee not found");

    let userId = emp.user_id;
    let createdLogin = false;

    if (!userId) {
      // Reuse an existing auth user with the same email when there is one.
      const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const match = list?.users?.find(
        (u) => (u.email ?? "").toLowerCase() === emp.email.toLowerCase(),
      );
      if (match) {
        userId = match.id;
        if (data.password) {
          const { error } = await supabaseAdmin.auth.admin.updateUserById(match.id, {
            password: data.password,
          });
          if (error) throw new Error(error.message);
        }
      } else {
        if (!data.password)
          throw new Error("This person has no login yet — set a temporary password to create one");
        const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
          email: emp.email.toLowerCase(),
          password: data.password,
          email_confirm: true,
          user_metadata: { full_name: emp.full_name },
        });
        if (error || !created?.user) throw new Error(error?.message ?? "Could not create login");
        userId = created.user.id;
        createdLogin = true;
      }
      const { error: linkError } = await supabaseAdmin
        .from("employees")
        .update({ user_id: userId })
        .eq("id", emp.id);
      if (linkError) throw new Error(linkError.message);
    } else if (data.password) {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        password: data.password,
      });
      if (error) throw new Error(error.message);
    }

    const { error: levelError } = await supabaseAdmin
      .from("employees")
      .update({ access_level: data.role })
      .eq("id", emp.id);
    if (levelError) throw new Error(levelError.message);

    await supabaseAdmin.from("user_roles").delete().eq("user_id", userId!);
    const rows: { user_id: string; role: string; company_id: string | null }[] = [
      { user_id: userId!, role: "employee", company_id: emp.company_id },
    ];
    if (data.role === "company_hr") {
      const scoped = data.companyIds.length ? [...new Set(data.companyIds)] : [emp.company_id];
      for (const cid of scoped)
        rows.unshift({ user_id: userId!, role: "company_hr", company_id: cid });
    }
    if (data.role === "master_hr")
      rows.unshift({ user_id: userId!, role: "master_hr", company_id: null });
    const { error: rolesError } = await supabaseAdmin.from("user_roles").insert(rows as never);
    if (rolesError) throw new Error(rolesError.message);

    return { email: emp.email, role: data.role, createdLogin };
  });

export const resetEmployeePassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ employeeId: z.string().uuid(), password: z.string().min(10) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await guardMaster(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: emp, error: empError } = await supabaseAdmin
      .from("employees")
      .select("id, user_id, email, full_name")
      .eq("id", data.employeeId)
      .maybeSingle();
    if (empError) throw new Error(empError.message);
    if (!emp) throw new Error("Employee not found");

    if (emp.user_id) {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(emp.user_id, {
        password: data.password,
      });
      if (error) throw new Error(error.message);
      return { email: emp.email, createdLogin: false };
    }

    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: emp.email.toLowerCase(),
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: emp.full_name },
    });
    if (error || !created?.user) throw new Error(error?.message ?? "Could not create login");
    const { error: linkError } = await supabaseAdmin
      .from("employees")
      .update({ user_id: created.user.id })
      .eq("id", emp.id);
    if (linkError) throw new Error(linkError.message);
    return { email: emp.email, createdLogin: true };
  });

const financeRole = z.enum(["finance_expense", "finance_payroll", "it_asset"]);

/** Finance duties (expense / payroll approval) a person currently holds, by entity. */
export const getEmployeeFinanceDuties = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ employeeId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await guardMaster(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: emp, error } = await supabaseAdmin
      .from("employees")
      .select("id, user_id")
      .eq("id", data.employeeId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!emp?.user_id) return { expenseCompanyIds: [] as string[], payrollCompanyIds: [] as string[] };

    const { data: roles, error: rolesError } = await supabaseAdmin
      .from("user_roles")
      .select("role, company_id")
      .eq("user_id", emp.user_id)
      .in("role", ["finance_expense", "finance_payroll", "it_asset"]);
    if (rolesError) throw new Error(rolesError.message);

    const pick = (role: string) =>
      (roles ?? [])
        .filter((r) => r.role === role)
        .map((r) => r.company_id)
        .filter((id): id is string => !!id);

    return {
      expenseCompanyIds: pick("finance_expense"),
      payrollCompanyIds: pick("finance_payroll"),
      assetCompanyIds: pick("it_asset"),
    };
  });

/** Replaces one finance duty for a person with the given list of entities. */
export const setEmployeeFinanceDuty = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        employeeId: z.string().uuid(),
        role: financeRole,
        companyIds: z.array(z.string().uuid()),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await guardMaster(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: emp, error } = await supabaseAdmin
      .from("employees")
      .select("id, user_id, full_name")
      .eq("id", data.employeeId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!emp) throw new Error("Employee not found");
    if (!emp.user_id)
      throw new Error("This person needs a login before they can be given extra duties");

    const { error: clearError } = await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", emp.user_id)
      .eq("role", data.role);
    if (clearError) throw new Error(clearError.message);

    const ownerId: string = emp.user_id;
    const unique = Array.from(new Set(data.companyIds));
    if (unique.length) {
      const { error: insertError } = await supabaseAdmin.from("user_roles").insert(
        unique.map((companyId) => ({ user_id: ownerId, role: data.role, company_id: companyId })),
      );
      if (insertError) throw new Error(insertError.message);
    }

    return { employeeId: emp.id, role: data.role, companyIds: unique };
  });
