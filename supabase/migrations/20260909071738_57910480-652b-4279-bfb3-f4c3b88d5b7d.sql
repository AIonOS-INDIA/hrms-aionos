
-- ENUMS
CREATE TYPE public.app_role AS ENUM ('master_hr','company_hr','employee');
CREATE TYPE public.employment_status AS ENUM ('onboarding','active','on_leave','offboarded');
CREATE TYPE public.request_status AS ENUM ('pending','approved','rejected','cancelled');
CREATE TYPE public.timesheet_status AS ENUM ('draft','submitted','approved','rejected');

-- COMPANIES
CREATE TABLE public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  email_domain text NOT NULL,
  accent text NOT NULL DEFAULT 'aionos',
  is_parent boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.companies TO authenticated;
GRANT ALL ON public.companies TO service_role;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

-- EMPLOYEES
CREATE TABLE public.employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE,
  full_name text NOT NULL,
  email text NOT NULL UNIQUE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  job_title text NOT NULL DEFAULT 'Associate',
  department text NOT NULL DEFAULT 'General',
  location text NOT NULL DEFAULT 'Bengaluru',
  status public.employment_status NOT NULL DEFAULT 'onboarding',
  access_level public.app_role NOT NULL DEFAULT 'employee',
  joined_on date NOT NULL DEFAULT current_date,
  exit_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employees TO authenticated;
GRANT ALL ON public.employees TO service_role;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

-- ROLES
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role, company_id)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- HELPER FUNCTIONS
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.is_master_hr()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'master_hr');
$$;

CREATE OR REPLACE FUNCTION public.can_manage_company(_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND (role = 'master_hr' OR (role = 'company_hr' AND company_id = _company_id))
  );
$$;

CREATE OR REPLACE FUNCTION public.my_employee_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.employees WHERE user_id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.employee_company(_employee_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT company_id FROM public.employees WHERE id = _employee_id;
$$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER employees_updated_at BEFORE UPDATE ON public.employees
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- LEAVE TYPES (AIONOS level)
CREATE TABLE public.leave_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  annual_days numeric(5,1) NOT NULL DEFAULT 0,
  carry_forward_days numeric(5,1) NOT NULL DEFAULT 0,
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leave_types TO authenticated;
GRANT ALL ON public.leave_types TO service_role;
ALTER TABLE public.leave_types ENABLE ROW LEVEL SECURITY;

-- HOLIDAYS (AIONOS level, by location)
CREATE TABLE public.holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  holiday_date date NOT NULL,
  location text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (holiday_date, location, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.holidays TO authenticated;
GRANT ALL ON public.holidays TO service_role;
ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;

-- POLICIES (AIONOS level)
CREATE TABLE public.policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  category text NOT NULL DEFAULT 'General',
  body text NOT NULL,
  effective_from date NOT NULL DEFAULT current_date,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.policies TO authenticated;
GRANT ALL ON public.policies TO service_role;
ALTER TABLE public.policies ENABLE ROW LEVEL SECURITY;

-- LEAVE BALANCES
CREATE TABLE public.leave_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  leave_type_id uuid NOT NULL REFERENCES public.leave_types(id) ON DELETE CASCADE,
  year int NOT NULL DEFAULT EXTRACT(YEAR FROM current_date),
  entitled_days numeric(5,1) NOT NULL DEFAULT 0,
  used_days numeric(5,1) NOT NULL DEFAULT 0,
  UNIQUE (employee_id, leave_type_id, year)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leave_balances TO authenticated;
GRANT ALL ON public.leave_balances TO service_role;
ALTER TABLE public.leave_balances ENABLE ROW LEVEL SECURITY;

-- LEAVE REQUESTS
CREATE TABLE public.leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  leave_type_id uuid NOT NULL REFERENCES public.leave_types(id) ON DELETE RESTRICT,
  start_date date NOT NULL,
  end_date date NOT NULL,
  days numeric(5,1) NOT NULL DEFAULT 1,
  reason text NOT NULL DEFAULT '',
  status public.request_status NOT NULL DEFAULT 'pending',
  decision_note text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leave_requests TO authenticated;
GRANT ALL ON public.leave_requests TO service_role;
ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;

-- TIMESHEETS
CREATE TABLE public.timesheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  status public.timesheet_status NOT NULL DEFAULT 'draft',
  total_hours numeric(6,2) NOT NULL DEFAULT 0,
  submitted_at timestamptz,
  decided_at timestamptz,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, week_start)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.timesheets TO authenticated;
GRANT ALL ON public.timesheets TO service_role;
ALTER TABLE public.timesheets ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.timesheet_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  timesheet_id uuid NOT NULL REFERENCES public.timesheets(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  hours numeric(4,2) NOT NULL DEFAULT 0,
  project text NOT NULL DEFAULT 'General',
  notes text NOT NULL DEFAULT '',
  UNIQUE (timesheet_id, work_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.timesheet_entries TO authenticated;
GRANT ALL ON public.timesheet_entries TO service_role;
ALTER TABLE public.timesheet_entries ENABLE ROW LEVEL SECURITY;

-- POLICIES: companies
CREATE POLICY companies_read ON public.companies FOR SELECT TO authenticated USING (true);
CREATE POLICY companies_write ON public.companies FOR ALL TO authenticated
  USING (public.is_master_hr()) WITH CHECK (public.is_master_hr());

-- POLICIES: user_roles
CREATE POLICY roles_read_own ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_master_hr());

-- POLICIES: employees
CREATE POLICY employees_read ON public.employees FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.can_manage_company(company_id));
CREATE POLICY employees_insert ON public.employees FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_company(company_id));
CREATE POLICY employees_update ON public.employees FOR UPDATE TO authenticated
  USING (public.can_manage_company(company_id)) WITH CHECK (public.can_manage_company(company_id));
CREATE POLICY employees_delete ON public.employees FOR DELETE TO authenticated
  USING (public.is_master_hr());

-- POLICIES: shared config (readable by all signed-in users, writable at AIONOS/master level)
CREATE POLICY leave_types_read ON public.leave_types FOR SELECT TO authenticated USING (true);
CREATE POLICY leave_types_write ON public.leave_types FOR ALL TO authenticated
  USING (public.is_master_hr()) WITH CHECK (public.is_master_hr());
CREATE POLICY holidays_read ON public.holidays FOR SELECT TO authenticated USING (true);
CREATE POLICY holidays_write ON public.holidays FOR ALL TO authenticated
  USING (public.is_master_hr()) WITH CHECK (public.is_master_hr());
CREATE POLICY policies_read ON public.policies FOR SELECT TO authenticated USING (true);
CREATE POLICY policies_write ON public.policies FOR ALL TO authenticated
  USING (public.is_master_hr()) WITH CHECK (public.is_master_hr());

-- POLICIES: leave balances
CREATE POLICY balances_read ON public.leave_balances FOR SELECT TO authenticated
  USING (employee_id = public.my_employee_id() OR public.can_manage_company(public.employee_company(employee_id)));
CREATE POLICY balances_write ON public.leave_balances FOR ALL TO authenticated
  USING (public.can_manage_company(public.employee_company(employee_id)))
  WITH CHECK (public.can_manage_company(public.employee_company(employee_id)));

-- POLICIES: leave requests
CREATE POLICY leave_read ON public.leave_requests FOR SELECT TO authenticated
  USING (employee_id = public.my_employee_id() OR public.can_manage_company(public.employee_company(employee_id)));
CREATE POLICY leave_insert ON public.leave_requests FOR INSERT TO authenticated
  WITH CHECK (employee_id = public.my_employee_id() OR public.can_manage_company(public.employee_company(employee_id)));
CREATE POLICY leave_update ON public.leave_requests FOR UPDATE TO authenticated
  USING (employee_id = public.my_employee_id() OR public.can_manage_company(public.employee_company(employee_id)))
  WITH CHECK (employee_id = public.my_employee_id() OR public.can_manage_company(public.employee_company(employee_id)));
CREATE POLICY leave_delete ON public.leave_requests FOR DELETE TO authenticated
  USING (employee_id = public.my_employee_id() OR public.can_manage_company(public.employee_company(employee_id)));

-- POLICIES: timesheets
CREATE POLICY ts_read ON public.timesheets FOR SELECT TO authenticated
  USING (employee_id = public.my_employee_id() OR public.can_manage_company(public.employee_company(employee_id)));
CREATE POLICY ts_insert ON public.timesheets FOR INSERT TO authenticated
  WITH CHECK (employee_id = public.my_employee_id() OR public.can_manage_company(public.employee_company(employee_id)));
CREATE POLICY ts_update ON public.timesheets FOR UPDATE TO authenticated
  USING (employee_id = public.my_employee_id() OR public.can_manage_company(public.employee_company(employee_id)))
  WITH CHECK (employee_id = public.my_employee_id() OR public.can_manage_company(public.employee_company(employee_id)));
CREATE POLICY ts_delete ON public.timesheets FOR DELETE TO authenticated
  USING (employee_id = public.my_employee_id() OR public.can_manage_company(public.employee_company(employee_id)));

CREATE OR REPLACE FUNCTION public.timesheet_employee(_timesheet_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT employee_id FROM public.timesheets WHERE id = _timesheet_id;
$$;

CREATE POLICY tse_all ON public.timesheet_entries FOR ALL TO authenticated
  USING (
    public.timesheet_employee(timesheet_id) = public.my_employee_id()
    OR public.can_manage_company(public.employee_company(public.timesheet_employee(timesheet_id)))
  )
  WITH CHECK (
    public.timesheet_employee(timesheet_id) = public.my_employee_id()
    OR public.can_manage_company(public.employee_company(public.timesheet_employee(timesheet_id)))
  );

-- ACCOUNT LINKING: connects a newly signed-up user to their seeded employee record by verified email
CREATE OR REPLACE FUNCTION public.claim_my_employee_record()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_emp public.employees%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;
  SELECT lower(email) INTO v_email FROM auth.users WHERE id = v_uid;
  IF v_email IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v_emp FROM public.employees WHERE user_id = v_uid;
  IF NOT FOUND THEN
    UPDATE public.employees SET user_id = v_uid
    WHERE lower(email) = v_email AND user_id IS NULL
    RETURNING * INTO v_emp;
  END IF;
  IF v_emp.id IS NULL THEN RETURN NULL; END IF;

  DELETE FROM public.user_roles WHERE user_id = v_uid;
  IF v_emp.access_level = 'master_hr' THEN
    INSERT INTO public.user_roles (user_id, role, company_id) VALUES (v_uid, 'master_hr', NULL);
  ELSIF v_emp.access_level = 'company_hr' THEN
    INSERT INTO public.user_roles (user_id, role, company_id) VALUES (v_uid, 'company_hr', v_emp.company_id);
  END IF;
  INSERT INTO public.user_roles (user_id, role, company_id) VALUES (v_uid, 'employee', v_emp.company_id)
  ON CONFLICT DO NOTHING;

  RETURN v_emp.id;
END; $$;
GRANT EXECUTE ON FUNCTION public.claim_my_employee_record() TO authenticated;

-- ============ SEED DATA ============
INSERT INTO public.companies (code, name, email_domain, accent, is_parent) VALUES
 ('AIONOS','AIONOS','aionos.co','aionos', true),
 ('PERP','Perpetuuiti','perpetuuiti.io','perp', false),
 ('WHIL','Whilter','whilter.dev','whilter', false),
 ('CLOUD','Cloud Analogy','cloudanalogy.ai','cloud', false);

INSERT INTO public.leave_types (code, name, annual_days, carry_forward_days, description) VALUES
 ('ANNUAL','Annual leave',20,5,'Paid time off accrued monthly, set at AIONOS level.'),
 ('SICK','Sick leave',10,0,'Medical leave, certificate required beyond 3 consecutive days.'),
 ('CASUAL','Casual leave',6,0,'Short-notice personal leave.'),
 ('PARENTAL','Parental leave',90,0,'Applies to all entities under the AIONOS group policy.');

INSERT INTO public.policies (title, category, body, effective_from) VALUES
 ('Group leave policy','Leave','20 annual + 10 sick + 6 casual days per calendar year. Up to 5 annual days carry forward for 12 months. Applies to every AIONOS group entity.','2026-01-01'),
 ('Working week and timesheets','Time','Standard week is Monday to Friday, 40 hours. Timesheets must be submitted by Friday 18:00 local time and are approved by company HR.','2026-01-01'),
 ('Remote and hybrid working','Workplace','Minimum two days per week on site for hybrid roles. Fully remote roles are approved case by case by company HR.','2026-01-01'),
 ('Code of conduct','Compliance','Group-wide standards on ethics, confidentiality and respectful conduct across AIONOS, Perpetuuiti, Whilter and Cloud Analogy.','2026-01-01');

INSERT INTO public.holidays (name, holiday_date, location) VALUES
 ('New Year''s Day','2026-01-01','Bengaluru'),('Republic Day','2026-01-26','Bengaluru'),('Holi','2026-03-04','Bengaluru'),('Independence Day','2026-08-15','Bengaluru'),('Diwali','2026-11-08','Bengaluru'),
 ('New Year''s Day','2026-01-01','London'),('Good Friday','2026-04-03','London'),('Early May Bank Holiday','2026-05-04','London'),('Christmas Day','2026-12-25','London'),
 ('New Year''s Day','2026-01-01','Austin'),('Memorial Day','2026-05-25','Austin'),('Independence Day','2026-07-04','Austin'),('Thanksgiving','2026-11-26','Austin'),
 ('New Year''s Day','2026-01-01','Singapore'),('Chinese New Year','2026-02-17','Singapore'),('National Day','2026-08-09','Singapore');

INSERT INTO public.employees (full_name, email, company_id, job_title, department, location, status, access_level, joined_on)
SELECT v.full_name, v.email, c.id, v.job_title, v.department, v.location, v.status::public.employment_status, v.access_level::public.app_role, v.joined_on::date
FROM (VALUES
 ('Rhea Anand','rhea.anand@aionos.co','AIONOS','Group Head of People','People','Bengaluru','active','master_hr','2021-03-01'),
 ('Priya Nair','priya.nair@aionos.co','AIONOS','HR Business Partner','People','Bengaluru','active','company_hr','2022-06-15'),
 ('Arjun Mehta','arjun.mehta@aionos.co','AIONOS','Engineering Lead','Engineering','Bengaluru','active','employee','2021-09-01'),
 ('Lena Fischer','lena.fischer@aionos.co','AIONOS','Finance Controller','Finance','London','active','employee','2023-02-01'),
 ('Samuel Osei','samuel.osei@aionos.co','AIONOS','Data Analyst','Analytics','London','onboarding','employee','2026-09-01'),
 ('Marcus Feld','marcus.feld@perpetuuiti.io','PERP','People Operations Manager','People','Singapore','active','company_hr','2022-01-10'),
 ('Ishita Rao','ishita.rao@perpetuuiti.io','PERP','Platform Engineer','Engineering','Bengaluru','active','employee','2023-04-17'),
 ('Tobias Brann','tobias.brann@perpetuuiti.io','PERP','Product Manager','Product','Singapore','active','employee','2022-11-02'),
 ('Chen Wei','chen.wei@perpetuuiti.io','PERP','QA Engineer','Engineering','Singapore','on_leave','employee','2024-01-08'),
 ('Sana Okafor','sana.okafor@whilter.dev','WHIL','HR Manager','People','Austin','active','company_hr','2023-03-06'),
 ('Daniel Reyes','daniel.reyes@whilter.dev','WHIL','Account Executive','Sales','Austin','active','employee','2023-07-24'),
 ('Grace Lin','grace.lin@whilter.dev','WHIL','Designer','Design','Austin','active','employee','2024-05-13'),
 ('Omar Haddad','omar.haddad@whilter.dev','WHIL','Support Lead','Support','London','offboarded','employee','2021-08-02'),
 ('Nisha Kapoor','nisha.kapoor@cloudanalogy.ai','CLOUD','HR Generalist','People','Bengaluru','active','company_hr','2023-01-16'),
 ('Diego Rivas','diego.rivas@cloudanalogy.ai','CLOUD','Data Engineer','Data','Austin','active','employee','2023-10-09'),
 ('Aisha Bello','aisha.bello@cloudanalogy.ai','CLOUD','Salesforce Consultant','Delivery','London','active','employee','2024-02-19'),
 ('Kenji Tanaka','kenji.tanaka@cloudanalogy.ai','CLOUD','Solutions Architect','Delivery','Singapore','onboarding','employee','2026-09-07')
) AS v(full_name,email,company_code,job_title,department,location,status,access_level,joined_on)
JOIN public.companies c ON c.code = v.company_code;

-- balances for everyone
INSERT INTO public.leave_balances (employee_id, leave_type_id, year, entitled_days, used_days)
SELECT e.id, lt.id, 2026, lt.annual_days,
  CASE WHEN lt.code = 'ANNUAL' THEN round((abs(hashtext(e.email || lt.code)) % 12)::numeric, 1)
       WHEN lt.code = 'SICK' THEN (abs(hashtext(e.email || lt.code)) % 5)::numeric
       ELSE (abs(hashtext(e.email || lt.code)) % 3)::numeric END
FROM public.employees e CROSS JOIN public.leave_types lt;

-- sample leave requests
INSERT INTO public.leave_requests (employee_id, leave_type_id, start_date, end_date, days, reason, status)
SELECT e.id, lt.id, v.start_date::date, v.end_date::date, v.days, v.reason, v.status::public.request_status
FROM (VALUES
 ('arjun.mehta@aionos.co','ANNUAL','2026-09-21','2026-09-25',5,'Family trip','pending'),
 ('lena.fischer@aionos.co','SICK','2026-09-03','2026-09-04',2,'Flu','approved'),
 ('ishita.rao@perpetuuiti.io','ANNUAL','2026-10-05','2026-10-09',5,'Vacation','pending'),
 ('chen.wei@perpetuuiti.io','SICK','2026-09-07','2026-09-11',5,'Medical leave','approved'),
 ('grace.lin@whilter.dev','CASUAL','2026-09-15','2026-09-15',1,'Personal errand','pending'),
 ('daniel.reyes@whilter.dev','ANNUAL','2026-11-23','2026-11-27',5,'Thanksgiving week','pending'),
 ('diego.rivas@cloudanalogy.ai','ANNUAL','2026-09-28','2026-09-30',3,'Short break','approved'),
 ('aisha.bello@cloudanalogy.ai','CASUAL','2026-09-12','2026-09-12',1,'Appointment','rejected')
) AS v(email, code, start_date, end_date, days, reason, status)
JOIN public.employees e ON e.email = v.email
JOIN public.leave_types lt ON lt.code = v.code;

-- sample timesheets: last 3 weeks for active employees
INSERT INTO public.timesheets (employee_id, week_start, status, total_hours, submitted_at, note)
SELECT e.id, w.week_start, w.status::public.timesheet_status, w.hours, now() - interval '3 days', ''
FROM public.employees e
CROSS JOIN (VALUES
  (date_trunc('week', current_date - interval '14 days')::date, 'approved', 40),
  (date_trunc('week', current_date - interval '7 days')::date, 'submitted', 38),
  (date_trunc('week', current_date)::date, 'draft', 24)
) AS w(week_start, status, hours)
WHERE e.status IN ('active','on_leave');

INSERT INTO public.timesheet_entries (timesheet_id, work_date, hours, project, notes)
SELECT t.id, t.week_start + d, CASE WHEN t.status = 'draft' AND d > 2 THEN 0 ELSE 8 END, 'Client delivery', ''
FROM public.timesheets t
CROSS JOIN generate_series(0,4) AS d;
